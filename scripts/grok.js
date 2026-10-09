const { spawn } = require('node:child_process');
const process = require('node:process');
const path = require('node:path');
const http = require('node:http');
const ngrok = require('@ngrok/ngrok');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_PORT = Number(process.env.PORT || 3000);
const SERVER_HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}`;
const START_TIMEOUT_MS = 60000;
const PROBE_TIMEOUT_MS = 1500;

let serverProcess = null;
let shuttingDown = false;
let ngrokListener = null;
let managesServerProcess = false;
let keepAliveTimer = null;

function log(message) {
  console.log(`[grok] ${message}`);
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: false,
      env: process.env
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(' ')}) with code ${code}`));
    });
  });
}

function isServerReachable(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timeout while waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 500);
      });

      req.setTimeout(3000, () => {
        req.destroy(new Error('Request timeout'));
      });
    };

    attempt();
  });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    let startupCompleted = false;
    let startupFailed = false;

    serverProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT_DIR,
      shell: false,
      env: process.env,
      stdio: 'inherit'
    });

    serverProcess.once('error', (error) => {
      if (startupFailed) return;
      startupFailed = true;
      reject(error);
    });

    serverProcess.once('spawn', () => {
      startupCompleted = true;
      resolve();
    });

    serverProcess.once('exit', (code, signal) => {
      if (!startupCompleted && !startupFailed) {
        startupFailed = true;
        reject(new Error(`Server exited before startup (code=${code}, signal=${signal || 'none'})`));
        return;
      }

      if (!shuttingDown && managesServerProcess) {
        console.error(`[grok] Server process exited unexpectedly (code=${code}, signal=${signal || 'none'})`);
        shutdown(code || 1);
      }
    });
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  log('Closing ngrok tunnel...');
  try {
    if (ngrokListener) {
      await ngrokListener.close();
      ngrokListener = null;
    }
    await ngrok.disconnect();
  } catch (error) {
    console.error('[grok] Failed to close ngrok cleanly:', error.message);
  }

  if (managesServerProcess && serverProcess && !serverProcess.killed) {
    log('Stopping server...');
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 5000);

      serverProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  process.exit(exitCode);
}

async function main() {
  process.on('SIGINT', () => {
    shutdown(0);
  });
  process.on('SIGTERM', () => {
    shutdown(0);
  });

  log('Building client...');
  if (process.platform === 'win32') {
    await runCommand('cmd.exe', ['/d', '/s', '/c', 'npm run build:client']);
  } else {
    await runCommand('npm', ['run', 'build:client']);
  }

  const serverAlreadyRunning = await isServerReachable(SERVER_HEALTH_URL);
  if (serverAlreadyRunning) {
    log(`Server deja actif sur ${SERVER_HEALTH_URL}, reutilisation du process existant.`);
  } else {
    log('Starting API/game server...');
    await startServer();
    managesServerProcess = true;
  }

  log(`Waiting for server on ${SERVER_HEALTH_URL} ...`);
  await waitForServer(SERVER_HEALTH_URL, START_TIMEOUT_MS);

  log('Opening ngrok tunnel...');
  const ngrokConfig = {
    addr: SERVER_PORT
  };
  if (process.env.NGROK_AUTHTOKEN) {
    ngrokConfig.authtoken = process.env.NGROK_AUTHTOKEN;
  } else {
    log('NGROK_AUTHTOKEN non defini, utilisation de la configuration locale ngrok.');
  }
  ngrokListener = await ngrok.forward(ngrokConfig);
  const tunnelUrl = ngrokListener.url();

  log(`Public URL: ${tunnelUrl}`);
  log('The game and DB access are available through this URL (same backend process).');
  log('Press Ctrl+C to stop.');

  // Keep Node process alive explicitly (recommended by ngrok JS SDK examples).
  // Without an active event-loop handle, the process can exit and the endpoint goes offline.
  if (!keepAliveTimer) {
    keepAliveTimer = setInterval(() => {}, 60 * 1000);
  }
  if (process.stdin && process.stdin.isTTY) {
    process.stdin.resume();
  }
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error('[grok] Startup failed:', error.message);
  await shutdown(1);
});

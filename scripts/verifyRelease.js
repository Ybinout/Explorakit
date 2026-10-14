const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function run(command, args, env = process.env) {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
function checkDirectory(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) checkDirectory(filename);
        else if (entry.name.endsWith('.js')) run(process.execPath, ['--check', filename]);
    }
}
for (const directory of ['server', 'scripts', 'tests']) checkDirectory(directory);
for (const task of [
    'test',
    'audit:content',
    'audit:moves',
    'audit:abilities',
    'audit:balance',
    'audit:simulation',
])
    run('npm', ['run', task]);
if (process.argv.includes('--mysql')) {
    if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('DB_TEST_NAME dédié requis.');
    for (const task of ['test:mysql', 'test:http', 'test:recovery']) run('npm', ['run', task]);
}
run('npm', ['--prefix', 'vue-explorakit', 'run', 'lint', '--', '--no-fix']);
run(
    'npm',
    [
        '--prefix',
        'vue-explorakit',
        'run',
        'build',
        '--',
        '--dest',
        process.env.RELEASE_DIST_DIR || '/tmp/explorakit-release-dist',
    ],
    { ...process.env, NODE_ENV: 'production', BABEL_ENV: 'production' }
);
console.log('Validation de publication réussie. Aucun service de production redémarré.');

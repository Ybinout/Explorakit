const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mysql = require('mysql2/promise');
const { io } = require('../vue-explorakit/node_modules/socket.io-client');

// Dedicated ports allow the existing two-player regression to run independently.
process.env.VISUAL_TEST_SERVER_PORT ||= '31435';
process.env.VISUAL_TEST_DEBUG_PORT ||= '31436';
const {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture, gameVm,
    getDatabaseConfig, projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
} = require('./validatePokedexViewports');

// These fixture controls exist only in this child process, via private IPC.
// No debug route or cheat command is added to the application.
const harness = `
const express=require('express'),http=require('http'),path=require('path');
const {Server}=require('socket.io');const app=express(),server=http.createServer(app),io=new Server(server);
io.use(require('./server/http/authMiddleware').authenticateSocket);
app.use(express.json());app.use('/api',require('./server/http/routes'));app.use(express.static(path.resolve('dist')));
app.get('*',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
require('./server/realtime/socketHandler')(io);
let offset=0;const now=()=>Date.now()+offset;
const store=require('./server/game/drift/lobbyStore').createLobbyStore({now});
const accountRepository=require('./server/persistence/riftAccountRepository');
const cleanup=require('./server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,accountRepository,runtimeOptions:{starterChoiceMs:0,now,random:()=>.999,paceMs:0}});
const factory=require('./server/game/drift/pokemonFactory');
process.on('message',async message=>{
 try {
  const run=[...cleanup.runtime.runs.values()][0];let result={};
  if(message.type==='fixtures')for(const p of run.players.values()){
   const pokemon=factory.create(p.userId===message.hostId?1:19,p.userId===message.hostId?100:30,true);
   pokemon.abilities=['Tackle','Growl'];pokemon.movePp=[35,40];p.equipe.pokemons=[pokemon];cleanup.runtime.send(p);
  }
  if(message.type==='expire'){offset+=300*60000;cleanup.runtime.tick();result={matches:run.matches,id:run.id};}
  if(message.type==='state')result={id:run.id,phase:run.phase,round:run.round,matches:run.matches,players:[...run.players.values()].map(p=>({id:p.userId,alive:p.alive}))};
  if(message.type==='repeatSettlement')result=await accountRepository.recordRunFinished({id:run.id,winnerId:run.winnerId,finishedAt:run.finishedAt});
  process.send({id:message.id,ok:true,result});
 }catch(error){process.send({id:message.id,ok:false,message:error.stack});}
});
server.listen(process.env.PORT,()=>console.log('Server is running'));
`;

const viewports = [
    { label: 'desktop', width: 1440, height: 900, mobile: false },
    { label: 'mobile', width: 390, height: 844, mobile: true },
    { label: 'small-mobile', width: 320, height: 568, mobile: true },
    { label: 'landscape', width: 844, height: 390, mobile: true }
];

async function run() {
    const directory = path.resolve(process.env.RIFTMON_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-riftmon'));
    fs.mkdirSync(directory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-riftmon-browser-'));
    const server = spawn(process.execPath, ['-e', harness], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName, JWT_SECRET: 'riftmon-visual-test' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let browser, client, db, sequence = 0, runId;
    const fixtures = [], peers = [], errors = [];
    const lobby = "document.querySelector('[data-rift-hub]').__vue__";
    const control = (type, extra = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { server.off('message', listener); reject(Error('IPC timeout: ' + type)); }, 5000);
        const listener = (message) => {
            if (message.id !== id) return;
            clearTimeout(timeout); server.off('message', listener);
            if (message.ok) resolve(message.result); else reject(Error(message.message));
        };
        server.on('message', listener); server.send({ type, id, ...extra });
    });
    const command = (peer, event, payload = {}) => new Promise((resolve, reject) => {
        peer.socket.timeout(5000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response));
    });
    async function connectPeer(fixture) {
        const peer = { ...fixture, turn: null, state: null };
        peer.socket = io(baseUrl + '/drift', { autoConnect: false, auth: { token: fixture.token }, transports: ['websocket'] });
        peer.socket.on('requestAction', (data) => { peer.turn = data; });
        peer.socket.on('endbattle', () => { peer.turn = null; });
        peer.socket.on('drift:state', (state) => { peer.state = state; });
        const connected = new Promise((resolve, reject) => { peer.socket.once('drift:bootstrap', resolve); peer.socket.once('connect_error', reject); });
        peer.socket.connect(); await connected; peers.push(peer); return peer;
    }
    async function click(selector) {
        const point = await evaluate(client, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Commande absente ou inactive: '+${JSON.stringify(selector)});el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();if(!r.width||!r.height)throw Error('Commande masquée: '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    async function input(selector, value) {
        await evaluate(client, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    }
    async function press(key, code = key, modifiers = 0) {
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    }
    async function viewport(view) {
        await client.send('Emulation.setDeviceMetricsOverride', { ...view, deviceScaleFactor: 1 });
        await evaluate(client, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    }
    async function capture(name, scrollSelector, check) {
        for (const view of viewports) {
            await viewport(view);
            await evaluate(client, scrollSelector
                ? `document.querySelector(${JSON.stringify(scrollSelector)}).scrollIntoView({block:'start'});true;`
                : 'window.scrollTo(0,0);true;');
            assert.equal(await evaluate(client, 'document.documentElement.scrollWidth>innerWidth+1'), false, `${name} ${view.label}: largeur sans débordement`);
            if (check) await check(view);
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, `${name}-${view.label}.png`), Buffer.from(shot.data, 'base64'));
        }
    }
    async function boundedPanel(selector, { width, height, label }) {
        const r = await evaluate(client, `(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:el.scrollWidth>el.clientWidth+1};})()`);
        assert.ok(r.left >= 0 && r.right <= width + 1 && r.top >= 0 && r.bottom <= height + 1, label + ': panneau dans le viewport ' + JSON.stringify(r));
        assert.equal(r.overflow, false, label + ': contenu sans débordement horizontal');
    }
    async function snapshotAdventure() {
        const ids = fixtures.map((fixture) => fixture.user.id);
        const placeholders = ids.map(() => '?').join(',');
        const result = {};
        for (const table of ['users', 'teams', 'pokemons', 'user_items', 'player_story_flags', 'player_quests', 'player_badges', 'user_pokedex', 'user_npc_battles']) {
            const sql = table === 'pokemons'
                ? `SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id IN (${placeholders}) ORDER BY p.id`
                : `SELECT * FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} IN (${placeholders}) ORDER BY ${table === 'users' ? 'id' : 'user_id'}`;
            [result[table]] = await db.execute(sql, ids);
        }
        return JSON.stringify(result);
    }
    async function readProfile(fixture) {
        const response = await fetch(baseUrl + '/api/rift/profile', { headers: { Authorization: `Bearer ${fixture.token}` } });
        assert.equal(response.status, 200); return response.json();
    }
    async function peerAttack(peer) {
        const turn = peer.turn;
        if (!turn) return;
        peer.turn = null;
        const response = await command(peer, 'actionResponse', { action: 'attack', number: 0, turnId: turn.turnId });
        assert.equal(response.success, true, 'action réelle du rival acceptée');
    }
    try {
        await waitForServer(server);
        for (let i = 0; i < 3; i += 1) fixtures.push(await registerFixture());
        const [host, first, second] = fixtures;
        db = await mysql.createConnection(getDatabaseConfig());
        const before = await snapshotAdventure();
        const peer1 = await connectPeer(first), peer2 = await connectPeer(second);
        const publicRoom = await command(peer1, 'drift:create', { capacity: 3, durationMinutes: 120, visibility: 'public' });
        const privateRoom = await command(peer2, 'drift:create', { capacity: 5, durationMinutes: 90, visibility: 'private' });
        assert.equal(publicRoom.ok, true); assert.equal(privateRoom.ok, true);

        browser = spawn(findBrowserExecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, baseUrl + '/'], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl); await client.connect();
        client.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        });
        await client.send('Page.enable'); await client.send('Runtime.enable');
        await waitForExpression(client, "Boolean(document.querySelector('.home-menu .main-action'))");
        await viewport(viewports[0]);
        await capture('welcome');
        await click('.home-menu .main-action');
        await waitForExpression(client, "Boolean(document.querySelector('.login-card'))");
        await input('input[autocomplete="username"]', host.user.username);
        await input('input[type="password"]', 'mot-de-passe-visuel');
        await click('.login-button');
        await waitForExpression(client, `Boolean(document.querySelector('[data-rift-hub]')&&${lobby}.bootstrapped&&${lobby}.profile&&!${lobby}.profileLoading)`);
        assert.equal(await evaluate(client, 'location.pathname'), '/', 'la connexion revient au nouveau camp principal');
        assert.deepEqual(await evaluate(client, `${lobby}.profile`), { wins: 0, losses: 0, gamesStarted: 0, coins: 0 });
        assert.equal(await evaluate(client, "document.querySelector('[data-rift-shop]').disabled"), true);
        assert.ok(await evaluate(client, "document.querySelector('[data-rift-solo]').textContent.includes('Aventure')"));
        await capture('hub');
        await capture('profile', '[data-rift-profile]');

        await viewport(viewports[1]); await click('[data-rift-browse-tab]');
        await waitForExpression(client, `Boolean(document.querySelector('[data-rift-room="${publicRoom.lobby.code}"]'))`);
        assert.equal(await evaluate(client, `Boolean(document.querySelector('[data-rift-room="${privateRoom.lobby.code}"]'))`), false, 'le salon privé est absent de la liste publique');
        await input('#rift-search', first.user.username);
        await waitForExpression(client, "document.querySelectorAll('[data-rift-room]').length===1");
        await capture('open-rooms', '[data-rift-browser]');
        await input('#rift-search', 'aucun-rival-correspondant');
        await waitForExpression(client, "document.querySelectorAll('[data-rift-room]').length===0");
        await input('#rift-search', publicRoom.lobby.code);
        await waitForExpression(client, "document.querySelectorAll('[data-rift-room]').length===1");
        await click(`[data-rift-room="${publicRoom.lobby.code}"] button`);
        await waitForExpression(client, `${lobby}.lobby?.players.length===2&&!${lobby}.busy`);
        await click('.room-actions .subtle-button');
        await waitForExpression(client, `!${lobby}.lobby&&!${lobby}.busy`);
        assert.equal((await command(peer1, 'drift:leave')).ok, true);
        assert.equal((await command(peer2, 'drift:leave')).ok, true);
        assert.deepEqual(await readProfile(host), { wins: 0, losses: 0, gamesStarted: 0, coins: 0 }, 'rejoindre un salon ne compte pas comme un lancement');

        await viewport(viewports[1]); await click('[data-rift-create-tab]');
        await input('[data-rift-capacity]', '3'); await input('[data-rift-visibility]', 'public');
        await click('[data-rift-duration="40"]');
        await waitForExpression(client, `${lobby}.rewardEstimate===300`);
        assert.match(await evaluate(client, "document.querySelector('[data-rift-reward-preview]').textContent"), /300/);
        await capture('duration-choices', '.lobby-card', async ({width,label}) => {
            const buttons=await evaluate(client, "[...document.querySelectorAll('[data-rift-duration]')].map(el=>{const r=el.getBoundingClientRect();return{value:Number(el.dataset.riftDuration),left:r.left,right:r.right,width:r.width,height:r.height};})");
            assert.deepEqual(buttons.map(button=>button.value),[20,30,40,60,90,120,300]);
            for(const button of buttons)assert.ok(button.left>=0&&button.right<=width+1&&button.width>=44&&button.height>=44,label+' : chaque durée a une cible tactile visible');
        });
        await click('[data-rift-duration="300"]');
        await waitForExpression(client, `${lobby}.rewardEstimate===2250`);
        assert.match(await evaluate(client, "document.querySelector('[data-rift-reward-preview]').textContent"), /2\s*250/);
        await click('[data-rift-create]');
        await waitForExpression(client, `${lobby}.lobby?.capacity===3&&${lobby}.lobby?.durationMinutes===300&&!${lobby}.busy`);
        const code = await evaluate(client, `${lobby}.lobby.code`);
        assert.equal((await command(peer1, 'drift:join', { code })).ok, true);
        assert.equal((await command(peer2, 'drift:join', { code })).ok, true);
        await waitForExpression(client, `${lobby}.lobby?.players.length===3`);
        await capture('lobby-300', '.lobby-card');
        await command(peer1, 'drift:ready', { ready: true }); await command(peer2, 'drift:ready', { ready: true });
        await click('.room-actions .gold-button');
        await waitForExpression(client, `${lobby}.readyCount===3&&!${lobby}.busy`);
        await click('.launch-note button');
        await waitForExpression(client, `Boolean(${gameVm}?.driftState?.alive)&&location.pathname==='/drift/game'`);
        assert.equal((await command(peer1, 'drift:enter')).success, true);
        assert.equal((await command(peer2, 'drift:enter')).success, true);
        runId = await evaluate(client, `${gameVm}.driftState.id`);
        assert.equal(await evaluate(client, `${gameVm}.driftState.players.length`), 3);
        assert.ok(await evaluate(client, `${gameVm}.driftState.endsAt-${gameVm}.driftState.serverNow>299*60000`), 'cinq heures réellement données au serveur');
        assert.deepEqual(await readProfile(host), { wins: 0, losses: 0, gamesStarted: 1, coins: 0 });
        await click('.drift-hud-toggle'); await click('[data-drift-tab="players"]');
        await waitForExpression(client, "Boolean(document.querySelector('[data-rift-participants]'))");
        assert.match(await evaluate(client, "document.querySelector('[data-survivor-count]').textContent"), /3\s*\/\s*3/);
        assert.equal(await evaluate(client, "document.querySelectorAll('[data-participant]').length"), 3);
        await capture('survivors', null, (view) => boundedPanel('.run-panel', view));
        await control('fixtures', { hostId: host.user.id });
        await control('expire');
        await waitForExpression(client, `${gameVm}.driftState.phase==='preparation'&&${gameVm}.map==='ville1_arene'`);
        await click('[data-drift-tab="tournament"]');
        await waitForExpression(client, "Boolean(document.querySelector('[data-rift-bye]'))");
        const matches = await evaluate(client, `${gameVm}.driftState.matches`);
        assert.equal(matches.filter((match) => match.status === 'bye').length, 1);
        assert.ok(matches.find((match) => match.status === 'bye').players.includes(host.user.id));
        await capture('tournament-bye', null, (view) => boundedPanel('.run-panel', view));
        await command(peer1, 'drift:roundReady'); await command(peer2, 'drift:roundReady');
        const match = matches.find((entry) => entry.status === 'waiting');
        await waitForExpression(client, `Boolean(document.querySelector('[data-spectate-match="${match.id}"]'))`);
        await click(`[data-spectate-match="${match.id}"]`);
        await waitForExpression(client, "Boolean(document.querySelector('[data-rift-spectator]'))");
        assert.equal(await evaluate(client, "document.querySelector('[data-rift-spectator]').contains(document.activeElement)"), true);
        assert.equal(await evaluate(client, 'Boolean(document.querySelector(".action-attack"))'), false, 'aucune commande de combat dans les tribunes');
        assert.equal(await evaluate(client, `${gameVm}.battle`), false);
        const initialHp = await evaluate(client, `${gameVm}.driftSpectator.players.map(player=>player.pokemon.currentHp)`);
        await evaluate(client, `window.riftCommands=[];window.riftOriginalEmit=${gameVm}.socket.emit;${gameVm}.socket.emit=function(name,...args){if(['playerAction','Space','actionResponse'].includes(name))window.riftCommands.push(name);return window.riftOriginalEmit.call(this,name,...args)};true;`);
        for (const [key, keyCode] of [['z', 'KeyZ'], ['q', 'KeyQ'], ['s', 'KeyS'], ['d', 'KeyD'], ['ArrowUp', 'ArrowUp']]) await press(key, keyCode);
        assert.deepEqual(await evaluate(client, 'window.riftCommands'), [], 'les touches des tribunes ne commandent pas le joueur');
        await evaluate(client, `${gameVm}.socket.emit=window.riftOriginalEmit;true;`);
        await peerAttack(peer1); await peerAttack(peer2);
        await waitForExpression(client, `${gameVm}.driftSpectator.log.length>0`);
        assert.notDeepEqual(await evaluate(client, `${gameVm}.driftSpectator.players.map(player=>player.pokemon?.currentHp)`), initialHp, 'les PV observés suivent de vraies attaques');
        await capture('spectator', null, async (view) => {
            await boundedPanel('[data-rift-spectator]', view);
            const button = await evaluate(client, "(()=>{const r=document.querySelector('[data-spectator-return]').getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height};})()");
            assert.ok(button.height >= 44 && button.top >= 0 && button.bottom <= view.height + 1, 'retour visible et tactile');
        });
        await evaluate(client, "document.querySelector('[data-spectator-return]').focus();true;");
        await press('Tab');
        assert.equal(await evaluate(client, 'document.activeElement.hasAttribute("data-spectator-close")'), true);
        for (let turn = 0; turn < 30 && await evaluate(client, `${gameVm}.driftState.currentRound===1`); turn += 1) {
            await peerAttack(peer1); await peerAttack(peer2);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await waitForExpression(client, `${gameVm}.driftState.currentRound===2`);
        assert.equal(await evaluate(client, `${gameVm}.driftSpectator.active`), false, 'résultat du duel regardé conservé');
        await capture('spectator-finished', null, (view) => boundedPanel('[data-rift-spectator]', view));
        await click('[data-spectator-return]');
        await waitForExpression(client, "!document.querySelector('[data-rift-spectator]')&&Boolean(document.querySelector('.run-panel'))");
        await click('[data-drift-tab="players"]');
        assert.match(await evaluate(client, "document.querySelector('[data-survivor-count]').textContent"), /2\s*\/\s*3/, 'le K.O. du rival réduit les survivants');
        await capture('survivors-after-duel', null, (view) => boundedPanel('.run-panel', view));
        await click('[data-drift-tab="tournament"]');
        const finalMatch = await evaluate(client, `${gameVm}.driftState.matches.find(match=>match.round===2)`);
        const opponent = peers.find((peer) => finalMatch.players.includes(peer.user.id));
        assert.ok(opponent);
        opponent.socket.on('requestAction', (data) => opponent.socket.emit('actionResponse', { action: 'attack', number: 0, turnId: data.turnId }));
        await command(opponent, 'drift:roundReady'); await click('[data-drift-action="ready"]');
        for (let turn = 0; turn < 15; turn += 1) {
            await waitForExpression(client, `${gameVm}.driftState.phase==='results'||${gameVm}.$refs.battleOverlay?.canChooseAction`);
            if (await evaluate(client, `${gameVm}.driftState.phase==='results'`)) break;
            await click('.action-attack'); await waitForExpression(client, "Boolean(document.querySelector('.battle-choice-btn'))");
            await click('.battle-choice-btn');
        }
        await waitForExpression(client, `${gameVm}.driftState.phase==='results'&&${gameVm}.driftState.settlement?.status==='complete'`);
        assert.equal(await evaluate(client, `${gameVm}.driftState.winnerId`), host.user.id);
        await waitForExpression(client, "Boolean(document.querySelector('[data-battle-result]'))");
        assert.equal(await evaluate(client, `${gameVm}.battleResult.outcome`), 'victory');
        await click('[data-battle-result-continue]');
        await waitForExpression(client, "Boolean(document.querySelector('[data-drift-report]'))");
        assert.match(await evaluate(client, "document.querySelector('[data-rift-account-reward]').textContent"), /2\s*250 pièces/);
        const expectedReward = { version: 1, participantCount: 3, explorationMs: 300 * 60000, coinsPerPlayerMinute: 2.5, coinsAwarded: 2250 };
        assert.deepEqual(await evaluate(client, `${gameVm}.driftState.settlement.reward`), expectedReward, 'la prime dépend des trois participants et des cinq heures explorées, sans le tournoi');
        assert.match(await evaluate(client, "document.querySelector('[data-rift-reward-detail]').textContent"), /300/);
        const report = await evaluate(client, `${gameVm}.driftState.report`);
        assert.deepEqual(report.accountReward, expectedReward, 'le souvenir conserve les bases du calcul');
        assert.equal(report.players.length, 3); assert.equal(report.matches.length, 3);
        await capture('results', null, (view) => boundedPanel('.run-panel', view));
        assert.deepEqual(await readProfile(host), { wins: 1, losses: 0, gamesStarted: 1, coins: 2250 });
        for (const fixture of [first, second]) assert.deepEqual(await readProfile(fixture), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
        assert.equal((await control('repeatSettlement')).recorded, false);
        assert.deepEqual(await readProfile(host), { wins: 1, losses: 0, gamesStarted: 1, coins: 2250 }, 'relire un résultat ne double jamais la prime');
        assert.equal(await snapshotAdventure(), before, 'les neuf tables Aventure restent strictement inchangées');
        await click('[data-drift-action="exit"]');
        await waitForExpression(client, `Boolean(document.querySelector('[data-rift-hub]')&&${lobby}.profile?.coins===2250)`);
        await client.send('Page.reload', { ignoreCache: true });
        await waitForExpression(client, `Boolean(document.querySelector('[data-rift-hub]')&&${lobby}.profile?.wins===1&&${lobby}.bootstrapped)`);
        assert.equal(await evaluate(client, "document.querySelector('[data-rift-games]').textContent.trim()"), '1');
        assert.match(await evaluate(client, "document.querySelector('[data-rift-coins]').textContent.trim()"), /^2\s*250$/);
        await capture('profile-after', '[data-rift-profile]');
        await click('[data-drift-history-toggle]');
        await click(`[data-drift-history-run="${runId}"]`);
        await waitForExpression(client, "Boolean(document.querySelector('[data-drift-report]'))");
        assert.equal(await evaluate(client, "document.querySelector('[data-drift-report]').__vue__.report.players.length"), 3, 'les trois parcours se relisent au camp');
        assert.deepEqual(await evaluate(client, "document.querySelector('[data-drift-report]').__vue__.report.accountReward"), expectedReward);
        assert.match(await evaluate(client, "document.querySelector('[data-report-account-reward]').textContent"), /2\s*250/);
        await capture('archive', '[data-drift-report]');
        await click('[data-rift-solo]');
        await waitForExpression(client, `location.pathname==='/game'&&Boolean(${gameVm}?.socket?.connected)`);
        assert.equal(await evaluate(client, `${gameVm}.isDrift`), false, 'le bouton solo rejoint bien l’Aventure habituelle');
        assert.deepEqual(errors, [], 'aucune exception navigateur');
        console.log('RiftMon réel : connexion au nouveau camp, profil SQL, boutique bloquée, recherche publique et confidentialité privée, rejoindre/créer par interface, trois joueurs et 300 minutes, survivants 3 → 2, exemption unique, duel réel en spectateur (PV/journal/focus/lecture seule), finale gagnée, 2 250 pièces uniques fondées sur exploration et participants initiaux, pertes persistantes, archive avec calcul relue après rechargement, retour Aventure. Quatre formats, neuf tables Aventure inchangées. Fixtures privées : équipes et horloge seulement. ' + directory);
    } catch (error) {
        if (client) {
            console.error('État navigateur au défaut:', await evaluate(client, `({path:location.pathname,game:Boolean(${gameVm}),socket:${gameVm}?.socket?.connected,drift:${gameVm}?.isDrift,body:document.body.textContent.slice(-1000)})`).catch(() => null));
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => null);
            if (shot) fs.writeFileSync(path.join(directory, 'failure.png'), Buffer.from(shot.data, 'base64'));
        }
        throw error;
    } finally {
        for (const peer of peers) peer.socket.disconnect();
        client?.close(); await stopChild(browser); await stopChild(server);
        if (db) {
            if (runId) await db.execute('DELETE FROM rift_runs WHERE id = ?', [runId]);
            await db.end();
        }
        for (const fixture of fixtures) await cleanupFixture(fixture.user.id);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

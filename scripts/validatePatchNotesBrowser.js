// Real authenticated HTTP/SQL/world integration on disposable accounts only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const http = require('node:http'), {once} = require('node:events'), {randomUUID,createHash} = require('node:crypto');
if (process.env.DB_TEST_NAME !== 'explorakit_test') throw Error('Dedicated test database required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test';
const {dbPool:db} = require('../server/config/database'), express = require('express'), {Server} = require('socket.io');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-patch-notes-dist';
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
assert(['chromium','webkit'].includes(engine));
const out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-patch-notes-' + engine;
fs.mkdirSync(out,{recursive:true}); fs.rmSync(path.join(out,'report.json'),{force:true});
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api',require('../server/http/routes')); app.use(express.static(dist));
app.get('*',(_q,r) => r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const users = [], contexts = [], errors = [], views = [];
let browser, base, success = false;
async function fixture() {
    const password = randomUUID(), u = await require('../server/persistence/userRepository').createUserWithStarter('patch_ui_' + randomUUID(),password);
    users.push(u.id);
    return {...u,password,token:require('../server/config/auth').signAccessToken(u)};
}
async function context(user) {
    // WebKit service workers bypass Playwright's deliberate delayed-response routes.
    const c = await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'}); contexts.push(c);
    if (user) await c.addInitScript(user => { if (location.protocol.startsWith('http')) localStorage.setItem('explorakit.user',JSON.stringify(user)); },user);
    c.on('page',p => p.on('pageerror',e => errors.push(e.message)));
    return c;
}
const open = page => page.locator('[data-patch-notes][open]');
async function unchanged(page) { await page.waitForTimeout(300); assert.equal(await open(page).count(),0); }
async function layout(page) {
    for (const [width,height] of [[320,480],[393,852],[844,390],[1536,680]]) for (const theme of ['light','dark']) {
        await page.setViewportSize({width,height});
        await page.evaluate(theme => {document.documentElement.dataset.gameThemeMode = theme;},theme);
        await page.waitForTimeout(120);
        const box = await open(page).evaluate(n => {const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:n.scrollWidth>n.clientWidth+1};});
        assert(box.left>=0 && box.right<=width+1 && box.top>=0 && box.bottom<=height+1 && !box.overflow,JSON.stringify(box));
        assert(await page.locator('[data-patch-dismiss]').evaluate(n => {const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
        const file=`patch-${width}-${theme}.png`; await page.screenshot({path:path.join(out,file)}); views.push({width,height,theme,file});
    }
}
(async () => {
    try {
        server.listen(0,'127.0.0.1'); await once(server,'listening'); base='http://127.0.0.1:'+server.address().port;
        browser = await require('playwright')[engine].launch({headless:true});
        const user = await fixture(), c = await context(), page = await c.newPage();
        await page.goto(base+'/connexion'); await unchanged(page);
        await page.locator('[autocomplete=username]').fill(user.username);
        await page.locator('[autocomplete=current-password]').fill(user.password);
        await page.locator('.login-button').click(); await open(page).waitFor();
        assert((await open(page).innerText()).includes('80 %'));
        assert(await page.locator('[data-patch-dismiss]').evaluate(n => document.activeElement===n));
        await page.keyboard.press('Tab'); assert(await open(page).evaluate(n => n.contains(document.activeElement)));
        await layout(page);
        // Refresh before acknowledging must not silently dismiss the update.
        await page.reload(); await open(page).waitFor();
        // A slow unread response captured before closing must not reopen it.
        let releaseStale, fetched;
        const staleGate = new Promise(r=>{releaseStale=r;}), captured = new Promise(r=>{fetched=r;});
        await page.route('**/api/patch-notes',async r => {const response=await r.fetch();fetched();await staleGate;await r.fulfill({response});});
        await open(page).evaluate(n => {n.__vue__.$parent.patchNoticeCheck++;});
        let timeout;
        try { await Promise.race([captured,new Promise((_r,reject)=>{timeout=setTimeout(()=>reject(Error('Delayed GET not captured')),10000);})]); }
        finally { clearTimeout(timeout); }
        await page.keyboard.press('Escape'); await open(page).waitFor({state:'hidden'});
        releaseStale(); await unchanged(page); await page.unroute('**/api/patch-notes');
        await page.reload(); await unchanged(page);
        const otherDevice = await context(user), remote = await otherDevice.newPage();
        await remote.goto(base); await unchanged(remote);
        const [[receipt]] = await db.execute("SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'patch_seen:%'",[user.id]);
        assert.equal(Number(receipt.n),1);

        // A different account on the same device must still receive the patch.
        const next = await fixture();
        await page.evaluate(next => {localStorage.setItem('explorakit.user',JSON.stringify(next));dispatchEvent(new Event('riftmon:session'));},next);
        await open(page).waitFor();
        // Connection failure on acknowledgement is recoverable without blocking the game.
        await page.route('**/api/patch-notes/seen',r => r.fulfill({status:503,contentType:'application/json',body:'{"message":"injected failure"}'}));
        await page.locator('[data-patch-dismiss]').click(); await page.locator('.patch-error').waitFor();
        await page.locator('.patch-notes footer button').first().click(); await unchanged(page);
        await page.unroute('**/api/patch-notes/seen'); await page.reload(); await open(page).waitFor();
        await page.locator('[data-patch-dismiss]').click(); await unchanged(page);

        // Fresh account: the opening in bed has priority over patch notes.
        const openingUser = await fixture(), openingContext = await context(openingUser), openingPage = await openingContext.newPage();
        await openingPage.goto(base+'/game');
        await openingPage.waitForFunction(() => document.querySelector('.game-root')?.__vue__?.openingScene);
        await unchanged(openingPage); await openingContext.close();

        // Saved game: defer behind an open team menu, then stop all movement under the modal.
        const worldUser = await fixture();
        await db.execute("UPDATE users SET map='centre',x=336,y=304 WHERE id=?",[worldUser.id]);
        await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[worldUser.id]);
        const wc = await context(worldUser), wp = await wc.newPage(); let release;
        const gate = new Promise(r=>{release=r;});
        await wp.route('**/api/patch-notes',async r => {await gate;await r.continue();});
        await wp.goto(base+'/game');
        await wp.waitForFunction(() => {const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});
        await wp.evaluate(() => v.handleMenuAction('pokemon'));
        await wp.waitForFunction(() => v.isTeamPanelOpen);
        release(); await unchanged(wp);
        await wp.evaluate(() => v.closeTeamPanel()); await open(wp).waitFor();
        const position = await wp.evaluate(() => ({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y}));
        await wp.keyboard.down('s'); await wp.waitForTimeout(450); await wp.keyboard.up('s');
        assert.deepEqual(await wp.evaluate(() => ({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y})),position);
        assert(await wp.evaluate(() => v.patchNoticeOpen && v.movementBlocked));
        // Native top-layer dialog stays visible when the game enters fullscreen.
        if (engine==='chromium') {
            await wp.evaluate(() => document.querySelector('.game-root').requestFullscreen());
            assert(await open(wp).evaluate(n => n.matches(':modal')));
            await wp.evaluate(() => document.exitFullscreen());
        }
        await wp.locator('[data-patch-dismiss]').click(); await unchanged(wp);
        assert.equal(await wp.evaluate(() => v.patchNoticeOpen),false);
        success = true;
    } finally {
        await browser?.close(); await new Promise(r => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        for (const id of users) await db.execute('DELETE FROM users WHERE id=?',[id]);
        await db.end();
        success = success && !errors.length;
        fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex'),checks:['login','unread-reload','stale-response','persisted-dismissal','cross-device','account-switch','ack-failure','onboarding-priority','menu-priority','movement-blocked','focus',...(engine==='chromium'?['fullscreen']:[])]},null,2));
    }
    assert.deepEqual(errors,[]); console.log(JSON.stringify({success,engine,views:views.length,out}));
})().catch(e => {console.error(e.stack);process.exitCode=1;});

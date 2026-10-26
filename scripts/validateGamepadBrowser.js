// Virtual hardware readings, real Chrome/Vue + HTTP/Socket/SQL game paths.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {once} = require('node:events'), {randomUUID} = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test'; process.env.BATTLE_DELAY_SCALE = '0';
const express = require('express'), {Server} = require('socket.io'), {chromium} = require('playwright');
const {dbPool: db} = require('../server/config/database');
const store = require('../server/game/world/pnjStore'), maps = require('../server/game/world/mapRepository');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-gamepad-dist', out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-gamepad-browser';
fs.mkdirSync(out, {recursive:true});
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist)); app.get('*', (_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const cleanupDrift=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{runtimeOptions:{starterChoiceMs:60000,paceMs:0}});
let browser, page, id, success = false; const errors = [], checks = [], screenshots = [];
async function button(index, duration = 70) {
  await page.evaluate(i=>{testPad.buttons[i]={pressed:true,value:1};},index);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); await page.waitForTimeout(duration);
  await page.evaluate(i=>{testPad.buttons[i]={pressed:false,value:0};},index);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); await page.waitForTimeout(70);
}
async function connect() {
  await page.evaluate(()=>{testPad.connected=true;window.dispatchEvent(new Event('gamepadconnected'));}); await page.waitForTimeout(100);
}
async function shot(name) { const file=name+'.png'; await page.screenshot({path:path.join(out,file)}); screenshots.push(file); }
(async()=>{try {
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const base=`http://127.0.0.1:${server.address().port}`;
  const actor = store.getPnjsForMap('ville1').find(n=>n.name==='town_bastien');
  const collision=maps.loadCollisionData('ville1'), x=actor.x, y=actor.y+1;
  assert.equal(collision[y][x],0);
  const response = await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'pad_'+randomUUID(),password:randomUUID(),starterId:7})});
  assert.equal(response.status,201); const user=await response.json(); id=user.user.id;
  await db.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=1000 WHERE id=?',['ville1',x*32+16,y*32+16,id]);
  browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1280,height:720},hasTouch:true});
  await context.addInitScript(session=>{
    localStorage.setItem('explorakit.user',JSON.stringify(session));
    window.testPad={id:'AYN Thor (virtual test)',index:0,connected:false,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>testPad.connected?[testPad]:[]});
  },{...user.user,token:user.token});
  page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game',{waitUntil:'networkidle'}); await page.bringToFront();
  await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||vm.mapLoading||vm.renderedMap!==vm.map||!vm.players[vm.socket.id])return false;window.v=vm;return true;});
  await connect();
  await page.evaluate(()=>{window.padEvents=[];const emit=v.socket.emit;v.socket.emit=function(event,...args){if(event==='playerAction')padEvents.push({time:performance.now(),action:args[0]});return emit.call(this,event,...args);};});
  // A real safe tile step, returned by the authoritative server.
  const move=collision[y][x-1]===0&&!store.isPnjBlockingTile('ville1',x-1,y)?[14,-1]:[15,1];
  const before=await page.evaluate(()=>v.players[v.socket.id].x);
  await button(move[0]); await page.waitForFunction(old=>v.players[v.socket.id].x!==old,before);
  assert.equal(await page.evaluate(()=>v.players[v.socket.id].x),before+move[1]*32); checks.push('D-pad moves through real Socket/server');
  await page.waitForTimeout(180); await button(move[0]===14?15:14); await page.waitForFunction(old=>v.players[v.socket.id].x===old,before);
  await page.evaluate(()=>testPad.axes=[0.1,0.2]); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>v.players[v.socket.id].x),before); await page.evaluate(()=>testPad.axes=[0,0]); checks.push('Stick drift ignored');
  await button(9); await page.waitForFunction(()=>v.isMenuOpen); await button(13);
  assert(await page.locator('.menu-dropdown .gamepad-focus').count()); checks.push('Start opens menu and arrows focus visible actions');
  const count=await page.evaluate(()=>padEvents.length); await button(13,450); assert.equal(await page.evaluate(()=>padEvents.length),count); checks.push('Held navigation repeats without moving behind menu');
  await button(1); await page.waitForFunction(()=>!v.isMenuOpen);
  await button(2); await page.waitForFunction(()=>v.isTeamPanelOpen&&!v.teamLoading); await button(13); await button(0);
  await page.waitForFunction(()=>!!v.selectedPokemonUuid); await button(1); await page.waitForFunction(()=>!v.selectedPokemonUuid); await button(1); await page.waitForFunction(()=>!v.isTeamPanelOpen); checks.push('X team, A details, B returns through nested panels');
  await button(3); await page.waitForFunction(()=>v.isBagOpen);
  const nextPocket=await page.evaluate(()=>{const tabs=[...document.querySelectorAll('.bag-backdrop [role="tab"]')],i=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');return tabs[(i+1)%tabs.length].dataset.bagPocket;});
  await button(5);
  assert.equal(await page.locator('.bag-backdrop [role="tab"][aria-selected="true"]').getAttribute('data-bag-pocket'),nextPocket);
  await button(1); await page.waitForFunction(()=>!v.isBagOpen); checks.push('Y bag, R1 pocket, B close');
  // Configure through the actual options UI; changing a select is not a game move.
  await page.evaluate(()=>v.handleMenuAction('options')); await page.locator('[data-controller-options]').waitFor();
  assert.match(await page.locator('[data-controller-status]').innerText(),/AYN Thor/);
  for(const [width,height] of [[320,568],[393,852],[1280,720]]) {
    await page.setViewportSize({width,height}); await shot('options-'+width);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await page.locator('[data-controller-layout]').selectOption('nintendo'); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('explorakitGamePreferences')).controllerLayout),'nintendo');
  await button(0); await page.waitForFunction(()=>!v.activeInfoPanel); checks.push('Nintendo A/B swap saved and applied immediately');
  await page.evaluate(()=>v.updatePreferences({...v.preferences,controllerLayout:'standard'})); await page.waitForTimeout(100);
  await page.evaluate(()=>v.updatePreferences({...v.preferences,controllerEnabled:false})); await page.waitForTimeout(100);
  await button(9); assert.equal(await page.evaluate(()=>v.isMenuOpen),false);
  await page.locator('.menu-toggle-btn').click(); await page.waitForFunction(()=>v.isMenuOpen);
  await page.keyboard.press('Escape'); await page.waitForFunction(()=>!v.isMenuOpen);
  checks.push('Controller opt-out preserves touch and keyboard');
  await page.evaluate(()=>v.updatePreferences({...v.preferences,controllerEnabled:true})); await page.waitForTimeout(100);
  // Reader suspension releases movement and re-arms only after neutral.
  await page.evaluate(()=>{testPad.axes=[.8,0];}); await page.waitForTimeout(40);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); const stopped=await page.evaluate(()=>padEvents.length);
  await page.waitForTimeout(250); assert.equal(await page.evaluate(()=>padEvents.length),stopped);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(160); assert.equal(await page.evaluate(()=>padEvents.length),stopped);
  await page.evaluate(()=>testPad.axes=[0,0]); await page.waitForTimeout(80);
  await page.evaluate(()=>{testPad.connected=false;window.dispatchEvent(new Event('gamepaddisconnected'));});
  assert.equal(await page.evaluate(()=>v._gamepadDirection),null); checks.push('Blur, held-stick return and unplug release movement');
  await connect();
  // Return beside the real trainer using the test fixture only, then use A.
  await page.evaluate(()=>v.releaseAllMovementKeys());
  await page.evaluate(()=>v.socket.disconnect()); await page.waitForTimeout(100);
  await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['ville1',x*32+16,y*32+16,id]);
  await page.reload({waitUntil:'networkidle'}); await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||vm.mapLoading||vm.renderedMap!==vm.map)return false;window.v=vm;return !!vm.players[vm.socket.id];}); await connect();
  await button(0); await page.waitForFunction(()=>v.textImageSequence.length>0);
  assert.equal(await page.evaluate(()=>v.endSentences),'town_bastien'); checks.push('A starts actual trainer dialogue');
  for(let i=0;i<20&&await page.evaluate(()=>v.textImageSequence.length>0);i++)await button(0);
  await page.locator('.action-attack:enabled').waitFor(); await button(0);
  await page.locator('.battle-grid-attacks').waitFor(); await button(15); await shot('combat-navigation');
  assert(await page.locator('.battle-grid-attacks .gamepad-focus').count());
  await button(1); await page.waitForFunction(()=>!v.$refs.battleOverlay.actionState.attackPanel);
  await button(2); await page.locator('.battle-grid-pokemon').waitFor(); await button(1);
  await button(0); await page.locator('.battle-grid-attacks').waitFor(); await button(0);
  await page.waitForFunction(()=>v.$refs.battleOverlay.actionState.patient||!!v.battleResult||!!v.pendingBattleResult);
  checks.push('A opens attacks and submits real combat action; B backs out; X opens switch menu');
  await page.goto(base+'/colosseum',{waitUntil:'networkidle'}); await connect();
  await page.locator('[data-colosseum-start]:enabled').waitFor();
  await page.locator('[data-colosseum-start]').focus(); await button(0);
  await page.locator('[data-starter-choice]').first().waitFor();
  assert.equal(await page.locator('[data-starter-choice]').count(),3);
  await button(0);
  await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||vm.mapLoading||vm.renderedMap!==vm.map||vm.driftState?.phase!=='exploration')return false;window.v=vm;return !!vm.players[vm.socket.id];});
  assert(await page.evaluate(()=>v.isColosseum&&v.isDrift));
  await button(2); await page.waitForFunction(()=>v.isTeamPanelOpen&&!v.teamLoading); await button(1); await page.waitForFunction(()=>!v.isTeamPanelOpen);
  await button(9); await page.waitForFunction(()=>v.isMenuOpen); await button(13); await shot('colosseum-menu'); await button(1);
  checks.push('Real Colosseum entry, one-of-three starter selection, team and menu via pad');
  assert.deepEqual(errors,[]); success=true;
  const result={hardware:'Simulated navigator.getGamepads in real Chromium; no physical AYN Thor available',checks,viewports:3,screenshots,errors};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {
  if(!success&&page&&!page.isClosed()){
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    const state=await page.evaluate(()=>({checks:window.padReadings,focus:document.activeElement?.outerHTML,team:v.isTeamPanelOpen,selected:v.selectedPokemonUuid,menu:v.isMenuOpen,panels:v.activeInfoPanel,errors:window.padError})).catch(()=>null);
    fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(state,null,2));
  }
  await browser?.close(); cleanupDrift(); await new Promise(r=>io.close(r)); await new Promise(r=>setTimeout(r,250));
  if(id)await db.execute('DELETE FROM users WHERE id=?',[id]); await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

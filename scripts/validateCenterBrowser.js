// Real actions against an isolated server/database. No production account or fixture endpoint.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test database required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database'), teamRepo = require('../server/persistence/teamRepository');
const factory = require('../server/game/drift/pokemonFactory'), pcRepo = require('../server/persistence/pokemonStorageRepository');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-center-dist', out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-center-browser';
fs.mkdirSync(out, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, {checkpointRepository:{async save(){}}, runtimeOptions:{random:()=>.9, paceMs:0}});
let browser, page, userId, success = false; const errors = [];
async function ready() {
  await page.waitForFunction(() => { const v = document.querySelector('.game-root')?.__vue__; if (!v?.socket?.connected || !v.players[v.socket.id] || v.mapLoading || v.renderedMap !== v.map) return false; window.v = v; return true; });
}
async function walk(tx, ty) {
  const start = await page.evaluate(() => { const p = v.players[v.socket.id]; return [Math.floor(p.x / 32), Math.floor(p.y / 32)]; });
  const coll = require('../server/game/world/mapRepository').loadCollisionData('centre');
  const blocked = require('../server/game/world/pnjStore').isPnjBlockingTile;
  const queue = [[...start, []]], seen = new Set([start.join(',')]); let steps;
  while (queue.length) {
    const [x,y,route] = queue.shift(); if (x === tx && y === ty) { steps = route; break; }
    for (const [dx,dy,action] of [[0,-1,'move_z'],[0,1,'move_s'],[-1,0,'move_q'],[1,0,'move_d']]) {
      const nx=x+dx,ny=y+dy,key=`${nx},${ny}`;
      if (seen.has(key) || coll[ny]?.[nx] !== 0 || blocked('centre',nx,ny) || ny===15) continue;
      seen.add(key);queue.push([nx,ny,[...route,{action,x:nx*32+16,y:ny*32+16}]]);
    }
  }
  assert(steps, `No path to ${tx},${ty}`);
  for (const step of steps) {
    await page.waitForTimeout(170); await page.evaluate(s=>v.socket.emit('playerAction',s.action),step);
    await page.waitForFunction(s=>v.players[v.socket.id].x===s.x&&v.players[v.socket.id].y===s.y,step);
  }
}
async function heal() {
  await walk(10,9);await page.evaluate(()=>v.espace());await page.locator('.dialogue-shell').waitFor();
  for(let n=0;n<12&&await page.locator('.dialogue-shell').count();n++){
    await page.locator('.dialogue-shell .text').click();await page.waitForTimeout(160);
  }
  await page.locator('.dialogue-shell').waitFor({state:'hidden'});
}
async function computer() {
  await walk(17,9);await page.evaluate(()=>v.espace());await page.locator('.pc-terminal').waitFor();
  await page.locator('[data-pc-loading]').waitFor({state:'hidden'});
  assert(await page.locator('.pc-team-member').count()>=2);
  await page.locator('.pc-team-member').last().click();await page.locator('[data-pc-deposit]').click();
  await page.waitForFunction(()=>!v.pc.busy);await page.locator('[data-pc-withdraw]').click();
  await page.waitForFunction(()=>!v.pc.busy);assert.equal(await page.locator('.pc-feedback-error').count(),0);
  await page.locator('.pc-close').click();
}
(async()=>{try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const res=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'center_'+randomUUID(),password:randomUUID(),starterId:7})});
  assert.equal(res.status,201);const fixture=await res.json();userId=fixture.user.id;
  const team=await teamRepo.loadEquipe(userId);team.pokemons.push(factory.create(4,12,true));
  team.pokemons[0].currentHp=1;team.pokemons[0].status='poison';team.pokemons[0].movePp[0]=0;
  await teamRepo.editEquipe(userId,team);await pcRepo.storeCapturedPokemon(userId,factory.create(25,10,true));
  await dbPool.execute("UPDATE users SET map='centre',x=432,y=464 WHERE id=?",[userId]);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
  await context.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
  await page.locator('.menu-toggle-btn').click();await page.locator('.menu-toggle-btn').click();
  await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:35}));
  await page.waitForFunction(()=>{const a=v._worldMusic?.tracks.get('center');return a&&!a.paused&&a.readyState>=2&&a.currentTime>0;});
  const audio=await page.evaluate(()=>{const a=v._worldMusic.tracks.get('center');return{src:a.src,duration:a.duration,volume:a.volume,loop:a.loop};});
  assert(audio.src.includes('center.'));assert(audio.duration>10);assert(Math.abs(audio.volume-.077)<.001);assert(audio.loop);
  assert.equal(await page.evaluate(()=>v.worldNightActive),false);
  for(const[width,height]of [[320,568],[393,852],[1365,900]]){
    await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<1000,width);await page.waitForTimeout(250);
    await page.screenshot({path:path.join(out,`center-${width}.png`)});
  }
  await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);
  await heal();const healed=(await teamRepo.loadEquipe(userId)).pokemons[0];
  assert(healed.currentHp>1);assert(healed.movePp[0]>0);assert.notEqual(healed.status,'poison');
  await page.screenshot({path:path.join(out,'nurse.png')});await computer();
  await page.screenshot({path:path.join(out,'computer.png')});
  await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();
  await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
  const player=cleanup.runtime.playerFor(fixture.user);
  Object.assign(player,{currentmap:'centre',x:432,y:464,centerReturnPoint:{map:'ville5',x:144,y:240}});
  player.equipe.pokemons.push(factory.create(7,12,true));player.equipe.pokemons[0].currentHp=1;
  await page.reload({waitUntil:'networkidle'});await ready();await heal();assert(player.equipe.pokemons[0].currentHp>1);
  await computer();await walk(13,14);await page.waitForTimeout(180);await page.evaluate(()=>v.socket.emit('playerAction','move_s'));
  await page.waitForFunction(()=>v.map==='ville5'&&v.renderedMap==='ville5'&&!v.mapLoading);
  assert.equal(await page.evaluate(()=>v._worldMusic.tracks.get('center')?.paused),true);
  assert.deepEqual(errors,[]);success=true;
  console.log(JSON.stringify({adventureHeal:true,expeditionHeal:true,pcDepositWithdrawBothModes:true,returnToBlanchecime:true,centerMusic:audio,viewports:3,errors,out}));
}finally{
  if(!success&&page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));
  if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});

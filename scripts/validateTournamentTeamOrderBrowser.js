// Real registration, team arrows, owned SQL snapshots and room transitions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/superTournamentRepository'),teams=require('../server/persistence/teamRepository');
const factory=require('../server/game/drift/pokemonFactory'),content=require('../server/game/superTournament/content');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-order-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-order-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,base,user,success=false;const users=[],errors=[],views=[],checks=[];
const ids=team=>team.map(p=>p.uuid),bank=team=>Object.fromEntries(team.map(p=>[p.uuid,JSON.parse(JSON.stringify(p))]));
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&!v.flight&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function open(width,height){context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));}
async function close(){await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(8000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function openTeam(){await page.locator('.team-toggle-btn').click();await page.locator('.team-row').first().waitFor();await page.waitForFunction(()=>!v.teamLoading);}
async function assertOrder(expected){await page.waitForFunction(expected=>[...document.querySelectorAll('[data-team-uuid]')].map(n=>n.dataset.teamUuid).join('|')===expected.join('|'),expected);assert.equal(await page.locator('.team-error').count(),0);assert.equal(await page.locator('.team-row [data-pokemon-gender]').count(),expected.length);assert.deepEqual(ids((await repo.load(user.user.id)).run.player.equipe.pokemons),expected);}
async function move(index,delta){
 const before=await page.locator('[data-team-uuid]').evaluateAll(nodes=>nodes.map(n=>n.dataset.teamUuid)),next=before.slice(),to=index+delta;[next[index],next[to]]=[next[to],next[index]];
 const button=page.locator('.team-row').nth(index).locator('.team-order-btn').nth(delta<0?0:1);await button.scrollIntoViewIfNeeded();if(page.viewportSize().width<1000)await button.tap();else await button.click();await page.waitForFunction(()=>!v.teamSaving);await assertOrder(next);return next;
}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height]of [[320,480],[393,852],[1365,900]]){
  const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'party_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();users.push(user);
  await teams.editEquipe(user.user.id,{pokemons:[9,94,212,248,445,121].map(id=>{const p=factory.create(id,100,true);p.abilities=['Tackle','Protect'];p.movePp=[3,0];p.heldItem='leftovers';return p;})});
  for(const[key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.user.id,key,value]);assert(await repo.grantPass(user.user.id));
  await db.execute('UPDATE users SET map=?,x=432,y=272 WHERE id=?',[content.MAPS.lobby,user.user.id]);await open(width,height);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('.tournament-panel .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);await ready();
  const adventureBefore=JSON.stringify(await teams.loadEquipe(user.user.id));await openTeam();const sasOrder=await move(1,-1);assert.equal(await page.locator('.team-order-btn').first().isDisabled(),true);await page.screenshot({path:path.join(out,`sas-${width}.png`)});await close();
  // Durable test-owned fixture: damaged party, one KO and exhausted PP, before a duel.
  let saved=await repo.load(user.user.id),party=saved.run.player.equipe.pokemons;party[0].currentHp=12;party[0].status='poison';party[0].movePp=[1,0];party[5].currentHp=0;party[5].status='burn';saved.run.phase='ready';const resources=bank(party);await repo.save(user.user.id,saved.run,saved.version);
  await db.execute('UPDATE users SET map=?,x=448,y=528 WHERE id=?',[content.MAPS.room,user.user.id]);await open(width,height);await openTeam();await assertOrder(sasOrder);let duelOrder=await move(2,-1);duelOrder=await move(5,-1);assert.deepEqual(bank((await repo.load(user.user.id)).run.player.equipe.pokemons),resources);await page.screenshot({path:path.join(out,`duel-${width}.png`)});
  for(const orderedUuids of [duelOrder.slice(1),[...duelOrder.slice(0,-1),duelOrder[0]],[...duelOrder.slice(0,-1),'foreign']])assert(!(await command('superTournament:reorderTeam',{orderedUuids})).success);
  assert(!(await command('reorderTeam',{orderedUuids:duelOrder.slice().reverse()})).success);await assertOrder(duelOrder);assert.equal(JSON.stringify(await teams.loadEquipe(user.user.id)),adventureBefore);await page.locator('.team-close').click();await close();
  // Reconnect after a cleared-room fixture, then use the actual north-door transition.
  saved=await repo.load(user.user.id);saved.run.phase='cleared';saved.run.cleared=1;saved.run.score=300;await repo.save(user.user.id,saved.run,saved.version);await open(width,height);await openTeam();await assertOrder(duelOrder);await page.locator('.team-close').click();
  for(let n=0;n<12;n++){await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForTimeout(160);}
  await page.waitForFunction(()=>v.superTournament.room===2&&v.players[v.socket.id].y>=480&&!v.mapLoading);await ready();await openTeam();await assertOrder(duelOrder);saved=await repo.load(user.user.id);assert.equal(saved.run.room,1);assert.equal(saved.run.phase,'ready');assert.deepEqual(bank(saved.run.player.equipe.pokemons),resources);assert.equal(JSON.stringify(await teams.loadEquipe(user.user.id)),adventureBefore);await page.locator('.team-close').click();
  assert((await command('superTournament:abandon',{})).success);await page.waitForFunction(()=>!v.superTournament.active&&v.map==='super_tournament_lobby');await close();
  // Normal Adventure team ordering still uses its own persistence path after the run.
  await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await open(width,height);await openTeam();const original=ids((await teams.loadEquipe(user.user.id)).pokemons),button=page.locator('.team-row').nth(1).locator('.team-order-btn').first();await button.scrollIntoViewIfNeeded();await button.click();await page.waitForFunction(()=>!v.teamSaving);const expected=original.slice();[expected[0],expected[1]]=[expected[1],expected[0]];assert.deepEqual(ids((await teams.loadEquipe(user.user.id)).pokemons),expected);assert.equal(await page.locator('.team-error').count(),0);await close();views.push({width,height});
 }
 checks.push('Real team arrows save in SAS and duel room on touch and desktop, including the sixth Pokémon');
 checks.push('Reconnection and actual transition to the next room retain order, HP, status, zero PP, items and KO members');
 checks.push('Foreign/duplicate/incomplete orders and ordinary Adventure mutations are blocked during the run; Adventure ordering works after abandonment');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false,phaseFixtures:['ready','cleared']},null,2));console.log(JSON.stringify({success,engine,views,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1500)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

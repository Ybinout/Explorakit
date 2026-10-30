// Actual lobby -> SAS -> duel route, with native desktop and mobile contexts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test DB required');process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright'),{dbPool:db}=require('../server/config/database');
const repo=require('../server/persistence/superTournamentRepository'),teamRepo=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-sea-dist',out='/tmp/riftmon-tournament-sea-browser-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,id,user,base,success=false;const errors=[],scenes=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function open(width,height){if(context){await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);}context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:true}));}
async function walk(n){for(let i=0;i<n;i++){await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForTimeout(160);}}
async function review(map){
 const layouts=[];
 for(const[width,height]of [[393,852],[1365,900]]){
  await open(width,height);await page.waitForFunction(map=>v.map===map&&v._placeAmbience?.tournamentLobby?.map===map&&v._placeAmbience.tournamentLobby.frames>1,map);
  assert.equal(await page.evaluate(()=>v.showMobileControls),width<1000);
  const start=await page.evaluate(()=>({frames:v._placeAmbience.tournamentLobby.frames,image:v._placeAmbience.tournamentLobby.canvas.toDataURL(),x:v.players[v.socket.id].x,y:v.players[v.socket.id].y}));await page.waitForTimeout(350);
  const end=await page.evaluate(()=>({frames:v._placeAmbience.tournamentLobby.frames,image:v._placeAmbience.tournamentLobby.canvas.toDataURL(),x:v.players[v.socket.id].x,y:v.players[v.socket.id].y}));assert(end.frames>start.frames);assert.notEqual(end.image,start.image);assert.equal(end.x,start.x);assert.equal(end.y,start.y);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,map+'-'+width+'.png')});layouts.push({width,height});
 }
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(100);const stopped=await page.evaluate(()=>v._placeAmbience.tournamentLobby.frames);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>v._placeAmbience.tournamentLobby.frames),stopped);
 await page.evaluate(()=>{window.oldSurfaces=v._placeAmbience.tournamentLobby.layers.flatMap(l=>[l.canvas,l.texture,l.skyMask,l.waterMask,l.water]);Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>oldSurfaces.every(s=>s.width===0)));
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));v.updatePreferences({...v.preferences,animationsEnabled:true});});await page.waitForFunction(()=>v._placeAmbience.tournamentLobby.canvas);scenes.push({map,layouts,animation:true,positionPreserved:true,reducedMotion:true,hiddenCleanup:true});
}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')),'Build first');server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'scenery_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();id=user.user.id;await teamRepo.editEquipe(id,{pokemons:[factory.create(9,100,true)]});
 for(const[key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);await repo.grantPass(id);await db.execute("UPDATE users SET map='super_tournament_lobby',x=432,y=272 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});await review('super_tournament_lobby');
 await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="entry"]').waitFor();await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);await review('super_tournament_sas');
 await walk(11);await page.waitForFunction(()=>v.map==='super_tournament_room'&&!v.mapLoading);await review('super_tournament_room');
 await walk(12);assert.equal(await page.evaluate(()=>v.map),'super_tournament_room');assert.equal((await repo.load(id)).run.phase,'ready');
 const ended=await page.evaluate(()=>new Promise(resolve=>v.socket.emit('superTournament:abandon',{},resolve)));assert.equal(ended.success,true);await page.waitForFunction(()=>v.map==='super_tournament_lobby'&&!v.superTournament.active);
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,scenes,registration:true,realNorthDoor:true,unclearedGateStillLocked:true,abandon:true,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,scenes,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1500)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

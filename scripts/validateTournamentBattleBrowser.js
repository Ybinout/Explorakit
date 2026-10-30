// Compiled client, real Socket/SQL tournament and explicit read-only scenery probes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/superTournamentRepository'),teams=require('../server/persistence/teamRepository');
const factory=require('../server/game/drift/pokemonFactory'),content=require('../server/game/superTournament/content');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),original=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=original(options);controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-battle-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-battle-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));
app.use('/__qa_src',express.static(path.resolve(__dirname,'../vue-explorakit/src/services')));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,context,page,user,id,base,success=false;const errors=[],views=[],canvases=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&!v.flight&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function command(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(count){for(let i=0;i<count;i++){await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForTimeout(160);}await ready();}
async function open(width,height){
 if(context){await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});
 await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:true}));
}
async function battleReady(){await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay?.canChooseAction&&document.querySelector('[data-tournament-battle-scenery]')?.width>0,null,{timeout:20000});}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')),'Build first');server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'battle_sky_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();id=user.user.id;
 await teams.editEquipe(id,{pokemons:[9,94,212,248,445,121].map(id=>factory.create(id,100,true))});
 for(const[key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);
 await repo.grantPass(id);await db.execute("UPDATE users SET map='super_tournament_lobby',x=432,y=272 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});
 for(const [width,height] of [[393,852],[1365,900],[844,390],[320,480]]){
  await open(width,height);
  if(!views.length){
   await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view=entry]').waitFor();await page.locator('.tournament-panel footer .primary').click();
   await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);await ready();await walk(11);assert.equal(await page.evaluate(()=>v.map),content.MAPS.room);
   await walk(6);await page.evaluate(()=>v.socket.emit('Space'));
  }
  await battleReady();
  const layout=await page.evaluate(()=>{
   const b=v.$refs.battleOverlay,img=document.querySelector('[data-battle-environment="super-tournament"] img'),c=document.querySelector('[data-tournament-battle-scenery]');
   const scene=b.$refs.battleScene.getBoundingClientRect(),overlay=c.getBoundingClientRect(),disc=document.querySelector('[data-battle-platform=wild]').getBoundingClientRect(),anchor=b.$refs.opponentAnchor.getBoundingClientRect();
   return{environment:b.environment,src:img.currentSrc,loaded:img.complete&&img.naturalWidth>0,kind:c.__vue__._kind,
    canvas:[c.width,c.height],backgroundFit:getComputedStyle(img).objectFit,scene:[scene.x,scene.y,scene.width,scene.height],overlay:[overlay.x,overlay.y,overlay.width,overlay.height],
    platformOffset:Math.abs(disc.x-anchor.x)+Math.abs(disc.y-anchor.y),platformCount:b.$el.querySelectorAll('[data-battle-platform]').length,
    overflow:document.documentElement.scrollWidth>innerWidth+1,canvasImage:c.toDataURL(),framesAt:c.__vue__._paintAt};
  });
  assert.equal(layout.environment,'super-tournament');assert(layout.loaded);assert.equal(layout.backgroundFit,'fill');assert.deepEqual(layout.overlay,layout.scene);
  assert.equal(layout.platformOffset,0);assert.equal(layout.platformCount,1);assert.equal(layout.overflow,false);
  const expected=width<1000&&height>width?'mobile':'wide';assert.equal(layout.kind,expected);assert(layout.src.includes('tournament-'+expected+'-v1'));
  await page.waitForTimeout(250);assert(await page.evaluate(before=>{const c=document.querySelector('[data-tournament-battle-scenery]');return c.__vue__._paintAt>before.framesAt&&c.toDataURL()!==before.canvasImage;},layout));
  await page.screenshot({path:path.join(out,`${width}-battle.png`)});views.push({width,height,kind:layout.kind,canvas:layout.canvas,enemyPlatformOnly:true,platformAligned:true});
 }
 // Check every rendered pixel over many flight positions, not just the frame bounds.
 for(const kind of ['wide','mobile']){
  const check=await page.evaluate(async kind=>{
   const {drawTournamentBattleSky,TOURNAMENT_BATTLE_SCENERY}=await import('/__qa_src/tournamentBattleSky.js'),p=TOURNAMENT_BATTLE_SCENERY[kind];
   const c=document.createElement('canvas');c.width=p.width/2;c.height=p.height/2;const ctx=c.getContext('2d',{willReadFrequently:true});
   const allowed=document.createElement('canvas');allowed.width=c.width;allowed.height=c.height;const ac=allowed.getContext('2d');ac.scale(.5,.5);ac.fillStyle='white';
   for(const rect of [...p.sky,...p.water])ac.fillRect(...rect);const mask=ac.getImageData(0,0,c.width,c.height).data;
   let escaped=0,birdFrames=0,pixels=0;const frames=new Set();
   for(let frame=0;frame<50;frame++){
    ctx.clearRect(0,0,c.width,c.height);drawTournamentBattleSky(ctx,frame*650,kind);const data=ctx.getImageData(0,0,c.width,c.height).data;let visible=0;
    for(let i=3;i<data.length;i+=4)if(data[i]){pixels++;if(!mask[i])escaped++;if(data[i-3]<100)visible++;}
    if(visible)birdFrames++;frames.add(c.toDataURL());
   }
   const start=performance.now();for(let i=0;i<120;i++){ctx.clearRect(0,0,c.width,c.height);drawTournamentBattleSky(ctx,i*50,kind);}const averagePaintMs=(performance.now()-start)/120;
   return{kind,escaped,birdFrames,pixels,frames:frames.size,averagePaintMs};
  },kind);
  assert.equal(check.escaped,0);assert(check.birdFrames>35);assert(check.frames>35);canvases.push(check);
 }
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForFunction(()=>document.querySelector('[data-tournament-battle-scenery]').width===0);
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));await battleReady();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('[data-tournament-battle-scenery]').width===0);await page.emulateMedia({reducedMotion:'no-preference'});await battleReady();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>document.querySelector('[data-tournament-battle-scenery]').width===0));
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await battleReady();
 const controller=controllers.get(id);await controller.execute(()=>controller.atomic(()=>{controller.run.battle.state.weather={kind:'rain',turns:0,persistent:true};controller.run.battle.sync();}));
 await page.waitForFunction(()=>v.$refs.battleOverlay.fieldState.weather==='rain');assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.environment),'super-tournament');await page.screenshot({path:path.join(out,'320-rain.png')});
 const environments=await page.evaluate(async()=>{const {battleEnvironment}=await import('/__qa_src/battleEnvironment.js');return ['start','cave1','ville1_arene','gen_arene5','ville_safe1_arene','ville3_arene','ville4_arene','ville5_arene','route2_maison'].map(m=>battleEnvironment(m));});
 assert.deepEqual(environments,['grass','cave','lake-gym','raph-gym','hoze-gym','ana-gym','wanda-gym','7p-gym','lucie-house']);
 await page.evaluate(()=>{window.oldTournamentCanvas=document.querySelector('[data-tournament-battle-scenery]');});assert((await command('superTournament:abandon')).success);
 await page.waitForFunction(()=>v.map==='centre'&&!v.battle&&!v.superTournament.active);assert(await page.evaluate(()=>oldTournamentCanvas.width===0&&oldTournamentCanvas.height===0&&!document.querySelector('[data-tournament-battle-scenery]')));
 assert.deepEqual(errors,[]);success=true;const result={success,engine,views,canvases,reducedMotion:true,hiddenCleanup:true,unmountCleanup:true,rainPreserved:true,otherEnvironmentsPreserved:true,errors,physicalHardware:false};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,battle:window.v?.battle,text:document.body.innerText.slice(-900)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

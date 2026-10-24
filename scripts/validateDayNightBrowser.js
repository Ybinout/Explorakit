// Actual Adventure and expedition clients, isolated accounts/database, server clock
// fixtures only. This never changes the host clock or a production player.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-daynight-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-daynight-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let fixtureTime=Date.parse('2026-10-24T21:00:00Z'),fixtureStart=performance.now();
const clock=require('../server/realtime/worldClock'),register=clock.registerWorldClock;
clock.registerWorldClock=socket=>register(socket,()=>fixtureTime+performance.now()-fixtureStart);
function phase(value){fixtureTime=Date.parse('2026-10-24T'+{day:'10:00',dawn:'05:00',dusk:'17:00',night:'21:00'}[value]+':00Z');fixtureStart=performance.now();for(const ns of [io,io.of('/drift')])ns.emit('worldClockState',{serverTime:fixtureTime,timeZone:'Europe/Paris'});}
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,success=false;const ids=[],errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const create=async()=>{const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'daynight_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();ids.push(f.user.id);return f;};
 const fixture=await create(),second=await create();
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 async function client(user,timezone){const c=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,timezoneId:timezone});await c.addInitScript(v=>localStorage.setItem('explorakit.user',JSON.stringify(v)),{...user.user,token:user.token});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});return p;}
 page=await client(fixture,'Pacific/Honolulu');const other=await client(second,'Asia/Tokyo');
 async function ready(p){await p.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v._worldClock?.synced||v.renderedMap!==v.map||v.mapLoading||!v.players[v.socket.id])return false;window.v=v;return true;});await p.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));}
 await Promise.all([page.goto(base+'/game',{waitUntil:'networkidle'}),other.goto(base+'/game',{waitUntil:'networkidle'})]);await ready(page);await ready(other);
 for(const p of [page,other]){assert.equal(await p.evaluate(()=>v.worldDaylight.phase),'night');await p.waitForFunction(()=>v._worldNight?.canvas);}
 assert(Math.abs(await page.evaluate(()=>v._worldClock.now())-await other.evaluate(()=>v._worldClock.now()))<500);
 phase('day');for(const p of [page,other])await p.waitForFunction(()=>v.worldDaylight.phase==='day'&&!v._worldNight?.canvas);
 phase('night');await page.waitForFunction(()=>v._worldNight?.canvas);await page.reload({waitUntil:'networkidle'});await ready(page);assert.equal(await page.evaluate(()=>v.worldDaylight.phase),'night');
 await other.close();
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready(page);
 assert(await page.evaluate(()=>v.isColosseum&&v.worldDaylight.phase==='night'));
 const player=cleanup.runtime.playerFor(fixture.user);
 async function locate(map){const repo=require('../server/game/world/mapRepository'),c=repo.loadCollisionData(map),changes=repo.changeMapData(map);const points=[];for(let y=1;y<c.length-1;y++)for(let x=1;x<c[y].length-1;x++)if(!c[y][x]&&!changes[y]?.[x])points.push([x,y]);points.sort((a,b)=>(a[0]-14)**2+(a[1]-11)**2-((b[0]-14)**2+(b[1]-11)**2));const[x,y]=points[0];Object.assign(player,{currentmap:map,x:x*32+16,y:y*32+16});cleanup.runtime.enter(fixture.user,{id:player.socketId});await page.waitForFunction(map=>v.map===map&&v.renderedMap===map&&!v.mapLoading,map);}
 const scenes=[['ville5','night'],['ville1','dusk'],['route4','night'],['route1','dawn'],['ville5','day']];
 for(const[map,light]of scenes){phase(light);await locate(map);await page.waitForFunction(light=>v.worldDaylight.phase===light,light);
  for(const[width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<1000,width);await page.waitForTimeout(180);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`${map}-${light}-${width}.png`)});}
 }
 phase('night');await locate('ville5');await page.waitForFunction(()=>v._worldNight?.canvas);await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(150);
 const frames=await page.evaluate(()=>v._worldNight.frames);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>v._worldNight.frames),frames);
 await page.evaluate(()=>{window.surface=v._worldNight.canvas;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>surface.width===0&&!v._worldNight.canvas));
 phase('day');await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>v.worldDaylight.phase==='day'&&!v._worldNight.canvas);
 phase('night');await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));
 for(const map of ['cave1','ville5_arene','route2_maison']){await locate(map);assert(await page.evaluate(()=>!v.worldNightActive&&!v._worldNight.canvas));}
 // The same battle component is used by all three modes; use a real expedition
 // encounter to verify frame/UI separation, then check gym/Colosseum isolation.
 await locate('route4');const lead=require('../server/game/drift/pokemonFactory').create(9,40,true);player.equipe.pokemons=[lead];
 const battle=cleanup.runtime.battle(player,{npc:true,equipe:{pokemons:[require('../server/game/drift/pokemonFactory').create(19,30,true)]},drifts:[],equipped:[],chain:0},'wild');battle.deadline=Date.now()+240000;
 await page.locator('.action-attack:enabled').waitFor();assert(await page.evaluate(()=>!v._worldNight.canvas));
 for(const light of ['night','day']){phase(light);await page.waitForFunction(light=>document.querySelector('.battle').dataset.dayPhase===light,light);await page.waitForTimeout(5200);
  for(const[width,height]of [[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<1000,width);await page.waitForTimeout(200);
   const info=await page.evaluate(()=>({scene:getComputedStyle(document.querySelector('.battle-background')).filter,hud:getComputedStyle(document.querySelector('.battle-status-wild')).filter,veil:getComputedStyle(document.querySelector('.battle-daylight-veil')).pointerEvents}));
   assert.equal(info.hud,'none');assert.equal(info.veil,'none');assert(light==='night'?info.scene!=='brightness(1)':info.scene==='brightness(1)');await page.screenshot({path:path.join(out,`battle-${light}-${width}.png`)});
  }
 }
 await page.evaluate(()=>v.$refs.battleOverlay.challenge={wave:1});assert.equal(await page.locator('[data-day-phase]').count(),0);await page.evaluate(()=>{v.$refs.battleOverlay.challenge=null;v.$refs.battleOverlay.battleMapName='ville5_arene';});assert.equal(await page.locator('[data-day-phase]').count(),0);
 battle.finished=true;
 // /drift serves both timed modes: the clock is namespace-level, independent of run state.
 const {io:connect}=require('../vue-explorakit/node_modules/socket.io-client');const socket=connect(base+'/drift',{autoConnect:false,auth:{token:second.token},transports:['websocket']});const state=new Promise(r=>socket.once('worldClockState',r));socket.connect();assert.equal((await state).timeZone,'Europe/Paris');socket.disconnect();
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventure:true,expedition:true,riftNamespace:true,timezoneIndependence:true,reconnect:true,hidden:true,reducedMotion:true,worldScreenshots:15,battleScreenshots:4,interiorIsolation:true,errors}));
}finally{if(!success&&page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,150));for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});

// Authenticated presence and real cross-mode connections in a disposable DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
const {dbPool}=require('../server/config/database'),{flightDestination}=require('../server/game/world/flightTravel');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-online-count-compact-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-online-count-compact-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
const made=[],sockets=[],errors=[];let browser,base,pageA,pageB,success=false;
async function ready(page){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.onlineVm=v;return true;});}
async function count(page,n){await page.waitForFunction(n=>window.onlineVm?.onlinePlayerCount===n,n);assert.equal((await page.locator('[data-online-count]').innerText()).trim(),String(n));}
async function raw(user,namespace='/drift'){
 const s=client(base+(namespace==='/drift'?'/drift':''),{auth:{token:user.token},autoConnect:false,transports:['websocket'],forceNew:true,reconnection:false});sockets.push(s);const event=once(s,namespace==='/drift'?'drift:bootstrap':'playersList');s.connect();await event;return s;
}
async function headers(page,mode){for(const[width,height]of[[320,480],[360,800],[393,852],[412,915],[844,390],[1365,900]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(150);
 for(const theme of['light','dark']){
  await page.evaluate(theme=>document.documentElement.setAttribute('data-game-theme-mode',theme),theme);
  for(const value of[3,1234]){
   await page.evaluate(value=>{window.onlineVm.onlinePlayerCount=value;},value);
   const check=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('.header-actions > *')],badge=document.querySelector('[data-online-count]'),bar=document.querySelector('.world-toolbar');return{badge:badge.getBoundingClientRect().toJSON(),bar:bar.getBoundingClientRect().toJSON(),rects:nodes.map(n=>n.getBoundingClientRect().toJSON()),overflow:bar.scrollWidth>bar.clientWidth+1};});
   const heights=await page.evaluate(()=>{const bar=document.querySelector('.world-toolbar'),height=bar.getBoundingClientRect().height,baseline=document.createElement('style');baseline.textContent='.online-player-count{display:none!important}.game-root .location-meta{display:contents!important}.game-root .location-meta .location-eyebrow{display:block!important}';document.head.append(baseline);const withoutCounter=bar.getBoundingClientRect().height;baseline.remove();return{height,withoutCounter};});
   assert(heights.height<=heights.withoutCounter+.5,JSON.stringify({mode,width,value,heights}));
   assert(!check.overflow,JSON.stringify({width,mode,check}));assert(check.badge.x>=0&&check.badge.right<=width+1);assert(check.badge.y>=check.bar.y-1&&check.badge.bottom<=check.bar.bottom+1);
   for(let i=1;i<check.rects.length;i++)assert(check.rects[i].left>=check.rects[i-1].right-1,JSON.stringify(check.rects));
   if(value===3)await page.screenshot({path:path.join(output,`${mode}-${theme}-${width}.png`)});
  }
 }
}await page.evaluate(()=>{window.onlineVm.onlinePlayerCount=3;});await page.setViewportSize({width:393,height:852});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(let i=0;i<3;i++){
  const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'count_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();made.push(u);const spawn=flightDestination(i===0?'ville1':'start');await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[spawn.map,spawn.x,spawn.y,u.user.id]);await dbPool.execute("INSERT INTO player_badges(user_id,badge_key) VALUES(?,'bloom_badge')",[u.user.id]);
 }
 const pages=[];for(const u of made.slice(0,2)){const c=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await c.addInitScript(s=>{if(/^https?:/.test(location.protocol))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));pages.push(p);}
 [pageA,pageB]=pages;await pageA.goto(base+'/game',{waitUntil:'networkidle'});await ready(pageA);await count(pageA,1);await pageB.goto(base+'/game',{waitUntil:'networkidle'});await ready(pageB);await Promise.all(pages.map(p=>count(p,2)));
 let third=await raw(made[2]);await Promise.all(pages.map(p=>count(p,3)));await headers(pageA,'adventure');
 third.disconnect();await Promise.all(pages.map(p=>count(p,2)));third=await raw(made[2]);await Promise.all(pages.map(p=>count(p,3)));
 const observations=[];await pageA.evaluate(()=>{window.countEvents=[];window.onlineVm.socket.on('presence:count',d=>window.countEvents.push(d.count));});
 third=await raw(made[2],'/');await count(pageA,3);observations.push(...await pageA.evaluate(()=>window.countEvents));assert(!observations.some(n=>n>3),'same account must never count twice');
 const invalid=client(base,{auth:{token:'invalid'},autoConnect:false,transports:['websocket'],reconnection:false});sockets.push(invalid);const refused=once(invalid,'connect_error');invalid.connect();assert.match((await refused)[0].message,/Session invalide/);await count(pageA,3);
 await pageA.evaluate(()=>window.onlineVm.socket.disconnect());await pageA.waitForFunction(()=>window.onlineVm.onlinePlayerCount===null);assert.equal((await pageA.locator('[data-online-count]').innerText()).trim(),'—');await count(pageB,2);await pageA.evaluate(()=>window.onlineVm.socket.connect());await ready(pageA);await count(pageA,3);
 await pageB.goto(base+'/colosseum',{waitUntil:'networkidle'});await pageB.locator('[data-colosseum-start]:enabled').click();await pageB.locator('[data-starter-choice]').first().click();await pageB.locator('.starter-backdrop').waitFor({state:'hidden'});await ready(pageB);await count(pageB,3);await count(pageA,3);await headers(pageB,'colosseum');
 await pageB.close();await count(pageA,2);third.disconnect();await count(pageA,1);assert.deepEqual(errors,[]);
 success=true;console.log(JSON.stringify({initialCountAndSelf:true,joinsLeavesAndReconnect:true,anonymousCountOnly:true,uniqueAccountsAcrossNamespaces:true,allModesAndLobby:true,invalidSessionExcluded:true,staleNumberClearedWhenOffline:true,fourDigitLayout:true,noAdditionalToolbarHeight:true,viewports:6,themes:2,errors,output}));
 }finally{sockets.forEach(s=>s.disconnect());await browser?.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);cleanup();await new Promise(r=>io.close(r));for(const u of made)await dbPool.execute('DELETE FROM users WHERE id=?',[u.user.id]);await dbPool.end();if(!success)console.error('Online count browser recipe failed');}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

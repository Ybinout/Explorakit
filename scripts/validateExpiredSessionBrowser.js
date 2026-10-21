// Only an isolated database and accounts created by this recipe are modified.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),repo=require('../server/persistence/teamRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-session-expired-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-session-expired-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io);
let browser,userId,page,success=false;const errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const password=randomUUID(),username='session_'+randomUUID(),r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['ville3',400,400,userId]);
 const before=JSON.stringify((await repo.loadEquipe(userId)).pokemons.map(p=>({uuid:p.uuid,id:p.data.id,hp:p.currentHp,xp:p.experience,iv:p.iv,k:p.k})));
 const expired=require('jsonwebtoken').sign({sub:String(userId),username},process.env.JWT_SECRET||'explorakit-local-development-secret-change-me',{expiresIn:-1});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const [route,destination]of [['/game','/game'],['/drift/game','/drift'],['/colosseum/game','/colosseum']]){
  const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(!sessionStorage.getItem('expired-fixture')){localStorage.setItem('explorakit.user',JSON.stringify(s));sessionStorage.setItem('expired-fixture','1');}},{...fixture.user,token:expired});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+route,{waitUntil:'networkidle'});await page.locator('[data-session-expired]').waitFor();assert.equal(new URL(page.url()).pathname,'/explorakit/connexion');assert.equal(new URL(page.url()).searchParams.get('redirect'),destination);assert.equal(await page.evaluate(()=>localStorage.getItem('explorakit.user')),null);assert.equal(await page.locator('.world-loading').count(),0);
  if(route==='/game'){
   for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.locator('[data-session-expired]').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`session-expired-${width}.png`)});}
   await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Continuer l’aventure →'}).click();
   await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;return v?.socket?.connected&&v.map==='ville3'&&v.renderedMap==='ville3'&&!v.mapLoading&&!v.mapLoadError;});assert.equal(new URL(page.url()).pathname,'/explorakit/game');assert.equal(await page.locator('.world-loading').count(),0);assert.equal(await page.locator('[data-session-expired]').count(),0);assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('explorakit.user')).token.length>50));await page.screenshot({path:path.join(output,'adventure-resumed.png')});
   // A transport failure is not an expired session and must retain credentials.
   await page.evaluate(()=>{const v=document.querySelector('.game-root').__vue__;v.socket.emitEvent(['connect_error',new Error('websocket error')]);});assert.equal(new URL(page.url()).pathname,'/explorakit/game');assert(await page.evaluate(()=>Boolean(localStorage.getItem('explorakit.user'))));
  }
  await context.close();
 }
 assert.equal(JSON.stringify((await repo.loadEquipe(userId)).pokemons.map(p=>({uuid:p.uuid,id:p.data.id,hp:p.currentHp,xp:p.experience,iv:p.iv,k:p.k}))),before);assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({realExpiredToken:true,adventure:true,rift:true,colosseum:true,explicitNotice:true,staleSessionCleared:true,realLoginReturnsToSavedMap:true,transportErrorKeepsSession:true,teamPreserved:true,viewports:4,errors,output}));
}finally{if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});

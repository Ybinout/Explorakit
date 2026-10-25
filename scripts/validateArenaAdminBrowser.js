// Disposable users only. The real fixed owner policy is checked in tests/arena-admin.test.js.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),policy=require('../server/game/world/arenaTests');
const progression=require('../server/persistence/progressionRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-arena-admin-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-arena-admin-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[],original=policy.isOwner;let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function options(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="options"]').click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'arena_browser_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 const admin=await create(),other=await create();policy.isOwner=u=>u?.id===admin.user.id&&u?.username===admin.user.username;
 for(const flag of ['route_guard_defeated','aspha_route2_defeated'])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)',[admin.user.id,flag,'true']);
 for(const c of policy.encounters)await progression.completeNpcBattle(admin.user.id,c.name);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 async function open(u,spoof=false){const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,username:spoof?'binout':u.user.username,admin:true,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await options();return context;}
 const ownerContext=await open(admin);await page.locator('[data-rearm-arenas]').scrollIntoViewIfNeeded();await page.locator('[data-rearm-arenas]').click();await page.waitForFunction(()=>!v.arenaTestBusy&&v.arenaTestState.ready===12);assert.match(await page.locator('[data-arena-admin]').innerText(),/12 rencontres réinitialisées/);
 for(const[width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<920,width);await page.locator('[data-rearm-arenas]').scrollIntoViewIfNeeded();await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const box=await page.locator('[data-rearm-arenas]').boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=width);await page.screenshot({path:path.join(out,`admin-${width}.png`)});}
 await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>v.arenaTestState.ready),12);await ownerContext.close();
 const strangerContext=await open(other,true);assert.equal(await page.locator('[data-arena-admin]').count(),0);const response=await page.evaluate(()=>new Promise(r=>v.socket.emit('admin:rearmArenas',{userId:4,admin:true},r)));assert.equal(response.success,false);await strangerContext.close();
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({ownerButton:true,rearmed:12,reconnect:true,spoofedNameDenied:true,viewports:3,errors,out}));
}finally{
 if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
 await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,150));policy.isOwner=original;
 for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});

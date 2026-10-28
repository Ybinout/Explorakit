// Real first adventure, map loading and first-exit dialogue on disposable SQL accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),terrain=require('../server/game/world/mapRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-opening-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-opening-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],screens=[],errors=[];let browser,page,context,base,passed=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function capture(name){await page.screenshot({path:path.join(out,name+'.png')});screens.push(name+'.png');}
async function walk(tx,ty){
 const p=await page.evaluate(()=>({map:v.map,x:Math.floor(v.players[v.socket.id].x/32),y:Math.floor(v.players[v.socket.id].y/32),pnjs:v.pnjs}));
 const tiles=terrain.loadCollisionData(p.map),q=[[p.x,p.y,[]]],seen=new Set();let route;
 for(const[x,y,s]of q){const key=x+':'+y;if(seen.has(key))continue;seen.add(key);if(x===tx&&y===ty){route=s;break;}for(const[dx,dy,action]of[[1,0,'move_d'],[-1,0,'move_q'],[0,1,'move_s'],[0,-1,'move_z']]){const nx=x+dx,ny=y+dy;if(tiles[ny]?.[nx]!==0||p.pnjs.some(n=>n.x===nx&&(n.y===ny||n.y-1===ny)))continue;q.push([nx,ny,[...s,[action,nx,ny]]]);}}
 assert(route,`No route in ${p.map} to ${tx},${ty}`);
 for(const[action,x,y]of route){await page.waitForTimeout(180);if(await page.evaluate(()=>v.showMobileControls))await page.locator('[data-direction="'+action.slice(-1)+'"]').tap();else await page.keyboard.press({move_d:'d',move_q:'q',move_z:'z',move_s:'s'}[action]);await page.waitForFunction(({x,y,map})=>v.map!==map||(v.players[v.socket.id].x===x*32+16&&v.players[v.socket.id].y===y*32+16),{x,y,map:p.map});if(await page.evaluate(map=>v.map!==map,p.map))break;}
 await ready();
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const[width,height]of[[320,568],[393,852],[844,390],[1365,900]]){
  const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'opening_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const user=await response.json();ids.push(user.user.id);
  const teams=require('../server/persistence/teamRepository'),team=await teams.loadEquipe(user.user.id);team.pokemons[0].currentHp=3;team.pokemons[0].movePp[0]=1;await teams.editEquipe(user.user.id,team);
  context=await browser.newContext({viewport:{width,height},hasTouch:width<=920,isMobile:width<=920,reducedMotion:width===844?'reduce':'no-preference'});
  await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
  if(width===320)await page.route(/\/img\/etage\.[^/]+\.png/,async route=>{await new Promise(r=>setTimeout(r,2400));await route.continue();});
  await page.goto(base+'/game',{waitUntil:'domcontentloaded'});await page.locator('[data-adventure-opening]').waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('[data-adventure-opening]');return el&&Number(getComputedStyle(el).opacity)===1;});
  assert(await page.locator('.game-layout').evaluate(el=>el.inert));await capture('black-'+width);
  if(width===320)assert(await page.evaluate(()=>document.querySelector('.game-root').__vue__.mapLoading),'slow image must remain covered');
  await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;return v?.progressionState?.flags?.adventure_opening==='awake'&&!v.openingScene;});await ready();
  assert.equal(await page.evaluate(()=>v.map),'etage');assert.deepEqual(await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y})),{x:592,y:336});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await capture('bed-'+width);
  await walk(8,16);assert.equal(await page.evaluate(()=>v.map),'maison');await walk(8,15);assert.equal(await page.evaluate(()=>v.map),'start');
  await page.waitForFunction(()=>v.endSentences==='adventure_mother_departure'&&v.textImageSequence.length>0);await capture('mother-'+width);
  const pos=await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y}));await page.keyboard.press('d');await page.waitForTimeout(180);assert.deepEqual(await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y})),pos);
  if(width===393){await page.reload({waitUntil:'networkidle'});await ready();await page.waitForFunction(()=>v.endSentences==='adventure_mother_departure'&&v.textImageSequence.length>0);}
  for(let i=0;i<20;i++){if(!await page.evaluate(()=>v.textImageSequence.length))break;await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(80);}
  await page.waitForFunction(()=>v.progressionState.flags.adventure_opening==='complete');const saved=await teams.loadEquipe(user.user.id);assert.equal(saved.pokemons[0].currentHp,3);assert.equal(saved.pokemons[0].movePp[0],1);
  await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.locator('[data-adventure-opening]').count(),0);assert.equal(await page.evaluate(()=>v.textImageSequence.length),0);
  await context.close();context=null;
 }
 assert.deepEqual(errors,[]);passed=true;const result={newAdventureBed:true,slowImageCovered:true,movementLocked:true,realStairsAndExit:true,automaticMother:true,noHealing:true,resumeDialogue:true,noRepeatOnReconnect:true,reducedMotion:true,viewports:4,screens,errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 if(!passed&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,opening:document.querySelector('.game-root')?.__vue__?.openingScene,text:document.body.innerText.slice(-1200)})).catch(()=>null));}
 await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});

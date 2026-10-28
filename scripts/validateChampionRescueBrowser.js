// Read-only conversations on disposable, pre-progressed accounts; no real saves.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const progression=require('../server/persistence/progressionRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-opening-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-story-continuity-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,base,passed=false;const errors=[],screens=[],observed=[];
const champions=[['moon','ville1_arene'],['champion_hoze','ville_safe1_arene'],['champion_raphael','gen_arene5'],['champion_ana','ville3_arene'],['champion_wanda','ville4_arene'],['champion_7p','ville5_arene']];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function leave(){if(await page.locator('.game-root').count()){await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(150);}await page.goto('about:blank');}
async function at(map){await leave();await db.execute('UPDATE users SET map=?,x=432,y=176 WHERE id=?',[map,user.user.id]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
async function finish(){for(let i=0;i<20;i++){if(!await page.evaluate(()=>v.textImageSequence.length))return;await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(80);}assert.fail('Dialogue did not finish');}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'cs_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);user=await response.json();
 for(const name of ['dia1','aspha_route2',...champions.map(([name])=>name)])assert((await progression.completeNpcBattle(user.user.id,name)).granted,name);
 for(const [name]of champions)await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[user.user.id,'arena_entry:'+name]);
 const before=await progression.loadProgressState(user.user.id);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 for(const rescued of [false,true]){
  await leave();if(rescued)await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'lucie_rescued','true') ON DUPLICATE KEY UPDATE flag_value='true'",[user.user.id]);
  for(const [name,map]of champions){
   await at(map);await page.evaluate(()=>v.triggerMobileActionA());await page.waitForFunction(expected=>v.endSentences===expected&&v.textImageSequence.length>0,name+(rescued?'_rescued':'_after'));
   const text=await page.evaluate(()=>v.textImageSequence.map(s=>s.text).join('\n'));observed.push({name,rescued,dialogue:await page.evaluate(()=>v.endSentences)});
   if(name==='champion_wanda')assert(!text.includes('Gwenn'));
   if(rescued)assert(!/personne ici ne l’a revue|pourrait être en grand danger|Voici sa clé/.test(text));
   await page.waitForFunction(()=>[...document.querySelectorAll('.dialogue-layer img')].every(img=>img.complete&&img.naturalWidth>0));
   if(rescued&&['champion_ana','champion_wanda','champion_7p'].includes(name)){
    for(const [width,height]of[[320,568],[393,852],[844,390],[1365,900]]){
     await page.setViewportSize({width,height});await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(150);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=name+'-'+width+'.png';await page.screenshot({path:path.join(out,file)});screens.push(file);
    }
    await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{v.showMobileControls=true;});
   }
   await finish();assert.equal(await page.evaluate(()=>v.battle),false);
  }
 }
 await leave();const after=await progression.loadProgressState(user.user.id);assert.deepEqual(after.badges,before.badges);assert.equal(after.money,before.money);assert.deepEqual(after.completedNpcBattles,before.completedNpcBattles);
 assert.deepEqual(errors,[]);passed=true;const result={champions:6,conversations:observed,realActions:true,postRescueOnly:true,wandaNoGwenn:true,portraitsDecoded:true,noRepeatedRewards:true,viewports:4,screens,errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!passed&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,speech:window.v?.endSentences,text:document.body.innerText.slice(-1200)})).catch(()=>null));}await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,150));if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});

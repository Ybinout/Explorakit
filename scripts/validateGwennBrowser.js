const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-gwenn-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-gwenn-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[];let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function step(action){await page.evaluate(a=>v.socket.emit('playerAction',a),action);await page.waitForTimeout(400);}
async function dialogueDone(){for(let i=0;i<16&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(90);}}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'gw_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 const u=await create(),other=await create();await db.execute("UPDATE users SET map='ville4',x=720,y=560 WHERE id=?",[u.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Ice Beam','Aura Sphere','Shadow Ball','Recover'])lead.addAbility(move);await require('../server/persistence/teamRepository').editEquipe(u.user.id,{pokemons:[lead]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await ctx.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 async function at(map,x,y){const saved=await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));assert(saved.success);await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(200);await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);await page.reload({waitUntil:'networkidle'});await ready();}
 await step('move_z');assert.equal(await page.evaluate(()=>v.map),'ville4');assert.match(await page.evaluate(()=>v.progressionNotice?.message||v.interactionNotice||document.body.innerText),/clé|porte|Wanda/i);await page.screenshot({path:path.join(out,'door-locked.png')});
 await at('ville4',13,5);assert.equal(await page.evaluate(()=>v.personalGateActors.filter(p=>p.name==='gwenn_father').length),1);await step('move_z');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].y/32)),5);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='gwenn_father_locked'&&v.textImageSequence.length);await dialogueDone();await page.screenshot({path:path.join(out,'father.png')});
 // Wanda unlocks the father, but never grants the key on login.
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'wanda_defeated','true')",[u.user.id]);await at('ville4',22,17);
 let [keyRows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.user.id]);assert.equal(keyRows.length,0);
 const denied=await page.evaluate(()=>new Promise(resolve=>{v.socket.once('interactionRejected',resolve);v.socket.emit('onEndDialogue','gwenn_father');}));assert.equal(denied.reason,'invalid_or_expired_dialogue');
 await step('move_z');assert.equal(await page.evaluate(()=>v.map),'ville4');
 await at('ville4',13,5);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='gwenn_father'&&v.textImageSequence.length);
 [keyRows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.user.id]);assert.equal(keyRows.length,0,'key waits for authorized dialogue completion');
 await page.screenshot({path:path.join(out,'father-handover.png')});await dialogueDone();
 await page.waitForFunction(()=>v.progressionState?.flags?.gwenn_house_key_received==='true');
 [keyRows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.user.id]);assert.equal(keyRows[0].quantity,1);
 await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='gwenn_father_after'&&v.textImageSequence.length);await dialogueDone();
 [keyRows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.user.id]);assert.equal(keyRows[0].quantity,1);
 await at('ville4',22,17);
 await step('move_z');await page.waitForFunction(()=>v.map==='ville4_maison2'&&!v.mapLoading&&v.renderedMap===v.map);assert.deepEqual(await page.evaluate(()=>[Math.floor(v.players[v.socket.id].x/32),Math.floor(v.players[v.socket.id].y/32)]),[13,15]);
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<920,width);await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`house-${width}.png`)});}
 await step('move_s');await page.waitForFunction(()=>v.map==='ville4');assert.deepEqual(await page.evaluate(()=>[Math.floor(v.players[v.socket.id].x/32),Math.floor(v.players[v.socket.id].y/32)]),[22,17]);await step('move_z');await ready();
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);for(let i=0;i<5;i++)await step('move_z');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].y/32)),10);
 await page.evaluate(()=>{window.battleRequests=0;v.socket.on('requestAction',()=>battleRequests++);v.socket.emit('Space');});await page.waitForFunction(()=>v.endSentences==='gwenn_rochebrume'&&v.textImageSequence.length);await page.locator('.dialogue-layer .text').click();await page.screenshot({path:path.join(out,'gwenn-dialogue.png')});await dialogueDone();
 await page.waitForSelector('[data-arena-intro]');await page.waitForFunction(()=>document.querySelector('.entrance-portrait')?.naturalWidth>0);await page.screenshot({path:path.join(out,'gwenn-intro.png')});
 await page.waitForSelector('[data-battle-environment="gwenn-house"]');await page.waitForSelector('[data-battle-entrance]',{state:'detached',timeout:15000});
 for(const [width,height]of [[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<920,width);await page.waitForTimeout(150);assert.equal(await page.locator('[data-battle-platform]').count(),2);await page.screenshot({path:path.join(out,`fight-${width}.png`)});}
 await page.evaluate(()=>{v.socket.on('requestAction',()=>v.socket.emit('actionResponse',{action:'attack',number:0}));v.socket.emit('actionResponse',{action:'attack',number:0});});
 await page.waitForFunction(()=>!v.battle&&v.endSentences==='gwenn_rochebrume_after'&&v.textImageSequence.length,null,{timeout:90000});await dialogueDone();await page.waitForFunction(()=>v.battleResult);await page.evaluate(()=>v.dismissBattleResult());
 await page.waitForFunction(()=>!v.personalGateActors.some(p=>p.name==='gwenn_father'));const state=await require('../server/persistence/progressionRepository').loadProgressState(u.user.id);assert(state.flags.gwenn_rochebrume_defeated==='true');assert.equal(state.quests.find(q=>q.key==='gwenn_challenge').status,'completed');
 assert(require('../server/game/world/storyGates').snapshot(await require('../server/persistence/progressionRepository').loadProgressState(other.user.id)).find(g=>g.id==='gwenn_rochebrume_tunnel').locked);
 await at('ville4',13,5);assert.equal(await page.evaluate(()=>v.personalGateActors.filter(p=>p.name==='gwenn_father').length),0);await step('move_z');await step('move_z');await page.waitForFunction(()=>v.map==='cave_rochebrume1');await step('move_s');await page.waitForFunction(()=>v.map==='ville4');
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({lockedDoor:true,fatherKey:true,spoofedHandoverRejected:true,noKeyFromWanda:true,houseEntryExit:true,personalFather:true,realVictory:true,tunnelOpen:true,splashAndBackground:true,viewports:3,errors,out}));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,speech:window.v?.endSentences,notices:document.body.innerText.slice(-1000)})).catch(()=>null));}await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

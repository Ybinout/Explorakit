// Browser recipe with disposable SQL user only. Never touches the real binout account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),policy=require('../server/game/world/arenaTests');
const progression=require('../server/persistence/progressionRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-arena-scenes-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-arena-scenes-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[],original=policy.isOwner;let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function reveal(){await page.locator('.dialogue-layer .text').click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'scene_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);policy.isOwner=x=>x?.id===u.user.id&&x?.username===u.user.username;
 for(const flag of ['route_guard_defeated','aspha_route2_defeated'])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)',[u.user.id,flag,'true']);
 for(const c of policy.champions)await progression.completeNpcBattle(u.user.id,c.name);
 await db.execute("UPDATE users SET map='ville1_arene',x=432,y=528 WHERE id=?",[u.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Dark Pulse','Aura Sphere','Ice Beam','Recover'])lead.addAbility(move);
 await require('../server/persistence/teamRepository').editEquipe(u.user.id,{pokemons:[lead]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.waitForFunction(()=>v.endSentences==='arena_entry:moon'&&v.textImageSequence.length);
 await reveal();await page.screenshot({path:path.join(out,'welcome.png')});await reveal();await page.waitForFunction(()=>!v.textImageSequence.length);
 await page.reload({waitUntil:'networkidle'});await ready();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>v.textImageSequence.length),0);
 // Wanda's reward explanation comes after her story and next destination.
 const wanda=require('../data/game/interact.json').find(e=>e.name==='champion_wanda_after').sentences;
 assert.match(wanda.at(-1).text,/module Vol/);assert(wanda.slice(0,-1).every(s=>!/module Vol/.test(s.text)));
 // Check the longest actual authored paragraph, including short portrait phones and landscape.
 const entries=require('../data/game/interact.json'),longest=entries.flatMap(e=>e.sentences||[]).filter(s=>typeof s.text==='string').sort((a,b)=>b.text.length-a.text.length)[0];
 for(const[width,height]of [[320,568],[393,852],[844,390],[1214,1253],[1365,900],[1920,1080]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);await page.evaluate(({w,s})=>{v.showMobileControls=w<920;v.updateTextImageSequence([s],'guide');}, {w:width,s:longest});await reveal();await page.waitForTimeout(100);
  if(width>920){const a=await page.evaluate(()=>{const c=v.$refs.monCanvas.getBoundingClientRect(),d=document.querySelector('.dialogue-layer .text-with-image').getBoundingClientRect();return{canvas:{top:c.top,bottom:c.bottom,left:c.left,right:c.right},dialogue:{top:d.top,bottom:d.bottom,left:d.left,right:d.right}};});assert(a.canvas.bottom-a.dialogue.bottom>=0&&a.canvas.bottom-a.dialogue.bottom<=24,JSON.stringify(a));assert(a.dialogue.top>=a.canvas.top&&a.dialogue.left>=a.canvas.left&&a.dialogue.right<=a.canvas.right,JSON.stringify(a));}

  assert.equal(await page.locator('.dialogue-visible').innerText(),longest.text);
  const bounds=await page.locator('.dialogue-layer .text').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,h:el.clientHeight,scroll:el.scrollHeight};});
  assert(bounds.y>=0&&bounds.bottom<=height&&bounds.x>=0&&bounds.right<=width,JSON.stringify(bounds));assert(bounds.scroll<=bounds.h+1,'whole paragraph fits: '+JSON.stringify(bounds));
  await page.screenshot({path:path.join(out,`paragraph-${width}.png`)});
 }
 await page.evaluate(()=>{v.textImageSequence=[];v.socket.disconnect();});await page.waitForTimeout(200);
 await db.execute("UPDATE users SET map='ville1_arene',x=432,y=176 WHERE id=?",[u.user.id]);await require('../server/persistence/arenaTestRepository').rearm(u.user);
 await page.setViewportSize({width:393,height:852});await page.reload({waitUntil:'networkidle'});await ready();
 await page.evaluate(()=>{window.sceneFrame=()=>{const canvas=v.$refs.monCanvas,viewport=v.$refs.worldViewport,me=v.players[v.socket.id],rect=viewport.getBoundingClientRect();return{frame:{...v.worldFrame},canvas:[canvas.width,canvas.height],viewport:[rect.width,rect.height],player:{x:me.x,y:me.y,map:me.currentmap},transform:getComputedStyle(canvas).transform,filter:getComputedStyle(viewport).filter};};window.sceneBefore=sceneFrame();});
 await page.screenshot({path:path.join(out,'before-combat.png')});
 await page.evaluate(()=>{window.sceneEvents=[];v.socket.on('dialogue',d=>sceneEvents.push(d));v.socket.on('requestAction',()=>v.socket.emit('actionResponse',{action:'attack',number:0}));v.socket.emit('Space');});
 await page.waitForFunction(()=>v.endSentences==='moon'&&v.textImageSequence.length);
 // Finish the introductory dialogue through the real component; server launches the battle.
 for(let i=0;i<12&&await page.locator('.dialogue-layer .text').count();i++){await reveal();await page.waitForTimeout(60);}
 await page.waitForFunction(()=>sceneEvents.some(d=>d[1]==='moon_after'&&d[2]?.afterBattle),{timeout:30000});
 await page.waitForFunction(()=>!v.battle&&v.endSentences==='moon_after'&&v.textImageSequence.length&&!v.battleResult,{timeout:90000});
 await page.waitForTimeout(150);
 const framing=await page.evaluate(()=>({before:sceneBefore,after:sceneFrame(),backdropFilter:getComputedStyle(document.querySelector('.dialogue-backdrop')).backdropFilter}));
 fs.writeFileSync(path.join(out,'scene-frames.json'),JSON.stringify(framing,null,2));
 assert.deepEqual(framing.after,framing.before,'victory dialogue keeps exploration framing');
 assert.equal(framing.backdropFilter,'none','no backdrop blur/compositor magnification');
 assert(await page.evaluate(()=>Boolean(v.deferredBattleResult)));await reveal();await page.screenshot({path:path.join(out,'victory-dialogue.png')});
 for(let i=0;i<12&&await page.locator('.dialogue-layer .text').count();i++){await reveal();await page.waitForTimeout(60);}
 await page.waitForFunction(()=>Boolean(v.battleResult)&&!v.textImageSequence.length);await page.evaluate(()=>v.dismissBattleResult());assert.equal(await page.evaluate(()=>v.lock),false);
 // Stable framing and no filter also hold after resizing the victory dialogue.
 for(const [width,height]of [[320,568],[393,852],[844,390],[1214,1253],[1365,900],[1920,1080]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);await page.evaluate(async w=>{v.showMobileControls=w<920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(150);
  const before=await page.evaluate(()=>sceneFrame());
  await page.evaluate(()=>{v.postBattleDialogue=[[{text:'Réplique de victoire',imageName:'wanda.png'}],'champion_wanda_after',{afterBattle:true}];v.showPostBattleDialogue();});
  await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>sceneFrame()),before);
  assert.equal(await page.locator('.dialogue-backdrop').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
  await page.screenshot({path:path.join(out,`stable-dialogue-${width}.png`)});await page.evaluate(()=>{v.textImageSequence=[];});
 }
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({entry:true,persisted:true,fullParagraph:true,viewports:6,automaticVictoryBeforeRecap:true,stableVictoryFraming:true,noBackdropFilter:true,wandaFlightLast:true,movementUnlocked:true,errors,out}));
}finally{
 if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
 await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,150));policy.isOwner=original;
 for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});

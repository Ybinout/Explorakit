const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-raph-trial-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-raph-trial-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[];let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function step(action){await page.evaluate(a=>v.socket.emit('playerAction',a),action);await page.waitForTimeout(400);}
async function dialogueDone(){for(let i=0;i<16&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(90);}}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'raph_trial_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 const u=await create();await db.execute("UPDATE users SET map='gen_arene5',x=432,y=496 WHERE id=?",[u.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Ice Beam','Aura Sphere','Shadow Ball','Recover'])lead.addAbility(move);await require('../server/persistence/teamRepository').editEquipe(u.user.id,{pokemons:[lead]});
 for(const flag of ['hoze_defeated','arena_entry:champion_raphael'])await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'true')",[u.user.id,flag]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await ctx.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 async function at(map,x,y){const saved=await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));assert(saved.success);await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(200);await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);await page.reload({waitUntil:'networkidle'});await ready();}

 const raph=()=>page.evaluate(()=>{const p=v.pnjs.find(n=>n.name==='raphael');return {x:p.x,y:p.y};});
 const formats=[[393,852],[1365,900],[844,390],[320,568]];
 for(let step=1;step<=4;step++){
  const point=await raph();assert(point.y!==4);await at('gen_arene5',point.x,point.y+1);
  const [width,height]=formats[step-1];await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<=920,width);await page.waitForTimeout(150);
  if(step===4)await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
  await page.screenshot({path:path.join(out,`before-${width}.png`)});
  await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(step=>v._npcTeleport?.step===step,step);
  assert.equal(await page.locator('.dialogue-layer .text').count(),0,'pursuit must not start the battle dialogue');
  if(step<4){for(const [name,delay]of [['depart',90],['vanish',350],['arrive',250]]){await page.waitForTimeout(delay);await page.screenshot({path:path.join(out,`${name}-${width}.png`)});}}
  else{await page.screenshot({path:path.join(out,'reduced-motion.png')});assert.deepEqual(await raph(),{x:13,y:4});}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.waitForTimeout(1050);
 }
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));
 await at('gen_arene5',13,5);await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);
 await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='champion_raphael'&&v.textImageSequence.length);await page.screenshot({path:path.join(out,'final-dialogue.png')});await dialogueDone();
 await page.waitForSelector('[data-arena-intro]');await page.waitForFunction(()=>document.querySelector('.entrance-portrait')?.naturalWidth>0);await page.screenshot({path:path.join(out,'actual-battle-entrance.png')});await page.waitForSelector('[data-battle-entrance]',{state:'detached',timeout:15000});
 assert(await page.evaluate(()=>v.battle&&Boolean(v.$refs.battleOverlay)));
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({teleports:4,viewports:4,reconnectProgress:true,reducedMotion:true,finalOriginalPosition:true,actualDialogueAndBattle:true,errors,out}));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,speech:window.v?.endSentences,notices:document.body.innerText.slice(-1000)})).catch(()=>null));}await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

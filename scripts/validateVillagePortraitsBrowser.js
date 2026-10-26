// Real dialogues, trainer entrances and shared arena snow on disposable SQL accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),store=require('../server/game/world/pnjStore'),maps=require('../server/game/world/mapRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-village-polish-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-village-polish-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let clementVisibility=null;
const ids=[],errors=[],artifacts=[],formats=[[320,568],[393,852],[844,390],[1365,900]];let browser,page,context,base,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function create(map,x,y,flags={}){
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'village_art_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);
 await db.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=1000 WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);
 for(const[k,v]of Object.entries(flags))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)',[u.user.id,k,v]);
 return u;
}
async function open(u){await context?.close();context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
async function snap(label){for(const[width,height]of formats){await page.setViewportSize({width,height});await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(110);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=label+'-'+width+'.png';await page.screenshot({path:path.join(out,file)});artifacts.push(file);}await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{v.showMobileControls=true;});}
async function talk(key){await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(key=>v.endSentences===key&&v.textImageSequence.length>0,key);await page.locator('.dialogue-layer .text').click();}
function approach(actor){const c=maps.loadCollisionData(actor.map);const target=[[actor.x,actor.y+1],[actor.x-1,actor.y],[actor.x+1,actor.y]].find(([x,y])=>c[y]?.[x]===0&&!store.isPnjBlockingTile(actor.map,x,y));assert(target);return target;}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const[key,name,asset]of [['town_lina','Maria','maria-v2'],['town_bastien','Clément','clement-v2']]){
  const actor=store.getPnjsForMap('ville1').find(n=>n.name===key),[x,y]=approach(actor),u=await create('ville1',x,y);await open(u);
  const drawing=await page.evaluate(async key=>{
   const n=v.pnjs.find(n=>n.name===key),i=v.ensurePnjSpriteSheet(n.sprite);await i.decode();
   const c=document.createElement('canvas');c.width=896;c.height=640;const g=c.getContext('2d'),calls=[],draw=g.drawImage;
   g.drawImage=function(img,...args){calls.push(args);return draw.call(this,img,...args);};const old=v.pnjs;
   try{v.pnjs=[n];v.drawPnjs(g);}finally{v.pnjs=old;}
   return{sprite:n.sprite,width:i.naturalWidth,height:i.naturalHeight,args:calls[0]};
  },key);
  if(key==='town_lina'){assert.equal(drawing.width,1451,'Maria keeps the original world atlas');assert.equal(drawing.height,1155);}
  else{assert.equal(drawing.sprite,'clement-pixel-v1.png');assert.deepEqual([drawing.width,drawing.height],[32,32]);assert.deepEqual(drawing.args.slice(0,4),[0,0,32,32]);assert.deepEqual(drawing.args.slice(-2),[64,64]);
   clementVisibility=await page.evaluate(async({foreground,args})=>{
    const fg=new Image();fg.src=foreground;await fg.decode();const c=document.createElement('canvas');c.width=fg.width;c.height=fg.height;const g=c.getContext('2d');g.drawImage(fg,0,0);const front=g.getImageData(0,0,c.width,c.height).data;
    const actor=v.pnjs.find(n=>n.name==='town_bastien'),sprite=v.ensurePnjSpriteSheet(actor.sprite);await sprite.decode();const s=document.createElement('canvas');s.width=s.height=32;const sc=s.getContext('2d');sc.drawImage(sprite,0,0);const body=sc.getImageData(0,0,32,32).data;let opaque=0,hidden=0;
    for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(body[(y*32+x)*4+3]){opaque++;const fx=Math.floor(args[4]/2+x),fy=Math.floor(args[5]/2+y);if(front[(fy*c.width+fx)*4+3])hidden++;}return{opaquePixels:opaque,hiddenPixels:hidden,tile:[actor.x,actor.y],roamRadius:actor.roamRadius};
   },{foreground:'data:image/png;base64,'+fs.readFileSync(path.resolve(__dirname,'../vue-explorakit/src/assets/ville1_f.png')).toString('base64'),args:drawing.args});
   assert(clementVisibility.opaquePixels>250);assert.equal(clementVisibility.hiddenPixels,0,'No building foreground covers Clément');assert.equal(clementVisibility.roamRadius,0);
  }
  await snap(key+'-world');await talk(key);await page.waitForFunction(()=>document.querySelector('.dialogue-layer img')?.naturalWidth>0);assert.match(await page.locator('.dialogue-layer img').getAttribute('src'),new RegExp(asset));await snap(key+'-dialogue');
  await page.evaluate(()=>v.clearSequence());await page.locator('.portrait-ready').waitFor();assert.equal(await page.locator('.champion-heading h2').innerText(),name);assert.match(await page.locator('.entrance-portrait').getAttribute('src'),new RegExp(asset));await snap(key+'-entrance');
  await page.locator('.action-attack:enabled').waitFor();assert(await page.evaluate(()=>v.battle));
  await page.evaluate(key=>v.updateTextImageSequence([{text:'Une autre rencontre.',imageName:'townspeople.png',portraitFrame:{columns:8,rows:4,index:19}}],key+'_after'),key);await page.waitForFunction(()=>document.querySelector('.dialogue-layer img')?.naturalWidth>0);assert.match(await page.locator('.dialogue-layer img').getAttribute('src'),new RegExp(asset));await page.evaluate(()=>{v.textImageSequence=[];v.socket.disconnect();});
 }
 const prior=Object.fromEntries(require('../data/game/progression.json').storySteps.slice(0,7).map(s=>[s.flag,'true']));
 const u=await create('ville5_arene',13,5,prior);await open(u);await page.waitForFunction(()=>v._worldWeather?.budget.snow===240);assert.deepEqual(await page.evaluate(()=>v.effectiveWorldWeather),{wind:1,rain:0,snow:2});await snap('sevenp-snow');
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(100);const frames=await page.evaluate(()=>v._worldWeather.frames);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>v._worldWeather.frames),frames);await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));
 await talk('champion_7p');await page.evaluate(()=>v.clearSequence());await page.locator('.action-attack:enabled').waitFor();assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.fieldState?.weather),'hail');assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.musicKind),'7p');assert.equal(await page.locator('[data-battle-environment="7p-gym"]').count(),1);await snap('sevenp-battle-snow');
 assert.deepEqual(errors,[]);success=true;const result={actualDialogues:2,actualTrainerEntrances:2,mariaSpriteUnchanged:true,clementNativeSize:[32,32],worldScale:2,afterBattlePortraits:true,clementVisibility,arenaSnow:240,arenaBattleWeather:'hail',arenaThemePreserved:true,reducedMotion:true,viewports:4,artifacts,errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});

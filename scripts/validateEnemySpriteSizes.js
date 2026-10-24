// Render real assets through the shared combat component, on disposable SQL users.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const factory=require('../server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-enemy-size-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-enemy-size-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false;const errors=[],report=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sprite_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await page.waitForFunction(()=>{window.v=document.querySelector('.game-root')?.__vue__;return v?.socket?.connected&&!v.mapLoading;});
 await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:false,masterVolume:0});v.battle=true;window.b=v.$refs.battleOverlay;b.cancelEntrance();});
 const player={equipe:{pokemons:[factory.create(6,50,true)]}};
 for(const[width,height]of [[320,480],[320,568],[393,852],[844,390],[1365,900]])for(const mode of ['adventure','colosseum']){
  await page.setViewportSize({width,height});await page.evaluate(({width,mode})=>{v.showMobileControls=width<=920;b.challenge=mode==='colosseum'?{wave:10,name:'Champion'}:null;},{width,mode});
  for(const id of [1,25,95,130,208,321,373,445]){
   await page.evaluate(payload=>{b.updateBattleState(payload);},{player,wildPokemon:factory.create(id,50,true)});
   await page.waitForFunction(id=>{const i=document.querySelector('.battle-sprite-wild img');return i?.complete&&i.naturalWidth&&i.src.endsWith('/'+id+'.png')&&b.battleSpriteStyles.wild['--sprite-image-width'];},id);
   await page.waitForTimeout(35);
   const metrics=await page.evaluate(()=>{
    const img=document.querySelector('.battle-sprite-wild img'),box=img.getBoundingClientRect(),scene=document.querySelector('.battle-scene').getBoundingClientRect(),a=document.querySelector('.battle-sprite-wild').getBoundingClientRect();
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let l=c.width,r=0,t=c.height,bottom=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>8){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);bottom=Math.max(bottom,y)}
    const scale=box.width/c.width,opaque={x:box.x+l*scale,y:box.y+t*scale,width:(r-l+1)*scale,height:(bottom-t+1)*scale,bottom:box.y+(bottom+1)*scale};
    return{opaque,scene:{x:scene.x,y:scene.y,width:scene.width,height:scene.height},anchor:{x:a.x,y:a.y,width:a.width},geometry:window.b.getSpriteGeometry('wild'),player:window.b.getSpriteGeometry('player'),playerBase:document.querySelector('.battle-sprite-player').getBoundingClientRect().width,sourceExtent:Math.max(r-l+1,bottom-t+1)};
   });
   const{opaque:o,scene:s,anchor:a,geometry:g}=metrics;
   assert(Math.abs(Math.max(metrics.player.width,metrics.player.height)-metrics.playerBase)<1,'player size unchanged');
   assert(Math.abs(o.bottom-a.y)<1,'feet remain on platform');assert(Math.abs(g.width-o.width)<1&&Math.abs(g.height-o.height)<1,'effects use real visible bounds');
   assert(o.x>=s.x-1&&o.x+o.width<=s.x+s.width+1,`${id} horizontal crop ${width}/${mode}`);
   assert(o.y>=s.y-1,`${id} top crop ${width}x${height}/${mode}: ${o.y-s.y}`);
   if([1,25].includes(id))assert(Math.abs(Math.max(o.width,o.height)-a.width)<1,'small sprites unchanged');
   else assert(Math.max(o.width,o.height)>a.width*1.3,'large sprites must exceed old normalized extent');
   report.push({id,width,height,mode,visibleWidth:Math.round(o.width),visibleHeight:Math.round(o.height),oldExtent:Math.round(a.width)});
   if([208,321,373].includes(id)&&[320,393,1365].includes(width))await page.screenshot({path:path.join(output,`${mode}-${id}-${width}-${height}.png`)});
  }
 }
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({cases:report.length,errors,measurements:report}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});

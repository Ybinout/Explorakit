const fs=require('fs'),path=require('path'),assert=require('assert/strict'),express=require('express'),{chromium}=require('playwright');
const config=require('../data/game/hoze_collapse.json'),out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-hoze-collapse-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/hozeArena.js`);await page.evaluate(async config=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722';window.h=await import('/services/hozeArena.js');window.fx=await import('/services/hozeCollapse.js');window.r=new h.HozeArenaRenderer();window.source=new Image();source.src='/assets/ville_safe1_arene.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.state={...config,epoch:1,elapsedMs:0,receivedAt:0};window.render=(t,motion=true)=>{r.setCollapseState(state);c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);fx.drawHozeCeiling(c,state,t,motion);};render(0);},config);
const checks=await page.evaluate(()=>{
 const point=h=>{const[dx,dy]=h.cells?.[0]||[0,0];return [((h.x+dx)*16+8)*2,((h.y+dy)*16+8)*2];};
 const counts=[];for(const t of [0,11000,12600,15000,20000,30000,60000,120000]){render(t);let holes=0;const d=r.context.getImageData(0,0,896,640).data;for(const h of state.holes){const [x,y]=point(h),j=(y*896+x)*4;if(d[j+3]>200&&d[j]<100)holes++;}counts.push(holes);}
 const final=r.context.getImageData(0,0,896,640).data;let centre=0;for(let y=200;y<542;y++)for(let x=418;x<478;x++)if(final[(y*896+x)*4+3])centre++;
 const original=document.createElement('canvas');original.width=896;original.height=640;const oc=original.getContext('2d');oc.drawImage(source,0,0,896,640);
 const debris=document.createElement('canvas');debris.width=896;debris.height=640;const dc=debris.getContext('2d');fx.drawHozeCeiling(dc,state,11100,true);const dust=dc.getImageData(0,0,896,640).data;const falling=dust.some((n,i)=>i%4===3&&n>0);
 dc.clearRect(0,0,896,640);fx.drawHozeCeiling(dc,state,11100,false);const noMotionDebris=!dc.getImageData(0,0,896,640).data.some((n,i)=>i%4===3&&n);
 state={...state,epoch:2,elapsedMs:0,receivedAt:130000};render(130000);const reset=r.context.getImageData(0,0,896,640).data;const restored=state.holes.every(h=>{const j=(point(h)[1]*896+point(h)[0])*4;return reset[j+3]===0;});
 // Disabling animation cannot open future physical holes early.
 render(130100,false);const reduced=r.context.getImageData(0,0,896,640).data;const futureClosed=state.holes.every(h=>{const j=(point(h)[1]*896+point(h)[0])*4;return !(reduced[j+3]>200&&reduced[j]<100);});
 render(143000,false);const after=r.context.getImageData(0,0,896,640).data,hole=state.holes[0],j=(point(hole)[1]*896+point(hole)[0])*4;const reducedOpensOnTime=after[j+3]>200&&after[j]<100;
 const sink=document.createElement('canvas');sink.width=896;sink.height=640;const sc=sink.getContext('2d');sc.scale(2,2);fx.drawCollapsedFloor(sc,source,state,60000,false);
 const pixels=sc.getImageData(0,0,896,640).data;let escaped=0;const areas=[];
 for(let y=0;y<640;y++)for(let x=0;x<896;x++)if(pixels[(y*896+x)*4+3]){
  const tx=Math.floor(x/32),ty=Math.floor(y/32);
  if(!state.holes.some(h=>h.cells.some(([dx,dy])=>h.x+dx===tx&&h.y+dy===ty)))escaped++;
 }
 for(const h of state.holes){let area=0;for(let y=h.y*32;y<(h.y+h.height)*32;y++)for(let x=h.x*32;x<(h.x+h.width)*32;x++)if(pixels[(y*896+x)*4+3])area++;areas.push(area);}
 render(190000,false);const cached=r.faultFloor,oldFrames=r.frames;state={...state,revision:(state.revision||1)+1};render(190000,false);
 const revisionInvalidates=cached.width===0&&r.frames===oldFrames+1&&r.collapseElapsed>=60000;
 const surfaces=[r.canvas,r.repair,r.structures,r.faultFloor,...r.pillars.map(p=>p.texture)];r.suspend();return{counts,centre,escaped,areas,revisionInvalidates,falling,noMotionDebris,restored,futureClosed,reducedOpensOnTime,released:surfaces.every(s=>s.width===0)};
});assert.equal(checks.counts[0],0);assert.equal(checks.counts[1],0);assert.equal(checks.counts.at(-1),3);assert.equal(checks.centre,0);assert.equal(checks.escaped,0);assert.equal(new Set(checks.areas).size,3);assert(checks.revisionInvalidates);for(const k of ['falling','noMotionDebris','restored','futureClosed','reducedOpensOnTime','released'])assert(checks[k],k);
for(const t of [11000,12600,14000,60000]){await page.evaluate(t=>{r=new h.HozeArenaRenderer();state={...state,epoch:3,elapsedMs:0,receivedAt:0};render(t);},t);await page.screenshot({path:path.join(out,`collapse-${t}.png`)});}fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});

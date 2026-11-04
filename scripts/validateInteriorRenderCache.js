// Native Canvas parity, cache invalidation and cost in both browser engines.
// Export the previous services with git before running; never touches game data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),playwright=require('playwright');
const engine=process.env.PROFILE_BROWSER||'chromium',baseline=process.env.INTERIOR_BASELINE_SERVICES||'/tmp/riftmon-interiors-baseline-services',out=process.env.INTERIOR_CACHE_OUT||'/tmp/riftmon-interior-cache-'+engine;
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const app=express();app.use('/before/services',express.static(baseline));app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await playwright[engine].launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/services/pokemonComputer.js');await page.bringToFront();
  const result=await page.evaluate(async parityOnly=>{
   const modules={};for(const name of ['pokemonComputer','whitepeakScenery','tournamentLobbySky'])modules[name]=[await import('/before/services/'+name+'.js'),await import('/services/'+name+'.js')];
   const devices={map:'professor_lab',devices:[{kind:'corruption',family:'move',screen:{x:6,y:6}},{kind:'corruption',family:'ability',screen:{x:21,y:6}},{kind:'corruption',family:'type',screen:{x:6,y:11}},{kind:'corruption',family:'combat',screen:{x:21,y:11}},{kind:'pc',x:10,y:15}]};
   const fixtures=[{map:'professor_lab',asset:'professor_lab',kind:'lab'}, {map:'ville5_maison1',asset:'whitepeak_club',kind:'snow'},...['lobby','sas','room'].map(n=>({map:'super_tournament_'+n,asset:'super_tournament_'+n,kind:'sky'}))];
   const checks=[],costs=[],culling=[];let reuses=0,invalidations=0;
   for(const fixture of fixtures){
    const source=new Image();source.src='/assets/'+fixture.asset+'.png';await source.decode();
    const canvases=Array.from({length:2},()=>document.createElement('canvas'));
    const contexts=canvases.map(c=>c.getContext('2d'));
    const tracked=[];const create=()=>{const c=document.createElement('canvas');tracked.push(c);return c;};
    const oldSky=fixture.kind==='sky'?new modules.tournamentLobbySky[0].TournamentLobbySkyRenderer():null;
    const renderer=fixture.kind==='sky'?new modules.tournamentLobbySky[1].TournamentLobbySkyRenderer(create):fixture.kind==='lab'?new modules.pokemonComputer[1].PokemonComputerRenderer(create):{draw:(...args)=>modules.whitepeakScenery[1].drawWhitepeakSnow(...args.slice(0,4)),suspend:()=>{}};
    const draw=(index,time,motion,ratio)=>{
     const c=contexts[index];
     if(fixture.kind==='lab'){if(index===0)modules.pokemonComputer[0].drawPokemonComputers(c,devices,fixture.map,time,motion);else renderer.draw(c,devices,fixture.map,time,motion,ratio);}
     else if(fixture.kind==='snow'){if(index===0)modules.whitepeakScenery[0].drawWhitepeakSnow(c,fixture.map,time,motion);else renderer.draw(c,fixture.map,time,motion,ratio);}
     else (index===0?oldSky:renderer).draw(c,source,time,motion,fixture.map);
    };
    for(const ratio of [1,1.5,2]){
     for(const c of canvases){c.width=896*ratio;c.height=640*ratio;}
     for(const motion of [true,false])for(const time of [0,1000,1001,1100,1120,1800,11000]){
      for(let n=0;n<2;n++){const c=contexts[n];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvases[n].width,canvases[n].height);c.imageSmoothingEnabled=false;c.scale(ratio,ratio);c.drawImage(source,0,0,896,640);draw(n,time,motion,ratio);}
      const pixels=contexts.map(c=>c.getImageData(0,0,c.canvas.width,c.canvas.height).data);let changed=0,maxDelta=0,totalDelta=0;
      for(let i=0;i<pixels[0].length;i+=4){let differs=false;for(let k=0;k<3;k++){const delta=Math.abs(pixels[0][i+k]-pixels[1][i+k]);if(delta){differs=true;totalDelta+=delta;maxDelta=Math.max(maxDelta,delta);}}if(differs)changed++;}
      checks.push({map:fixture.map,ratio,motion,time,changed,maxDelta,totalDelta,pixels:pixels[0].length/4});
     }
    }
    if(fixture.kind==='snow')for(const x of [0,251,503]){
     const calls=[0,0];for(let n=0;n<2;n++){
      const canvas=canvases[n];canvas.width=896;canvas.height=640;const c=contexts[n];c.imageSmoothingEnabled=false;c.drawImage(source,0,0,896,640);
      const fill=c.fillRect.bind(c);c.fillRect=(...args)=>{calls[n]++;return fill(...args);};c.save();c.beginPath();c.rect(x,0,393,640);c.clip();
      if(n===0)modules.whitepeakScenery[0].drawWhitepeakSnow(c,fixture.map,1800,true);
      else modules.whitepeakScenery[1].drawWhitepeakSnow(c,fixture.map,1800,true,{x,y:0,visibleWidth:393,visibleHeight:640});
      c.restore();c.fillRect=fill;
     }
     if(canvases[0].toDataURL()!==canvases[1].toDataURL())throw Error('Snow culling changed visible pixels');
     if(calls[1]>=calls[0])throw Error('Snow culling did not remove hidden work');culling.push({x,before:calls[0],after:calls[1]});
    }
    // Both code paths use the same timestamps and unthrottled native context.
    for(const c of canvases){c.width=896;c.height=640;}
    const samples=[[],[]];for(let round=0;round<(parityOnly?0:6);round++)for(const n of round%2?[1,0]:[0,1]){
     const c=contexts[n];c.clearRect(0,0,896,640);c.imageSmoothingEnabled=false;const start=performance.now();
     for(let i=0;i<240;i++){c.clearRect(0,0,896,640);draw(n,100000+i*1000/60,true,1);}
     // Flush queued graphics work; same operation on both paths.
     canvases[n].toDataURL();samples[n].push((performance.now()-start)/240);
    }
    costs.push({map:fixture.map,before:samples[0],after:samples[1]});
    if(fixture.kind==='lab'){
     renderer.draw(contexts[1],devices,fixture.map,200900,true,1);
     let paints=0;const p=renderer.patch,original=p.paint;p.paint=(...args)=>{paints++;return original(...args);};renderer.draw(contexts[1],devices,fixture.map,201000,true,1);renderer.draw(contexts[1],devices,fixture.map,201001,true,1);if(paints!==1)throw Error('Unchanged vial pose recalculated');reuses++;
     renderer.draw(contexts[1],{map:fixture.map,devices:[]},fixture.map,201001,true,1);if(renderer.patch===p||p.canvas.width!==0||renderer.state.devices.length)throw Error('Removed device remained');invalidations++;
    }
    renderer.suspend();oldSky?.suspend();if(tracked.some(c=>c.width||c.height))throw Error('Surfaces leaked: '+fixture.map);
   }
   return{checks,costs,reuses,invalidations,culling};
  },Boolean(process.env.INTERIOR_PARITY_ONLY));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({engine,...result},null,2));
  for(const c of result.checks){if(c.map.startsWith('super_tournament'))assert.equal(c.changed,0,'Sky changed: '+JSON.stringify(c));else {assert(c.changed/c.pixels<.003,'Decoration changed beyond antialiasing: '+JSON.stringify(c));assert(c.maxDelta<=2,'Decoration shade changed: '+JSON.stringify(c));}}
  console.log(JSON.stringify({engine,frames:result.checks.length,reuses:result.reuses,invalidations:result.invalidations,costs:result.costs,maxChanged:Math.max(...result.checks.map(c=>c.changed)),culling:result.culling}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

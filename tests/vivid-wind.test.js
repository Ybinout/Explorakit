const test=require('node:test'),assert=require('node:assert/strict');
test('all nine jungles use maximum ambient wind without changing their combat weather',()=>{
 const climate=require('../data/game/map_weather.json');
 for(let n=1;n<=9;n++){assert.equal(climate['jungle'+n].ambience.wind,3);assert.equal(climate['jungle'+n].kind,'wind');assert.equal(climate['jungle'+n].ambience.rain,0);}
});
test('magical projectiles occupy their full flight, with clearly larger silhouettes and bounded timings',async()=>{
 const{moveVisual}=await import('../vue-explorakit/src/services/moveVisuals.js'),{MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js');
 const c=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)}),r=new MoveEffectRenderer({getContext:()=>c},{requestFrame:()=>0});r.resize(393,450);
 for(const name of ['Psyshock','Moonblast','Shadow Ball','Energy Ball','Aura Sphere','Sludge Bomb','Dazzling Gleam','Ice Beam']){const v=moveVisual({moveName:name});assert(v.visibilityScale>=1.4,name);assert(v.travelMs>=620&&v.travelMs<=800,name);assert(v.windupMs+v.travelMs+v.impactMs<=1900,name);}
 const path={startX:40,startY:380,targetX:320,targetY:170};r.setEffect({...moveVisual({moveName:'Shadow Ball'}),stage:'travel'},path);const orbs=[];c.ellipse=(...args)=>orbs.push(args);
 for(const progress of [.25,.5,.75,.95])r.projectile({x:320,y:170},progress);
 assert(orbs[0][0]<110);assert(Math.abs(orbs[1][0]-180)<1);assert(orbs[2][0]<300);assert(orbs[3][0]>310);assert(orbs.every(o=>o[2]>17),'core radius is visible even on a narrow phone');
 const particles=[];r.particle=(kind,x,y,size)=>particles.push({kind,x,y,size});r.setEffect({...moveVisual({moveName:'Psyshock'}),stage:'travel'},path);r.projectile({x:320,y:170},.5);assert(particles.filter(p=>p.size>8).length>=3,'Psyshock has three distinct substantial energy impacts');r.dispose();
});
test('jungle trees sway as whole root-anchored silhouettes, without moving translucent canopy shadows',async()=>{
 const{ForegroundWindRenderer,jungleTreeBend}=await import('../vue-explorakit/src/services/foregroundWind.js'),{build}=require('../scripts/generateWindTrees'),profiles=build();
 const surfaces=[],original=new Uint8ClampedArray(448*320*4);for(let i=0;i<448*320;i++)original.set([4,12,9,95],i*4);
 const cell=profiles.jungle1.foreground.cells[0][0],left=cell%28*16,top=Math.floor(cell/28)*16;original.set([80,60,30,255],((top+5)*448+left+5)*4);
 const create=()=>{const ops=[],c={width:0,height:0},ctx={imageSmoothingEnabled:false,drawImage(...a){ops.push(['draw',...a]);},clearRect(){},getImageData:()=>({data:original}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(frame){c.upload=new Uint8ClampedArray(frame.data);}};c.ops=ops;c.getContext=()=>ctx;surfaces.push(c);return c;};
 const r=new ForegroundWindRenderer(create),target={drawImage(){}},image={};r.draw(target,image,100,3,true,'jungle1');assert(r.jungleTrees.length>=2);assert.equal(r.base.upload[(100*448+100)*4+3],95);assert.equal(r.base.upload[((top+5)*448+left+5)*4+3],0);assert(r.atlas.upload.includes(255));
 const first=r.canvas.ops.filter(a=>a[1]===r.atlas);assert(first.length<150);assert(first.some(a=>a[6]!==0));
 const tree=r.jungleTrees[0],root=first.find(a=>a[3]===tree.atlasY+tree.height-4);assert.equal(root[6],tree.left,'root never slides');
 const frame=r.frames;r.draw(target,image,116,3,true,'jungle1');assert.equal(r.frames,frame);r.draw(target,image,1500,3,true,'jungle1');assert.equal(r.frames,frame+1);
 for(let n=1;n<=9;n++)assert.equal(profiles['jungle'+n].foreground.motion,'gale-tree');
 const a=jungleTreeBend(900,3,1),b=jungleTreeBend(900,3,2);assert.notEqual(a,b);assert(jungleTreeBend(0,3)>6);assert.equal(jungleTreeBend(1000,0),0);
 r.draw(target,image,1600,3,false,'jungle1');assert(surfaces.every(c=>!c.width&&!c.height));assert.equal(r.atlas,null);
});

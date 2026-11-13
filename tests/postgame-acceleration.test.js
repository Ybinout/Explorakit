const test=require('node:test'),assert=require('node:assert/strict');
const dc=require('../server/game/world/darkContinent');
function rng(seed=77){return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);}
test('successful plate drops give1/2/3 equally, retaining each zone probability and elite guarantee',()=>{
 for(const map of['jungle1','jungle2','jungle3','jungle9','DC2_44'])for(const elite of[false,true]){
  const random=rng(),hist=[0,0,0],total=15000,p={data:{type:['Water','Flying']},darkContinentEncounter:{version:1,map,kind:elite?'corrupted':'ordinary'}};
  let dropped=0;
  for(let n=0;n<total;n++){
   const plates=dc.loot(p,random,map).filter(i=>i.plateType),count=plates.reduce((sum,p)=>sum+p.quantity,0);
   if(!count)continue;dropped++;assert(count>=1&&count<=3);hist[count-1]++;
   assert(plates.every(i=>p.data.type.includes(i.plateType)));
  }
  assert(Math.abs(dropped/total-(elite?1:dc.lootProfile(map).plateChance))<.02,map);
  for(const count of hist)assert(Math.abs(count/dropped-1/3)<.025,JSON.stringify({map,elite,hist}));
 }
});
test('plate quantity boundaries cover all57 maps without altering crystal minima or chances',()=>{
 const maps=[...Array.from({length:9},(_,i)=>'jungle'+(i+1)),...require('../data/game/dark_continent2.json').maps.map(m=>m.mapName)];
 for(const map of maps)for(const roll of[0,1/3,2/3,.999999]){
  const p={data:{type:['Water']}},sequence=[];
  for(const[,chance]of dc.lootProfile(map).crystals){sequence.push(.999999);if(chance===1)sequence.push(0);}
  sequence.push(0,0,roll);const found=dc.loot(p,()=>sequence.length?sequence.shift():.999999,map);
  assert.equal(found.find(i=>i.plateType).quantity,1+Math.floor(roll*3));
  if(dc.lootProfile(map).crystals[0][1]===1)assert.equal(found.find(i=>i.key==='crystal_shard').quantity,5);
 }
 const recipes=require('../data/game/corruption_recipes.json');assert.deepEqual(Object.fromEntries(Object.entries(recipes.families).map(([k,v])=>[k,v.plates])),{move:3,ability:3,combat:10,type:20});
});
test('all18 elemental accents enrich every existing family, stay bounded and never paint a failed impact',async()=>{
 const {MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js'),{moveVisual,ELEMENTS}=await import('../vue-explorakit/src/services/moveVisuals.js'),{ELEMENT_ACCENTS}=await import('../vue-explorakit/src/services/moveElementAccents.js');
 assert.deepEqual(Object.keys(ELEMENT_ACCENTS),Object.keys(ELEMENTS));assert.equal(new Set(Object.values(ELEMENT_ACCENTS)).size,18);
 const calls=[],c=new Proxy({globalAlpha:1},{get:(o,k)=>k in o?o[k]:(...args)=>{for(const a of args)if(typeof a==='number')assert(Number.isFinite(a),String(k));calls.push(k);},set:(o,k,v)=>{o[k]=v;return true;}}),canvas={width:1,height:1,getContext:()=>c};
 const r=new MoveEffectRenderer(canvas,{quality:.78,now:()=>0,requestFrame:()=>1,cancelFrame(){}}),path={startX:70,startY:300,targetX:280,targetY:130};r.resize(393,370,3);
 let impacts=0;const original=r.impact;r.impact=function(...args){impacts++;return original.apply(this,args);};
 for(const type of Object.keys(ELEMENTS))for(const stage of['windup','travel','impact','aura','drain','miss']){
  r.setEffect({...moveVisual({moveName:'Tackle',moveType:type}),stage,result:{success:true}},path,[{x:0,y:0,width:120,height:65}]);r.paintAt(180);
  assert((r.stats.elementParticles||0)<=42);assert(Number.isFinite(r.stats.drawMs));assert.equal(r.fx.moveType,type);
 }
 assert(impacts>=18);assert(calls.includes('clip'));assert.equal(r.dpr,1.5);
 for(const result of[{missed:true},{immune:true},{blocked:true},{success:false}]){
  const before=impacts;r.setEffect({...moveVisual({moveName:'Fire Blast'}),stage:'impact',result},path);r.paintAt(200);assert.equal(impacts,before);assert.equal(r.stats.elementParticles,0);
 }
 r.dispose();assert.equal(r.frame,0);assert.equal(canvas.width,0);
});

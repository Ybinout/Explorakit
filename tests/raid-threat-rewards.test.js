const test=require('node:test'),assert=require('node:assert/strict');
const{RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),{shares}=require('../server/game/raids/threat'),content=require('../server/game/raids/content'),codec=require('../server/game/drift/checkpointCodec');
function setup(){return new RaidBattle(Array.from({length:4},()=>({ownerId:1,ownerName:'Test',pokemon:make(9,100,4,['Splash'],'Keen Eye')})),make(143,100,4,['Splash'],'Keen Eye'),{now:()=>1000,seed:[1,2,3,4]});}
test('individual shares use shared total and always round to exactly one hundred',()=>{
 const b=setup(),p=b.sim.p1.active;assert.deepEqual(shares(b.sim),[0,0,0,0]);
 for(const weights of [[40,20,25,15],[90,100,95,100],[1,1,1,0],[.0001,.0002,0,0],[900,0,0,100]]){
  weights.forEach((v,i)=>p[i].m.aggro=v);const value=shares(b.sim);assert.equal(value.reduce((a,b)=>a+b,0),100);assert.deepEqual(b.view(1).allies.map(p=>p.aggro),value);
  for(let i=0;i<4;i++)assert(Math.abs(value[i]-100*weights[i]/weights.reduce((a,b)=>a+b,0))<1);
 }
});
test('damage increases own share and lowers all other shares, including old capped snapshots',()=>{
 const b=setup(),s=b.sim,p=s.p1.active;for(const a of p)a.m.aggro=100;
 const before=shares(s);s.damage(Math.floor(b.bossPokemon.maxhp*.3),b.bossPokemon,p[0],s.dex.moves.get('tackle'));assert(p[0].m.aggro>100);const after=shares(s);assert(after[0]>before[0]);for(let i=1;i<4;i++)assert(after[i]<before[i]);
 const e=s.raid.events.filter(e=>e.kind==='aggro').at(-1);assert.deepEqual(e.shares,after);assert.equal(e.value,after[0]);
 const saved=codec.decode(codec.encode(b.snapshot())),r=RaidBattle.restore(saved,()=>1000);assert.deepEqual(shares(r.sim),after);assert.equal(r.deadline,b.deadline);
});
test('KOs and withdrawals redistribute the entire shared pool immediately',()=>{
 const b=setup(),s=b.sim,p=s.p1.active;[40,20,25,15].forEach((v,i)=>p[i].m.aggro=v);p[0].m.friendUsed=true;
 s.damage(p[0].hp,p[0],p[0],s.dex.conditions.get('psn'));assert.equal(p[0].hp,0);let e=s.raid.events.filter(e=>e.kind==='aggro').at(-1);assert.equal(e.reason,'knockout');assert.deepEqual(e.shares,shares(s));assert.equal(e.shares[0],0);assert.equal(e.shares.reduce((a,b)=>a+b,0),100);
 b.retreat(1);e=b.events.at(-1);assert.equal(e.reason,'retreat');assert.equal(e.shares[1],0);assert.equal(e.shares.reduce((a,b)=>a+b,0),100);
 b.retreat(2);b.retreat(3);assert.deepEqual(shares(s),[0,0,0,0]);
});
const rates=[[100,.5,0],[125,.6,.01],[175,.7,.02],[200,.8,.03],[300,1,.05]],plates=require('../data/game/items.json').items.filter(i=>i.plateType);
for(const[level,plateChance,pearl]of rates)test('independent single-plate rolls and pearl boundaries at level '+level,()=>{
 const d=content.DIFFICULTIES.find(d=>d.level===level);assert.equal(d.plateChance,plateChance);assert.equal(d.pearl,pearl);
 const rolls=plates.map((_,i)=>i%2?plateChance:Math.max(0,plateChance-.00001));rolls.push(pearl);let i=0;
 const reward=content.rewards(d.id,()=>rolls[i++]);assert.equal(i,plates.length+1);assert.equal(reward.items.filter(v=>plates.some(p=>p.key===v.key)).length,Math.ceil(plates.length/2));assert(!reward.items.some(v=>v.key==='potential_pearl'));
 const zero=content.rewards(d.id,()=>0);assert.equal(zero.items.filter(v=>plates.some(p=>p.key===v.key)).length,plates.length);assert.equal(zero.items.some(v=>v.key==='potential_pearl'),pearl>0);assert.equal(zero.money,d.reward);
 assert(zero.items.every(v=>!plates.some(p=>p.key===v.key)||v.quantity===1));for(const[key,n]of [['crystal_shard',101],['clear_crystal',31],['aurora_prism',7]])assert.equal(zero.items.find(i=>i.key===key).quantity,n);
 if(plateChance===1)assert.equal(content.rewards(d.id,()=>1-Number.EPSILON).items.filter(v=>plates.some(p=>p.key===v.key)).length,plates.length);
});

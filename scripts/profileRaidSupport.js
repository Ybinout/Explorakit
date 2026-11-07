// Synthetic CPU workload only: no SQL, accounts, production state or network.
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('./calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec');
function battle(guard){const party=[135,9,143,195].map((id,i)=>({ownerId:i+1,pokemon:make(id,300,4,[i?'Splash':guard?'Wide Guard':'Light Screen'],'Keen Eye')}));for(const p of party)p.pokemon.heldItem=null;const boss=make(143,100,4,['Surf'],'Keen Eye');boss.heldItem=null;return new RaidBattle(party,boss,{seed:[1,2,3,4],now:()=>1000});}
const results=[];
for(const guards of [false,true]){
 const runs=Array.from({length:10},()=>battle(guards)),samples=[];
 for(let n=0;n<20;n++)for(let i=0;i<runs.length;i++){
  const start=performance.now(),b=RaidBattle.restore(codec.decode(codec.encode(runs[i].snapshot())),()=>1000),slot=b.view(1).currentSlot;
  b.action(slot+1,{token:b.token,slot,action:'attack',moveIndex:0});b.applyModels();codec.encode(b.snapshot());b.view(1);runs[i]=b;samples.push(performance.now()-start);
 }
 samples.sort((a,b)=>a-b);results.push({guards,actions:samples.length,averageMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),nativeTurns:runs.map(b=>b.sim.turn)});
}
console.log(JSON.stringify({success:true,simultaneousRaids:10,includesCheckpointEncodeColdRestoreAndFourModelUpdates:true,excludesSqlAndNetwork:true,results}));

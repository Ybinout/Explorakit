// Read-only synthetic workload; no SQL, user accounts, sockets or production state.
const {RaidBattle}=require('../server/game/raids/RaidBattle');
const {make}=require('./calibrateCorruptionRaids');
const codec=require('../server/game/drift/checkpointCodec');
const runs=Array.from({length:10},()=>new RaidBattle(
 [9,94,445,143].map((id,i)=>({ownerId:i+1,ownerName:'Profile',pokemon:make(id,150,4,['Splash'],'Keen Eye')})),
 make(143,100,4,['Splash'],'Keen Eye'),{now:()=>1000,seed:[1,2,3,4]}
));
const samples=[];
for(let n=0;n<40;n++)for(let i=0;i<runs.length;i++){
 const start=performance.now(),b=RaidBattle.restore(codec.decode(codec.encode(runs[i].snapshot())),()=>1000),slot=b.view(1).currentSlot;
 b.action(b.models[slot].ownerId,{token:b.token,slot,action:'attack',moveIndex:0});
 b.applyModels();codec.encode(b.snapshot());b.view(1);
 samples.push(performance.now()-start);runs[i]=b;
}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({success:true,simultaneousSoloRaids:10,actions:samples.length,nativeTurnBoundaries:runs.map(b=>b.sim.turn),averageMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),includesCheckpointEncodeColdRestoreAndFourModelUpdates:true,excludesSqlAndNetwork:true}));

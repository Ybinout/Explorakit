// Compare native outcomes against the published pre-hotfix orchestrator.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),Module=require('node:module'),path=require('node:path');
const filename=path.resolve(__dirname,'../server/game/raids/RaidBattle.js'),oldModule=new Module(filename,module);oldModule.filename=filename;oldModule.paths=module.paths;oldModule._compile(execFileSync('git',['show','a9e78bb:server/game/raids/RaidBattle.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}),filename);
const Old=oldModule.exports.RaidBattle,{RaidBattle:New}=require(filename),{make}=require('./calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec');
function state(b){return{pokemon:b.sim.getAllActive().map(p=>({hp:p.hp,maxhp:p.maxhp,stats:p.storedStats,boosts:p.boosts,status:p.status,item:p.item,moves:p.moveSlots.map(m=>({id:m.id,pp:m.pp}))})),shield:b.sim.raid.shield,wishes:b.sim.raid.wishes,shieldsUsed:b.sim.raid.shieldsUsed,vulnerableUntil:b.sim.raid.vulnerableUntil,turn:b.sim.turn,prng:b.sim.prng.getSeed(),won:b.won,finished:b.finished};}
let turns=0;for(let seed=1;seed<=24;seed++){
 const party=[make(9,100,4,['Surf','Protect','Helping Hand','Wish'],'Torrent'),make(94,100,4,['Shadow Ball','Protect'],'Levitate'),make(445,100,4,['Earthquake','Protect'],'Rough Skin'),make(9,100,4,['Tailwind','Protect'],'Keen Eye')].map((pokemon,i)=>({ownerId:seed%2?1:i+1,ownerName:'Test',pokemon}));
 const boss=make(143,100,4,['Body Slam','Earthquake','Surf','Recover'],'Thick Fat'),a=new Old(codec.decode(codec.encode(party)),codec.decode(codec.encode(boss)),{seed:[seed,2,3,4],now:()=>1000}),b=new New(codec.decode(codec.encode(party)),codec.decode(codec.encode(boss)),{reactive:false,seed:[seed,2,3,4],now:()=>1000});
 for(let turn=0;turn<6&&!a.finished;turn++){
  for(let i=0;i<4;i++){if(!a.sim.p1.active[i].hp||a.sim.p1.active[i].m.retired)continue;const index=i===0?turn%2:i===3?turn===0?0:1:turn%2;
   const payload={slot:i,action:'attack',moveIndex:index,...(i===1&&index===0?{targetLoc:1}:{})};a.action(party[i].ownerId,{...payload,token:a.token});b.action(party[i].ownerId,{...payload,token:b.token});}
  assert.deepEqual(state(b),state(a),'Native outcome changed, seed '+seed+' turn '+turn);turns++;
 }
}
console.log(JSON.stringify({success:true,battles:24,turns,baseline:'a9e78bb',nativeStatsDamageStatusesItemsPpPrngAndShieldsIdentical:true}));

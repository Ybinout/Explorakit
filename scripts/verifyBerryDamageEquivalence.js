// Regression oracle: compare real combat before/after the shared entry helper.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),Module=require('node:module'),path=require('node:path');
const baseline=process.env.BERRY_DAMAGE_BASELINE||'a5fb32aa95eb40139e0545102f67af9661ec2178';
const filename=path.resolve(__dirname,'../server/game/battle/battleEngine.js'),oldModule=new Module(filename,module);
oldModule.filename=filename;oldModule.paths=Module._nodeModulePaths(path.dirname(filename));
oldModule._compile(execFileSync('git',['show',baseline+':server/game/battle/battleEngine.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}),filename);
const old=oldModule.exports,next=require(filename),{make}=require('./calibrateCorruptionRaids');
const catalog=require('../data/game/items.json').items.filter(i=>i.category==='held'),random=Math.random;
let cases=0;
try{
 for(const item of catalog)for(const side of[0,1])for(const blocked of[false,true]){
  const team=[make(143,100,4,['Body Slam'],'Keen Eye'),make(143,100,4,['Tri Attack'],'Keen Eye')];
  for(const p of team)p.heldItem=null;
  team[side].heldItem=item.key;
  if(item.corruptedHeldItem)team[side].corruption={version:1,revision:1,permanent:true,modules:{}};
  if(blocked)team[1-side].passiveAbility='Unnerve';
  team[side].currentHp=Math.floor(team[side].maxHp/5);
  function run(engine){
   Math.random=()=>.9;
   const[a,d]=structuredClone(team),s=engine.createBattleState({battleType:'trainer'});s.berryBattleId='comparison';
   const entry=[engine.applySwitchInEffects(a,s.sides.player,s.sides.enemy,s,d),engine.applySwitchInEffects(d,s.sides.enemy,s.sides.player,s,a)];
   const result=engine.useattack('Body Slam',a,d,{battleState:s,attackerSide:s.sides.player,defenderSide:s.sides.enemy,skipTurnStart:true,consumePp:false,damagePreview:{roll:.9,critical:false}});
   return{entry,result,pokemon:[a,d],state:s};
  }
  assert.deepEqual(run(next),run(old),item.key+' side'+side+' blocked'+blocked);cases++;
 }
}finally{Math.random=random;}
console.log(JSON.stringify({success:true,baseline,items:catalog.length,cases,liveEntryDamageStatusesPpItemsAndBoostsIdentical:true}));

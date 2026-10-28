const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const {wildMoneyReward}=require('../server/game/battle/wildReward');
const {calculateCaptureChance}=require('../server/game/battle/wildBattle');
const {getItemDefinition}=require('../server/game/battle/battleResources');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
function battleFixture(mode,random=()=>.17){
 const a={userId:1,username:'Test',run:{mode:mode.startsWith('colosseum')?'colosseum':'rift',durationMinutes:mode.endsWith('30')?30:60},equipe:{pokemons:[factory.create(1,5)]},items:{pokeball:2},drifts:[],equipped:[],money:500,defeated:new Set()};
 const target=factory.create(19,5);target.abilities=['Growl'];target.movePp=[40];
 const b={npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(a,b,{random,type:'wild',emit:(_,name,payload)=>events.push({name,payload}),paceMs:0});
 return {a,b,target,battle,events};
}
test('wild pocket money grows modestly, is capped, and respects reward bonuses',()=>{
 assert.equal(wildMoneyReward({level:5}),36);assert.equal(wildMoneyReward({level:15}),60);
 assert.equal(wildMoneyReward({level:50}),144);assert.equal(wildMoneyReward({level:1000}),144);
 assert.equal(wildMoneyReward({level:5},1.6),57);
});
test('Poké Ball gains 15% relative odds, better Balls and 95% ceiling remain',()=>{
 const ball=getItemDefinition('pokeball'),player={level:5};
 assert.equal(ball.catch_multiplier,1.15);assert.equal(getItemDefinition('superball').catch_multiplier,1.5);assert.equal(getItemDefinition('hyperball').catch_multiplier,2);
 for(const hp of [100,50,10]){
  const target={level:5,maxHp:100,currentHp:hp};
  const before=calculateCaptureChance(player,target,1),after=calculateCaptureChance(player,target);
  assert(Math.abs(after-Math.min(.95,before*1.15))<1e-9);assert(after<=calculateCaptureChance(player,target,1.5));
 }
 assert.equal(calculateCaptureChance({level:1000},{level:1,maxHp:100,currentHp:1},2),.95);
});
for(const mode of ['rift','colosseum-30','colosseum-60']){
 test(`${mode}: new Poké Ball threshold captures and pays once, also after checkpoint replay`,()=>{
  const {a,target,battle,events}=battleFixture(mode,()=>.30);
  // 30% fails against the old 18.4% odds but succeeds with the opening bonus (32.2%).
  battle.action(a,{action:'bag',itemKey:'pokeball',turnId:battle.token});
  assert(battle.finished);assert.equal(a.equipe.pokemons[1],target);assert.equal(a.items.pokeball,1);assert.equal(a.money,536);
  assert.equal(events.find(e=>e.name==='endbattle').payload.summary.money,36);
  battle.finish(a,'captured');assert.equal(a.money,536);
  const restored=decode(encode(battle));restored.finish(restored.a,'captured');assert.equal(restored.a.money,536);
 });
 test(`${mode}: wild KO pays the same reward; repeated rewards/finish never double it`,()=>{
  const {a,target,battle,events}=battleFixture(mode);target.currentHp=0;battle.prune();battle.checkEnd();
  assert.equal(a.money,536);battle.reward(target);battle.finish(a,'finished');assert.equal(a.money,536);
  assert.equal(events.filter(e=>e.name==='endbattle').length,1);assert.equal(events.find(e=>e.name==='endbattle').payload.summary.money,36);
 });
 test(`${mode}: failed capture, flee and timeout give no money`,()=>{
  const {a,battle}=battleFixture(mode,()=>.99);
  battle.action(a,{action:'bag',itemKey:'pokeball',turnId:battle.token});assert.equal(a.money,500);assert.equal(a.equipe.pokemons.length,1);
  battle.finish(null,'fled');assert.equal(a.money,500);
  const timed=battleFixture(mode);timed.battle.finish(timed.a,'timer');assert.equal(timed.a.money,500);
 });
}
test('wild level curve keeps a level 2–5 starting patch and the compressed later zones',()=>{
 const {maps}=require('../data/game/nextMap.json');
 const previous={start:[5,7],route1:[8,11],route2:[12,16],route3:[21,25],cave1:[26,30],cave2:[31,35],route4:[35,38],gen_route8:[38,41],gen_route7:[42,45],gen_route6:[45,47],gen_route5:[47,49],gen_route4:[50,52],gen_route3:[53,55],gen_route2:[55,57],gen_route1:[57,60]};
 for(const [name,range] of Object.entries(previous)){
  const zone=maps.find(m=>m.mapName===name);
  assert.deepEqual([zone.level.min,zone.level.max],name==='start'?[2,5]:name==='route1'?[6,9]:name==='gen_route8'?[35,41]:name==='gen_route7'?[42,44]:name==='gen_route6'?[44,46]:range.map(level=>Math.round(5+(level-5)*.9)),name);
  assert(zone.wildpokemon.length>=12);assert.equal(new Set(zone.wildpokemon).size,zone.wildpokemon.length);assert(zone.mapchange.length>0);
 }
});

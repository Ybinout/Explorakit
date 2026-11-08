const test=require('node:test'),assert=require('node:assert/strict'),{RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),native=require('../server/game/raids/ruleset'),codec=require('../server/game/drift/checkpointCodec');
function battle(ability='Intimidate'){
 const party=[9,135,143,195].map(id=>({ownerId:1,ownerName:'Test',pokemon:make(id,100,4,['Splash'],'Keen Eye')}));for(const p of party)p.pokemon.heldItem=null;
 const boss=make(130,100,4,['Splash'],ability);boss.heldItem=null;return new RaidBattle(party,boss,{now:()=>1000,seed:[1,2,3,4]});
}
function cold(b){return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000);}
const abilities=native.dex.abilities.all().filter(a=>a.gen<=7&&typeof a.onStart==='function'&&!a.isNonstandard);
for(const ability of abilities)test('boss entry '+ability.name+' is not replayed by views, ally display acknowledgements or cold restore',()=>{
 let b=battle(ability.name);const log=[...b.sim.log],stages=b.view(1).allies.map(p=>p.boosts),bossBoosts={...b.view(1).boss.boosts};
 for(let i=0;i<3;i++){
  for(let owner=1;owner<=4;owner++)b.view(owner);
  const slot=b.view(1).currentSlot;if(slot>=0)b.action(1,{action:'focus',slot,token:b.token});
  b=cold(b);
  assert.deepEqual(b.sim.log,log);assert.deepEqual(b.view(1).allies.map(p=>p.boosts),stages);assert.deepEqual(b.view(1).boss.boosts,bossBoosts);
 }
});
test('Intimidate affects all four real entrants exactly once and never loses their individual stages across a full reactive turn and relay',()=>{
 let b=battle();assert.deepEqual(b.view(1).allies.map(p=>p.boosts.atk),[-1,-1,-1,-1]);const initial=b.sim.log.filter(s=>s.includes('|-ability|p2a:')&&s.includes('Intimidate')).length;assert.equal(initial,1);
 b.sim.p1.active[1].boosts.spe=2;b.sim.p1.active[2].boosts.def=-3;
 let slot=b.view(1).currentSlot;b.action(1,{token:b.token,slot,action:'pass',target:(slot+1)%4});
 for(let n=0;b.sim.turn===1&&n<5;n++){slot=b.view(1).currentSlot;b.action(1,{token:b.token,slot,action:'attack',moveIndex:0});b=cold(b);}
 assert.equal(b.sim.turn,2);assert.equal(b.sim.log.filter(s=>s.includes('|-ability|p2a:')&&s.includes('Intimidate')).length,initial);assert.deepEqual(b.view(1).allies.map(p=>p.boosts.atk),[-1,-1,-1,-1]);assert.equal(b.view(1).allies[1].boosts.spe,2);assert.equal(b.view(1).allies[2].boosts.def,-3);
});

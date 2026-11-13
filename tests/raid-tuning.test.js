const test = require('node:test'), assert = require('node:assert/strict');
const {RaidBattle} = require('../server/game/raids/RaidBattle');
const {make} = require('../scripts/calibrateCorruptionRaids');
const codec = require('../server/game/drift/checkpointCodec');
const native = require('../server/game/raids/ruleset'), doubles = require('../server/game/doubles/ruleset');
const balance = require('../server/game/raids/balance');
function setup(owners = [1,1,1,1], statuses = []) {
  const party = [9,135,143,195].map((id,i) => {
    const pokemon = make(id,100,4,['Tackle','Surf','Haze','Heal Bell'],'Keen Eye');
    pokemon.heldItem = null;
    pokemon.status = statuses[i] || 'normal';
    if (pokemon.status === 'sleep') pokemon.__battle = {sleepTurns:3};
    return {ownerId:owners[i],ownerName:'Test',pokemon};
  });
  const boss = make(143,300,4,['Tackle','Surf','Haze','Protect'],'Keen Eye'); boss.heldItem = null;
  const b = new RaidBattle(party,boss,{seed:[1,2,3,4],now:()=>1000}); b.sim.raid.shieldsUsed = 2;
  return b;
}
const cold = b => RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),b.now);
function damage(b,source,target,move='tackle',crit=false) {
  const m = b.sim.dex.getActiveMove(move); m.willCrit = crit; b.sim.randomizer = n => n; b.sim.setActiveMove(m,source,target);
  return b.sim.actions.getDamage(source,target,m);
}
for (const stat of ['atk','def','spa','spd','spe']) test('boss '+stat+' negative and positive stages retain full native effects, for boss and allies',()=>{
  const b=setup(),boss=b.bossPokemon,ally=b.sim.p1.active[0];
  for (let stage=-6;stage<=6;stage++) {
    boss.boosts[stat]=ally.boosts[stat]=stage;
    const normal=stage<0?2/(2-stage):1+stage/2;
    const expected=Math.floor(stage<0?boss.storedStats[stat]/(1-stage/2):boss.storedStats[stat]*normal);
    assert.equal(boss.calculateStat(stat,stage),expected);
    assert.equal(boss.getStat(stat),expected);
    assert.equal(ally.calculateStat(stat,stage),Math.floor(ally.storedStats[stat]*normal));
    assert.equal(ally.getStat(stat),Math.floor(ally.storedStats[stat]*normal));
    assert.equal(boss.boosts[stat],stage);
  }
  assert.equal(boss.getStat(stat,true),boss.storedStats[stat]);
});
test('negative stages still stack, reset with Haze and interact with Simple, Contrary, Clear Body and critical hits',()=>{
  const b=setup(),s=b.sim,boss=b.bossPokemon,ally=s.p1.active[0];
  boss.setAbility('clearbody');s.boost({atk:-1},boss,ally);assert.equal(boss.boosts.atk,0);
  boss.setAbility('contrary');s.boost({atk:-1},boss,ally);assert.equal(boss.boosts.atk,1);
  s.actions.runMove('haze',ally);assert.equal(boss.boosts.atk,0);
  boss.setAbility('simple');s.boost({atk:-1},boss,ally);assert.equal(boss.boosts.atk,-2);
  assert.equal(boss.calculateStat('atk',-2),Math.floor(boss.storedStats.atk*.5));
  boss.setAbility('keeneye');boss.boosts.atk=0;const base=damage(b,boss,ally),critical=damage(b,boss,ally,'tackle',true);
  boss.boosts.atk=-1;const weak=damage(b,boss,ally);assert(weak>base*.6&&weak<base*.75);
  assert.equal(damage(b,boss,ally,'tackle',true),critical);
  ally.setAbility('unaware');const unaware=damage(b,boss,ally);boss.boosts.atk=0;assert.equal(damage(b,boss,ally),unaware);
});
test('Wonder Room, item multipliers and boss Speed debuffs still use the same native event ordering',()=>{
  const b=setup(),s=b.sim,p=b.bossPokemon;p.boosts.def=-1;p.setItem('choiceband');
  assert.equal(p.calculateStat('def',-1),Math.floor(p.storedStats.def/1.5));
  s.field.addPseudoWeather('wonderroom',p);assert.equal(p.calculateStat('def',-1),Math.floor(p.storedStats.spd/1.5));
  p.boosts.atk=-1;assert.equal(p.getStat('atk'),s.modify(Math.floor(p.storedStats.atk/1.5),1.5));
  const speed=p.getStat('spe');s.boost({spe:-1},p,s.p1.active[0]);assert.equal(p.getStat('spe'),Math.floor(speed/1.5));
});
test('raid accuracy and evasion use native stages without attenuation or a raid-only accuracy hook',()=>{
  assert.equal(native.format.onAccuracy,undefined);
  for(const [who,stat,stage,want]of[['boss','accuracy',-1,75],['boss','accuracy',-2,60],['boss','evasion',-1,133],['ally','accuracy',-1,75]]){
    const b=setup(),s=b.sim,boss=b.bossPokemon,ally=s.p1.active[0],source=stat==='evasion'||who==='ally'?ally:boss,target=source===boss?ally:boss;
    source.setAbility('runaway');(who==='boss'?boss:ally).boosts[stat]=stage;const rolls=[],randomChance=s.randomChance;
    s.randomChance=function(n,d){if(d===100){rolls.push(n);return true;}return randomChance.call(this,n,d);};
    s.actions.runMove('tackle',source,target.side.n===1?1:target.position+1);assert(rolls.includes(want),JSON.stringify({who,stat,stage,rolls}));
  }
});
test('cold checkpoints retain their stages, native full penalties and confirmed70% rage cap',()=>{
  let b=setup();b.bossPokemon.boosts.atk=-1;b.bossPokemon.boosts.spe=-2;require('../server/game/raids/pressure').state(b.sim).value=110;
  const seed=b.sim.prng.getSeed();b=cold(b);assert.equal(b.bossPokemon.boosts.atk,-1);assert.equal(b.bossPokemon.calculateStat('atk',-1),Math.floor(b.bossPokemon.storedStats.atk/1.5));assert.equal(b.bossPokemon.getStat('spe'),Math.floor(b.bossPokemon.storedStats.spe/2));assert.equal(b.view(1).boss.rage.bonusPercent,70);assert.deepEqual(b.sim.prng.getSeed(),seed);
});
test('native doubles retain full negative stat effects and no cooperation bonus',()=>{
  const b=setup([1,2,3,4]),sets=b.models.map(m=>doubles.teamSet(m.pokemon));
  const s=new (require('@pkmn/sim').Battle)({format:doubles.dex.formats.get('riftmondoubles'),seed:[1,2,3,4]},doubles.dex);
  doubles.installStats(s);s.setPlayer('p1',{name:'Test',team:sets});s.setPlayer('p2',{name:'Adversaire',team:[doubles.teamSet(b.boss),doubles.teamSet(b.models[1].pokemon)]});
  const foe=s.p2.active[0];foe.boosts.atk=-1;assert.equal(foe.calculateStat('atk',-1),Math.floor(foe.storedStats.atk/1.5));
  const p=b.sim.p1.active[0];p.boosts.atk=-1;assert.equal(p.calculateStat('atk',-1),Math.floor(p.storedStats.atk*2/3));
});
for(const owners of [[1,1,1,1],[1,1,2,2],[1,2,3,3],[1,2,3,4]])test('cooperation counts distinct trainers and survives cold resume: '+owners.join(','),()=>{
  let b=setup(owners),solo=setup(),p=b.sim.p1.active[0],target=b.bossPokemon;
  const base=damage(solo,solo.sim.p1.active[0],solo.bossPokemon),actual=damage(b,p,target);
  assert.equal(b.view(1).cooperationBonusPercent,new Set(owners).size>=2?20:0);
  assert.equal(actual,new Set(owners).size>=2?b.sim.modify(base,1.2):base);
  assert.equal(damage(b,target,p),damage(solo,solo.bossPokemon,solo.sim.p1.active[0]));
  assert.equal(damage(b,p,b.sim.p1.active[1]),damage(solo,solo.sim.p1.active[0],solo.sim.p1.active[1]));
  b=cold(b);assert.equal(damage(b,b.sim.p1.active[0],b.bossPokemon),actual);
  const snap=b.snapshot();delete snap.sim.raid.participantCount;for(const side of snap.sim.sides)for(const mon of side.pokemon)delete mon.set.rift.ownerId;
  b=RaidBattle.restore(codec.decode(codec.encode(snap)),b.now);assert.equal(damage(b,b.sim.p1.active[0],b.bossPokemon),actual);
});
for(const condition of ['burn','poison','badly_poison','paralyze','sleep','freeze'])test('entry preserves '+condition+' before the first action and through repeated reconnects',()=>{
  let b=setup(undefined,[condition]);const code={burn:'brn',poison:'psn',badly_poison:'tox',paralyze:'par',sleep:'slp',freeze:'frz'}[condition];
  let p=b.sim.p1.active[0];assert.equal(p.status,code);assert.equal(b.view(1).allies[0].status,condition);
  const state=JSON.stringify(p.statusState,(k,v)=>k==='target'?undefined:v),seed=b.sim.prng.getSeed();
  for(let i=0;i<3;i++){b=cold(b);p=b.sim.p1.active[0];assert.equal(p.status,code);assert.equal(JSON.stringify(p.statusState,(k,v)=>k==='target'?undefined:v),state);assert.deepEqual(b.sim.prng.getSeed(),seed);}
  b.applyModels();assert.equal(b.models[0].pokemon.status,condition);
  if(condition==='paralyze')assert.equal(p.getStat('spe'),Math.floor(p.storedStats.spe/2));
  if(condition==='sleep')assert.equal(p.statusState.time,3);
  if(['poison','badly_poison','burn'].includes(condition)){const hp=p.hp;b.sim.fieldEvent('Residual');assert(p.hp<hp);}
});
test('legitimate status cures still work and are never undone by restore; clean entrants remain clean',()=>{
  let b=setup(undefined,['burn','poison','sleep','paralyze']);b.sim.actions.runMove('healbell',b.sim.p1.active[0]);
  assert(b.sim.p1.active.every(p=>!p.status));b=cold(b);assert(b.sim.p1.active.every(p=>!p.status));b.applyModels();assert(b.models.every(m=>m.pokemon.status==='normal'));
});
test('raid cash threshold is inclusive at300, applies after current talent tariffs, and never changes other rewards',()=>{
  const effects=require('../server/game/talents/effects');
  for(const level of [100,125,175,200,299,300,301,500,1000])for(const owner of [null,{__trainerTalents:{version:3,money:{raid:61},globalMoney:15}}])for(const amount of [0,1,101,1000000]){
    const old=effects.money(amount,'raid',owner);assert.equal(balance.money(amount,level,owner),level>=300?Math.floor(old*.8):old);
  }
  assert.equal(balance.money(1000000,300),640000);assert.equal(balance.money(400000,200),320000);
});

const test = require('node:test'), assert = require('node:assert/strict');
const { RaidBattle } = require('../server/game/raids/RaidBattle');
const native = require('../server/game/raids/ruleset');
const { make } = require('../scripts/calibrateCorruptionRaids');
const codec = require('../server/game/drift/checkpointCodec');
function mon(id, moves, ability = 'Keen Eye') { const p = make(id,100,4,moves,ability); p.heldItem = null; return p; }
function raid(move = 'Tackle', seed = 1, options = {}) {
  return new RaidBattle([12,143,143,143].map((id,i) => ({ ownerId:i+1,ownerName:'Test'+i,pokemon:mon(id,['Pollen Puff','Splash']) })),
    mon(143,[move]),{ now:()=>1000,seed:[seed,2,3,4],...options });
}
function act(b, moveIndex = 1, targetLoc) {
  const slot = b.view(1).currentSlot;
  b.action(b.models[slot].ownerId,{ token:b.token,slot,action:'attack',moveIndex,targetLoc });
}
function firstCast(b) { act(b); act(b); return b.events.find(e => e.kind === 'move' && e.slot === 4); }
test('Pollen Puff metadata, French names, CS compatibility and bullet immunity are complete', () => {
  const move = require('../server/game/battle/battleResources').getMoveDefinition('Pollen Puff');
  assert.deepEqual([move.id,move.type,move.power,move.accuracy,move.pp,move.combat.damage_class],[676,'Bug',90,100,15,'special']);
  const cs = require('../data/game/machines.json').machines.cs_pollen_puff;
  assert(cs.species.includes(12)); assert(!cs.species.includes(25));
  assert.equal(cs.name,'CS Boule Pollen'); assert.equal(cs.price,4000);
  assert.equal(require('../vue-explorakit/src/data/gameNames.fr.json').moves['Pollen Puff'],'Boule Pollen');
  assert.match(require('../vue-explorakit/src/data/pokemonReference.fr.json').moves['Pollen Puff'].description,/50 %/);
  const engine = require('../server/game/battle/battleEngine'), a = mon(12,['Pollen Puff']), d = mon(143,['Splash']);
  const pp = a.movePp[0], hp = d.currentHp;
  const hit = engine.useattack('Pollen Puff',a,d,{ battleState:engine.createBattleState() });
  assert(hit.damage > 0); assert(d.currentHp < hp); assert.equal(a.movePp[0],pp-1);
  const immune = mon(143,['Splash'],'Bulletproof'), before = immune.currentHp;
  engine.useattack('Pollen Puff',mon(12,['Pollen Puff']),immune,{ battleState:engine.createBattleState() });
  assert.equal(immune.currentHp,before);
});
test('Pollen Puff heals any other raid owner without hurting the ally or boss and consumes one PP', () => {
  for (const slot of [1,2,3]) {
    const b = raid('Splash'), p = b.sim.p1.active[0], q = b.sim.p1.active[slot];
    q.hp = 1; const max = q.baseMaxhp, hp = b.bossPokemon.hp, pp = p.moveSlots[0].pp;
    const move = b.moves(0).find(m => m.ename === 'Pollen Puff');
    assert.deepEqual(move.targets.map(t => t.slot),[1,2,3,4]);
    act(b,0,-(slot+1));
    assert.equal(q.hp,1+Math.floor(max/2)); assert.equal(b.bossPokemon.hp,hp);
    assert.equal(p.moveSlots[0].pp,pp-1); assert(p.m.aggro > 0);
    assert(b.events.some(e => e.kind === '-heal' && e.slot === slot));
    assert(b.events.some(e => e.kind === 'move' && e.healing && e.target === slot));
    assert(!b.events.some(e => e.kind === '-damage'));
  }
});
test('Pollen Puff still damages the boss and can never heal itself or a withdrawn ally', () => {
  const b = raid('Splash'), hp = b.bossPokemon.hp;
  assert.throws(() => act(b,0,-1),/Cible invalide/);
  b.retreat(3); assert(!b.moves(0)[0].targets.some(t => t.slot === 3));
  act(b,0,1); assert(b.bossPokemon.hp < hp);
  assert(!b.events.some(e => e.kind === 'move' && e.healing));
});
test('ally healing respects Protect, Heal Block, full HP, and bypasses Substitute as in the native simulator', () => {
  for (const condition of ['protect','sourceHealBlock','targetHealBlock','full','substitute']) {
    const b = raid('Splash'), p = b.sim.p1.active[0], q = b.sim.p1.active[3];
    q.hp = condition === 'full' ? q.maxhp : 1;
    if (condition === 'protect') q.addVolatile('protect');
    if (condition === 'sourceHealBlock') p.addVolatile('healblock');
    if (condition === 'targetHealBlock') q.addVolatile('healblock');
    if (condition === 'substitute') q.addVolatile('substitute');
    const before = q.hp, boss = b.bossPokemon.hp;
    if (condition === 'sourceHealBlock') {
      assert.deepEqual(b.moves(0)[0].targets.map(t=>t.slot),[4]);
      assert.throws(()=>act(b,0,-4),/Cible invalide/);
      act(b,0,1); assert(b.bossPokemon.hp < boss);
      continue;
    }
    act(b,0,-4);
    assert.equal(q.hp,condition === 'substitute' ? Math.min(q.maxhp,before+Math.floor(q.baseMaxhp/2)) : before,condition);
    assert.equal(b.bossPokemon.hp,boss,condition);
    if (condition !== 'substitute') assert.equal(p.m.aggro||0,0,condition);
  }
});
test('Pollen Puff has native ally healing and enemy damage in actual doubles', () => {
  const { DoublesBattle } = require('../server/game/doubles/doublesBattle');
  const players = [0,1].map(id => ({ id,username:'Double'+id,equipe:{ pokemons:[mon(12,['Pollen Puff']),mon(143,['Splash']),mon(143,['Splash'])] } }));
  const b = new DoublesBattle(...players,{ emit(){} }), sim = b.sim, p = sim.p1.active[0], q = sim.p1.active[1];
  q.hp = 1; const boss = sim.p2.active[0], hp = boss.hp;
  sim.actions.runMove('pollenpuff',p,-2); assert.equal(q.hp,1+Math.floor(q.baseMaxhp/2)); assert.equal(boss.hp,hp);
  sim.actions.runMove('pollenpuff',p,1); assert(boss.hp < hp);
});
for (const move of ['Tackle','Outrage','Thrash','Petal Dance']) test('raid boss '+move+' hits the advertised highest-threat ally, independent of RNG', () => {
  for (let seed=1;seed<=12;seed++) {
    const b = raid(move,seed); [200,30,20,10].forEach((n,i) => b.sim.p1.active[i].m.aggro=n);
    const announced = b.view(1).intention; assert.equal(announced.target,0);
    const attack = firstCast(b); assert(attack); assert.equal(attack.target,0,move+' seed '+seed);
  }
});
test('legacy raid choices also follow highest threat without consuming RNG during previews', () => {
  const b = raid('Outrage',3,{ reactive:false }); [200,30,20,10].forEach((n,i) => b.sim.p1.active[i].m.aggro=n);
  const seed = b.sim.prng.getSeed();
  for (let i=0;i<20;i++) assert.equal(native.target(b.sim),1);
  assert.equal(b.sim.prng.getSeed(),seed);
});
test('raid redirection remains legal, and powder immunity cannot draw the boss to a weaker threat', () => {
  for (const [condition,expected] of [['followme',3],['ragepowder',3],['grass',0],['overcoat',0],['goggles',0]]) {
    const b = raid('Tackle'); [200,30,20,10].forEach((n,i) => b.sim.p1.active[i].m.aggro=n);
    b.sim.p1.active[3].addVolatile(condition === 'followme' ? 'followme' : 'ragepowder');
    if (condition === 'grass') b.bossPokemon.setType('Grass');
    if (condition === 'overcoat') b.bossPokemon.setAbility('overcoat');
    if (condition === 'goggles') b.bossPokemon.setItem('safetygoggles');
    assert.equal(b.view(1).intention.target,expected,condition);
    assert.equal(firstCast(b).target,expected,condition);
  }
});
test('aggro can legitimately change leader after the highest-threat ally receives damage', () => {
  const b = raid('Tackle'); [20,19,0,0].forEach((n,i) => b.sim.p1.active[i].m.aggro=n);
  assert.equal(b.view(1).intention.target,0); const move = firstCast(b); assert.equal(move.target,0);
  assert(b.sim.p1.active[0].m.aggro < 19); assert.equal(b.view(1).intention.target,1);
});
test('cold restore retains healing and deterministic threat targeting without replaying a decision', () => {
  const b = raid('Outrage'); b.sim.p1.active[3].hp=1; act(b,0,-4);
  const r = RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000);
  assert.deepEqual(r.view(1).aggroShares,b.view(1).aggroShares); assert.equal(r.sim.p1.active[3].hp,b.sim.p1.active[3].hp);
  assert.deepEqual(r.sim.prng.getSeed(),b.sim.prng.getSeed());
  act(b); act(r); assert.deepEqual(r.events,b.events); assert.equal(r.sim.p1.active[0].moveSlots[0].pp,b.sim.p1.active[0].moveSlots[0].pp);
});
test('healing visuals are distinct from offensive projectiles and target the healed ally', async () => {
  const { raidMovePlan } = await import('../vue-explorakit/src/services/raidPresentation.js');
  const { moveVisual } = await import('../vue-explorakit/src/services/moveVisuals.js');
  const e = { kind:'move',slot:0,target:3,moveName:'Pollen Puff',damageClass:'special',healing:true };
  const plan = raidMovePlan([e,{ kind:'-heal',slot:3,hp:100 }],0,{ allies:[],boss:{} });
  assert.deepEqual(plan.targets.map(t=>t.slot),[3]);
  const healing = moveVisual(e), offense = moveVisual({...e,healing:false});
  assert.equal(healing.damageClass,'status'); assert.equal(healing.style,'recovery');
  assert.equal(offense.damageClass,'special'); assert.equal(offense.moveType,'Bug'); assert.equal(offense.style,'seed-orb');
});

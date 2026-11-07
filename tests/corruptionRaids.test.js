const test = require('node:test'),
  assert = require('node:assert/strict');
const {
    RaidBattle
  } = require('../server/game/raids/RaidBattle'),
  content = require('../server/game/raids/content'),
  factory = require('../server/game/drift/pokemonFactory'),
  codec = require('../server/game/drift/checkpointCodec');
function pokemon(id = 9, moves = ['Surf', 'Protect', 'Helping Hand', 'Wish'], level = 100, k = 4) {
  const p = factory.create(id, level, true);
  p.k = k;
  p.iv = {
    hp: 31,
    attack: 31,
    defense: 31,
    specialAttack: 31,
    specialDefense: 31,
    speed: 31
  };
  p.ev = {
    hp: 252,
    attack: 0,
    defense: 0,
    specialAttack: 252,
    specialDefense: 6,
    speed: 0
  };
  p.passiveAbility = 'Torrent';
  p.nature = 'Modest';
  p.abilities = [];
  p.movePp = [];
  for (const m of moves) p.addAbility(m);
  p.corruption = null;
  p.recalculateStats();
  p.currentHp = p.maxHp;
  return p;
}
function battle(options = {}) {
  const allies = Array.from({
      length: 4
    }, (_, i) => ({
      ownerId: 1,
      ownerName: 'A',
      pokemon: pokemon()
    })),
    boss = content.bossFor({
      difficulty: 'easy',
      bossIndex: 0
    });
  return new RaidBattle(allies, boss, {
    reactive:false, seed: [1, 2, 3, 4],
    ...options
  });
}
function move(b, slot, index = 0, loc = 1) {
  return b.action(1, {
    token: b.token,
    slot,
    action: 'attack',
    moveIndex: index,
    targetLoc: loc
  });
}
test('native raid has four allies, one boss, only HP scaled and exactly two boss actions', () => {
  const b = battle();
  assert.equal(b.sim.sides[0].active.length, 4);
  assert.equal(b.bossPokemon.maxhp, b.boss.maxHp * 6);
  assert.equal(b.bossPokemon.storedStats.spa, b.boss.specialAttack);
  for (let i = 0; i < 4; i++) move(b, i, 1);
  assert.equal(b.events.filter(e => e.kind === 'move' && e.slot === 4).length, 2);
  assert.equal(b.sim.turn, 2);
});
test('turn, pending choices, HP and absolute deadline survive serialization', () => {
  let time = 1000;
  const b = battle({
    now: () => time
  });
  move(b, 0, 1);
  const restored = RaidBattle.restore(codec.decode(codec.encode(b.snapshot())), () => time);
  assert.equal(restored.deadline, 39000);
  assert.equal(restored.pending[0].moveIndex, 1);
  time = 39001;
  assert.ok(restored.tick());
  assert.equal(restored.sim.sides[0].active.filter(p => p.m.retired).length, 1);
  assert.equal(restored.deadline, 69001);
  assert.equal(restored.models[1].pokemon.currentHp, restored.models[1].pokemon.maxHp);
});
test('allies can select support targets and pass sacrifices an action without creating an extra turn', () => {
  const b = battle();
  b.sim.sides[0].active[0].storedStats.spe = 9999;
  assert.equal(b.moves(0)[2].targets.length, 3);
  b.action(1, {
    token: b.token,
    slot: 0,
    action: 'pass',
    target: 1
  });
  for (let i = 1; i < 4; i++) move(b, i, 0);
  assert.equal(b.events.filter(e => e.kind === 'pass').length, 1);
  assert.equal(b.events.filter(e => e.kind === 'move' && e.slot === 0).length, 0);
  assert.equal(b.events.filter(e => e.kind === 'move' && e.slot === 1).length, 1);
  assert.doesNotThrow(() => b.action(1, {
    token: b.token,
    slot: 0,
    action: 'pass',
    target: 1
  }));
});
test('daily five rifts, correct French day and independent rewards', () => {
  assert.equal(content.dayKey(Date.parse('2026-11-07T23:30:00Z')), '2026-11-08');
  const world = content.createDay();
  assert.equal(world.rifts.length, 5);
  for (const r of world.rifts) {
    assert.ok(content.DIFFICULTIES.find(d => d.id === r.difficulty).maps.includes(r.map));
    assert.equal(content.bossFor(r).k, 4);
  }
  const plates = require('../data/game/items.json').items.filter(i => i.plateType).length;
  assert.equal(content.rewards('extreme', () => .9).items.length, plates+3);
  assert.equal(content.rewards('easy', () => .99).items.length, 3);
  assert.equal(content.rewards('easy', () => 0).items.length, plates + 4);
});
module.exports = {
  pokemon,
  battle,
  move
};
test('target four remains usable after a native checkpoint, and Wish has no parallel classic slot condition', () => {
  const b = battle();
  b.models[0].pokemon.abilities = ['Heal Pulse'];
  b.models[0].pokemon.movePp = [10];
  const n = require('../server/game/raids/ruleset');
  assert.equal(n.dex.moves.get('wish').slotCondition, undefined);
  const restored = RaidBattle.restore(codec.decode(codec.encode(b.snapshot())));
  assert.equal(restored.sim.validTargetLoc(-4, restored.sim.sides[0].active[0], 'any'), true);
  const p = restored.sim.sides[0].active[0];
  assert.equal(p.isAdjacent(restored.sim.sides[0].active[3]), true);
});
test('friendship blocks a lethal full-HP boss move once and prevents its immediate follow-up', () => {
  const b = battle(),
    p = b.sim.sides[0].active[0],
    boss = b.bossPokemon,
    move = b.sim.dex.moves.get('thunderbolt');
  b.sim.damage(p.maxhp * 3, p, boss, move);
  assert.equal(p.hp, 1);
  assert.equal(p.m.friendUsed, true);
  b.sim.damage(99, p, boss, move);
  assert.equal(p.hp, 1);
  assert(b.sim.raid.events.some(e => e.kind === 'friendship'));
  const r = RaidBattle.restore(codec.decode(codec.encode(b.snapshot())));
  assert.equal(r.sim.sides[0].active[0].hp, 1);
  assert(r.sim.sides[0].active[0].m.friendGuard);
  delete p.m.friendGuard;
  b.sim.damage(10, p, boss, move);
  assert.equal(p.hp, 0);
});
test('shield gates 70/30 percent, reduces damage to one quarter and enforces two vulnerable turns', () => {
  const b = battle(),
    sim = b.sim,
    boss = b.bossPokemon,
    p = sim.sides[0].active[0],
    move = sim.dex.moves.get('tackle');
  sim.damage(Math.floor(boss.maxhp * .6), boss, p, move);
  assert.equal(boss.hp, Math.ceil(boss.maxhp * .7));
  assert.equal(sim.raid.shieldsUsed, 1);
  const before = boss.hp,
    shield = sim.raid.shield.hp;
  sim.damage(100, boss, p, move);
  assert.equal(boss.hp, before - 25);
  assert.equal(sim.raid.shield.hp, shield - 100);
  sim.damage(shield, boss, p, move);
  assert.equal(sim.raid.shield.hp, 0);
  assert.equal(sim.raid.vulnerableUntil, sim.turn + 2);
  const vulnerableHp=boss.hp;sim.damage(100,boss,p,move);assert.equal(boss.hp,vulnerableHp-100);
  boss.hp=Math.ceil(boss.maxhp*.3)-20;sim.damage(10,boss,p,move);assert.equal(boss.hp,Math.ceil(boss.maxhp*.3)-30);
  sim.turn = sim.raid.vulnerableUntil + 1;
  require('../server/game/raids/ruleset').format.onResidual.call(sim, boss);
  assert.equal(sim.raid.shieldsUsed, 2);
});
test('consumable ownership, Knock Off and survival kit provenance survive a checkpoint', () => {
  const b = battle(),
    p = b.sim.sides[0].active[0];
  b.models[0].initialHeld = 'sitrus_berry';
  p.setItem('sitrusberry');
  p.hp = Math.floor(p.maxhp / 3);
  p.eatItem();
  b.applyModels();
  assert.equal(b.models[0].pokemon.heldItem, null);
  const r = RaidBattle.restore(codec.decode(codec.encode(b.snapshot()))),
    q = r.sim.sides[0].active[1];
  r.models[1].initialHeld = 'leftovers';
  q.setItem('leftovers');
  q.takeItem(r.bossPokemon);
  r.applyModels();
  assert.equal(r.models[1].pokemon.heldItem, 'leftovers');
});
test('Perle de Potentiel confirms, increases K, recalculates real stats and refuses K4', () => {
  const {
      medicineResult
    } = require('../server/game/items/medicineEffects'),
    {
      requireIvRerollConfirmation
    } = require('../server/game/items/ivRerollConfirmation'),
    p = pokemon();
  p.k = 2;
  p.recalculateStats();
  p.currentHp = p.maxHp;
  assert.throws(() => requireIvRerollConfirmation(p, 'potential_pearl', null), e => e.ivConfirmationRequired?.before === 2);
  assert.doesNotThrow(() => requireIvRerollConfirmation(p, 'potential_pearl', {
    stat: 'potential',
    before: 2
  }));
  const r = medicineResult(p, 'potential_pearl');
  assert.equal(r.k, 3);
  assert(r.speed > p.speed);
  assert(r.maxHp > p.maxHp);
  p.k = 4;
  assert.throws(() => medicineResult(p, 'potential_pearl'), /maximum/);
});
test('Wish heals exactly the next acting ally after a pass, without a second slot-based heal', () => {
  const party = Array.from({
      length: 4
    }, (_, i) => ({
      ownerId: 1,
      pokemon: pokemon(9, i === 0 ? ['Wish'] : ['Splash'])
    })),
    boss = content.bossFor({
      difficulty: 'easy',
      bossIndex: 0
    });
  boss.abilities = ['Splash'];
  boss.movePp = [40];
  const b = new RaidBattle(party, boss, {
    reactive:false,seed: [1, 2, 3, 4]
  });
  for (let i = 0; i < 4; i++) move(b, i, 0, undefined);
  assert.equal(b.sim.raid.wishes.length, 1);
  assert.equal(Object.keys(b.sim.p1.slotConditions[0]).length, 0);
  const target = b.sim.p1.active[2],
    caster = b.sim.p1.active[0];
  target.hp = 1;
  caster.hp = Math.floor(caster.maxhp / 3);
  b.sim.p1.active[1].storedStats.spe = 9999;
  const beforeCaster = caster.hp,
    amount = Math.floor(caster.maxhp / 2),
    token = b.token;
  b.action(1, {
    slot: 1,
    token,
    action: 'pass',
    target: 2
  });
  for (const i of [0, 2, 3]) move(b, i, 0, undefined);
  assert.equal(target.hp, 1 + amount);
  assert.equal(caster.hp, beforeCaster);
  assert(b.events.some(e => e.kind === '-heal' && e.slot === 2));
});
test('real damage and healing generate measured aggro, Follow Me fills it and AoE is telegraphed a full turn ahead', () => {
  const b = battle(),
    sim = b.sim,
    p = sim.p1.active[0],
    other = sim.p1.active[1];
  sim.damage(100, b.bossPokemon, p, sim.dex.moves.get('tackle'));
  assert(p.m.aggro > 0);
  const fromDamage = p.m.aggro;
  other.hp -= 100;
  sim.heal(100, other, p, sim.dex.moves.get('healpulse'));
  assert(p.m.aggro > fromDamage);
  assert(p.m.aggro - fromDamage < fromDamage);
  const warning = b.view(1).warning;
  assert(warning.nextTurn);
  assert(['Surf', 'Sludge Wave'].includes(warning.move) || ['Surf', 'Cradovague'].includes(warning.move));
  const f = require('../server/game/raids/ruleset').format;
  p.moveThisTurnResult = true;
  f.onAfterMove.call(sim, p, b.bossPokemon, sim.dex.moves.get('followme'));
  assert.equal(p.m.aggro, 100);
});

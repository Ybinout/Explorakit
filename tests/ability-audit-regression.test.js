const test = require('node:test'), assert = require('node:assert/strict');
const e = require('../server/game/battle/battleEngine');
const { getAbilityDamageMultiplier } = require('../server/game/abilities/abilityEngine');
const { clearBattleTransientState } = require('../server/game/battle/battleOutcome');
let serial = 0;
function mon(passiveAbility = null, extra = {}) {
    return Object.assign({ uuid: 'talent-audit-' + ++serial, name: 'Test', truename: 'Test', type1: 'Normal', type2: null,
        level: 50, maxHp: 400, currentHp: 400, currentAttack: 100, currentDefense: 100, currentSpecialAttack: 100, currentSpecialDefense: 100, currentSpeed: 100,
        status: 'normal', passiveAbility, abilities: ['Pound', 'Hypnosis', 'Thunderbolt', 'Fire Punch'], movePp: [35, 20, 15, 15],
        data: { id: 1, base: { HP: 80, Defense: 80, 'Sp. Defense': 80 } } }, extra);
}
function rng(value, work) { const old = Math.random; Math.random = () => value; try { return work(); } finally { Math.random = old; } }
function attack(a, b, name, state = e.createBattleState()) { return e.useattack(name, a, b, { battleState: state, attackerSide: state.sides.player, defenderSide: state.sides.enemy, attackerTeam: [a], defenderTeam: [b] }); }
function enter(a, b, state = e.createBattleState()) { return e.applySwitchInEffects(a, state.sides.player, state.sides.enemy, state, b); }
const stage = (p, stat) => e.ensureBattleData(p).statStages[stat];

for (const ability of [null, 'Compound Eyes']) test(`Wonder Skin fixes status accuracy at 50 before modifiers (${ability})`, () => rng(ability ? .5 : .4, () => {
    const d = mon('Wonder Skin'); assert(!attack(mon(ability), d, 'Hypnosis').missed); assert.equal(d.status, 'sleep');
}));
test('Wonder Skin still misses above its cap, leaves attacks and No Guard unchanged', () => rng(.6, () => {
    assert(attack(mon(), mon('Wonder Skin'), 'Hypnosis').missed);
    assert(attack(mon(), mon('Wonder Skin'), 'Pound').damage > 0);
    assert(!attack(mon('No Guard'), mon('Wonder Skin'), 'Hypnosis').missed);
}));
for (const ability of ['Leaf Guard', 'Flower Veil']) test(`${ability} protects major status only, not confusion`, () => rng(.1, () => {
    const state = e.createBattleState(); state.weather = { kind: 'sun', turns: 5 };
    const d = mon(ability, { type1: 'Grass' }); attack(mon(), d, 'Confuse Ray', state); assert(e.ensureBattleData(d).confusionTurns > 0);
    const protectedMon = mon(ability, { type1: 'Grass' }); attack(mon(), protectedMon, 'Toxic', state); assert.equal(protectedMon.status, 'normal');
}));
test('Flower Veil follows temporary types and permits self-inflicted Rest', () => rng(.1, () => {
    const d = mon('Flower Veil', { type1: 'Grass' }); e.ensureBattleData(d).tempTypes = ['Water']; attack(mon(), d, 'Toxic'); assert.equal(d.status, 'badly_poison');
    const resting = mon('Flower Veil', { type1: 'Grass', currentHp: 100 }); attack(resting, mon(), 'Rest'); assert.equal(resting.status, 'sleep'); assert.equal(resting.currentHp, 400);
}));
test('Mold Breaker cannot disable Comatose or No Guard, including a hidden turn', () => rng(.99, () => {
    const sleeping = mon('Comatose'); attack(mon('Mold Breaker'), sleeping, 'Thunder Wave'); assert.equal(sleeping.status, 'normal');
    const hidden = mon('No Guard'); Object.assign(e.ensureBattleData(hidden), { semiInvulnerable: 'underground', chargeMove: 'Dig' });
    assert(attack(mon('Mold Breaker'), hidden, 'Pound').damage > 0);
}));
test('Tough Claws uses its 1.3 contact multiplier and leaves ranged attacks unchanged', () => {
    const a = mon('Tough Claws'), d = mon(), state = e.createBattleState();
    assert.equal(getAbilityDamageMultiplier({ attacker: a, defender: d, move: e.getMoveByName('Pound'), effectiveness: 1, battleState: state }), 1.3);
    assert.equal(getAbilityDamageMultiplier({ attacker: a, defender: d, move: e.getMoveByName('Thunderbolt'), effectiveness: 1, battleState: state }), 1);
});
test('Intimidate cannot lower a target behind Substitute; Clear Body and Contrary still apply', () => {
    const d = mon(); e.ensureBattleData(d).substituteHp = 100; enter(mon('Intimidate'), d); assert.equal(stage(d, 'attack'), 0);
    const protectedMon = mon('Clear Body'); enter(mon('Intimidate'), protectedMon); assert.equal(stage(protectedMon, 'attack'), 0);
    const contrary = mon('Contrary'); enter(mon('Intimidate'), contrary); assert.equal(stage(contrary, 'attack'), 1);
});
test('Download compares boosted defences, excluding abilities and held-item multipliers', () => {
    const d = mon(null, { currentDefense: 100, currentSpecialDefense: 150 }); e.ensureBattleData(d).statStages.defense = 2;
    const a = mon('Download'); enter(a, d); assert.equal(stage(a, 'specialAttack'), 1); assert.equal(stage(a, 'attack'), 0);
    const coat = mon('Download'); enter(coat, mon('Fur Coat', { currentDefense: 100, currentSpecialDefense: 150 })); assert.equal(stage(coat, 'attack'), 1);
    const vest = mon('Download'); enter(vest, mon(null, { currentDefense: 100, currentSpecialDefense: 80, heldItem: 'assault_vest' })); assert.equal(stage(vest, 'specialAttack'), 1);
});
for (const ability of ['Flower Gift', 'Zen Mode', 'Receiver']) test(`Trace cannot copy ${ability}`, () => {
    const a = mon('Trace'); enter(a, mon(ability)); assert.equal(a.passiveAbility, 'Trace');
});
test('Trace retries when a copyable opponent enters and activates its entry effect', () => {
    const a = mon('Trace'), first = mon('Forecast'), state = e.createBattleState(); enter(a, first, state); assert.equal(a.passiveAbility, 'Trace');
    e.applySwitchInEffects(mon('Intimidate'), state.sides.enemy, state.sides.player, state, a);
    assert.equal(a.passiveAbility, 'Intimidate');
    clearBattleTransientState([a]); assert.equal(a.passiveAbility, 'Trace');
});
for (const ability of ['Trace', 'Wonder Guard', 'Forecast']) test(`Role Play cannot copy ${ability}`, () => rng(.9, () => {
    const a = mon('Guts'); attack(a, mon(ability), 'Role Play'); assert.equal(a.passiveAbility, 'Guts');
}));
for (const ability of ['Wonder Guard', 'Illusion']) test(`Skill Swap cannot exchange ${ability}`, () => rng(.9, () => {
    const a = mon('Guts'), d = mon(ability); attack(a, d, 'Skill Swap'); assert.equal(a.passiveAbility, 'Guts'); assert.equal(d.passiveAbility, ability);
}));
for (const move of ['Worry Seed', 'Simple Beam']) test(`${move} cannot remove Truant`, () => rng(.9, () => {
    const d = mon('Truant'); attack(mon(), d, move); assert.equal(d.passiveAbility, 'Truant');
}));
test('Entrainment cannot transmit Trace or replace Truant, but can pass an ordinary talent', () => rng(.9, () => {
    const d = mon('Guts'); attack(mon('Trace'), d, 'Entrainment'); assert.equal(d.passiveAbility, 'Guts');
    const truant = mon('Truant'); attack(mon('Guts'), truant, 'Entrainment'); assert.equal(truant.passiveAbility, 'Truant');
    const normal = mon('Guts'); attack(mon('Swift Swim'), normal, 'Entrainment'); assert.equal(normal.passiveAbility, 'Swift Swim');
}));
test('Zen Mode resists Mummy and Gastro Acid', () => rng(.9, () => {
    const a = mon('Zen Mode'); attack(a, mon('Mummy'), 'Pound'); assert.equal(a.passiveAbility, 'Zen Mode');
    const d = mon('Zen Mode'); attack(mon(), d, 'Gastro Acid'); assert(!e.ensureBattleData(d).abilitySuppressed);
}));
test('acquiring Insomnia wakes the target, and copying Limber cures paralysis', () => rng(.9, () => {
    const d = mon('Guts', { status: 'sleep' }); e.ensureBattleData(d).sleepTurns = 3; attack(mon(), d, 'Worry Seed'); assert.equal(d.status, 'normal'); assert.equal(e.ensureBattleData(d).sleepTurns, 0);
    const a = mon('Guts', { status: 'paralyze' }); attack(a, mon('Limber'), 'Role Play'); assert.equal(a.passiveAbility, 'Limber'); assert.equal(a.status, 'normal');
}));
test('Sheer Force blocks Color Change only when the move is actually boosted', () => rng(.9, () => {
    const d = mon('Color Change'); attack(mon('Sheer Force'), d, 'Thunderbolt'); assert.deepEqual(e.ensureBattleData(d).tempTypes, []);
    const normal = mon('Color Change'); attack(mon('Sheer Force'), normal, 'Water Gun'); assert.deepEqual(e.ensureBattleData(normal).tempTypes, ['Water']);
}));
for (const ability of ['Wimp Out', 'Emergency Exit']) test(`Sheer Force suppresses ${ability} on a boosted hit`, () => rng(.9, () => {
    assert(!attack(mon('Sheer Force'), mon(ability, { currentHp: 220 }), 'Thunderbolt').forceSwitch);
}));
test('Sheer Force suppresses Pickpocket on a boosted contact move', () => rng(.9, () => {
    const a = mon('Sheer Force', { heldItem: 'expert_belt' }), d = mon('Pickpocket'); attack(a, d, 'Fire Punch'); assert.equal(a.heldItem, 'expert_belt'); assert(!d.heldItem);
}));
test('Berserk still triggers against an unboosted Sheer Force attack', () => rng(.9, () => {
    const d = mon('Berserk', { currentHp: 220 }); attack(mon('Sheer Force'), d, 'Pound'); assert(d.currentHp < 200); assert.equal(stage(d, 'specialAttack'), 1);
}));

test('Comatose prevents major status, but permits confusion', () => rng(.1, () => {
    const d = mon('Comatose'); attack(mon(),d,'Confuse Ray'); assert(e.ensureBattleData(d).confusionTurns > 0);
}));
for (const ability of ['Insomnia','Vital Spirit','Sweet Veil','Leaf Guard']) test(`Yawn fails immediately against ${ability}`, () => rng(.1, () => {
    const state=e.createBattleState(); state.weather={kind:'sun',turns:1}; const d=mon(ability);
    assert.equal(attack(mon(),d,'Yawn',state).success,false); assert(!e.ensureBattleData(d).delayedStatus);
}));
test('Shed Skin cures major status without removing confusion or attraction', () => rng(.1, () => {
    const a=mon('Shed Skin',{status:'poison'}), b=mon(), state=e.createBattleState();
    Object.assign(e.ensureBattleData(a),{confusionTurns:3,infatuationTurns:3});
    e.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);
    assert.equal(a.status,'normal'); assert.equal(e.ensureBattleData(a).confusionTurns,3); assert.equal(e.ensureBattleData(a).infatuationTurns,3);
}));

test('Trace retries when a formerly uncopyable foe acquires a normal ability', () => rng(.1, () => {
    const a=mon('Trace'), d=mon('Forecast'); attack(a,d,'Worry Seed'); assert.equal(d.passiveAbility,'Insomnia'); assert.equal(a.passiveAbility,'Insomnia');
}));
test('new Own Tempo and Oblivious clear their existing volatile conditions', () => rng(.9, () => {
    const a=mon('Guts'); e.ensureBattleData(a).confusionTurns=3; attack(a,mon('Own Tempo'),'Role Play');
    assert.equal(a.passiveAbility,'Own Tempo'); assert.equal(e.ensureBattleData(a).confusionTurns,0);
    const b=mon('Guts'); Object.assign(e.ensureBattleData(b),{infatuationTurns:3,tauntTurns:3});
    enter(Object.assign(b,{passiveAbility:'Oblivious'}),mon()); assert.equal(e.ensureBattleData(b).infatuationTurns,0); assert.equal(e.ensureBattleData(b).tauntTurns,0);
}));
test('Prankster uses current Dark typing rather than the permanent species type', () => rng(.1, () => {
    const soaked=mon(null,{type1:'Dark'}); e.ensureBattleData(soaked).tempTypes=['Water']; attack(mon('Prankster'),soaked,'Thunder Wave'); assert.equal(soaked.status,'paralyze');
    const dark=mon(); e.ensureBattleData(dark).tempTypes=['Dark']; attack(mon('Prankster'),dark,'Thunder Wave'); assert.equal(dark.status,'normal');
}));

test('Mold Breaker ignores a defensive aura while ordinary attacks still receive it', () => {
    const d=mon('Dark Aura'),state=e.createBattleState(),move=e.getMoveByName('Bite');
    assert.equal(getAbilityDamageMultiplier({attacker:mon('Mold Breaker'),defender:d,move,effectiveness:1,battleState:state}),1);
    assert.equal(getAbilityDamageMultiplier({attacker:mon(),defender:d,move,effectiveness:1,battleState:state}),4/3);
});
test('Flash Fire stored boost has no effect while its ability is suppressed or replaced', () => {
    const a=mon('Flash Fire'),d=mon(),state=e.createBattleState(),move=e.getMoveByName('Flamethrower');e.ensureBattleData(a).flashFireBoost=true;
    const damage=()=>getAbilityDamageMultiplier({attacker:a,defender:d,move,effectiveness:1,battleState:state});
    assert.equal(damage(),1.5);a.__battle.abilitySuppressed=true;assert.equal(damage(),1);a.__battle.abilitySuppressed=false;a.passiveAbility='Mummy';assert.equal(damage(),1);
});

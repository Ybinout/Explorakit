const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('../server/game/battle/battleEngine');
const { clearBattleTransientState } = require('../server/game/battle/battleOutcome');
let serial = 0;
function mon(ability = null, extra = {}) {
    return { uuid: 'ability-review-' + ++serial, name: 'Test', truename: 'Test',
        type1: 'Normal', type2: null, level: 50, maxHp: 400, currentHp: 400,
        currentAttack: 100, currentDefense: 100, currentSpecialAttack: 100,
        currentSpecialDefense: 100, currentSpeed: 100, status: 'normal',
        passiveAbility: ability, abilities: [], movePp: [],
        data: { id: 7, base: { HP: 80, Defense: 80, 'Sp. Defense': 80 } }, ...extra };
}
function rng(value, work) { const before = Math.random; Math.random = () => value; try { return work(); } finally { Math.random = before; } }
function attack(a, b, move, state = e.createBattleState()) {
    return e.useattack(move, a, b, { battleState: state, attackerSide: state.sides.player,
        defenderSide: state.sides.enemy, attackerTeam: [a], defenderTeam: [b], consumePp: false });
}
function end(a, b, state) { return e.processEndOfRound(a, b, state.sides.player, state.sides.enemy, state); }
for (const prevented of ['sleep', 'paralyze', 'taunt']) test('Protean does not change type when prevented by ' + prevented, () => rng(0, () => {
    const a = mon('Protean', { type1: 'Water', status: prevented === 'taunt' ? 'normal' : prevented });
    if (prevented === 'sleep') e.ensureBattleData(a).sleepTurns = 3;
    if (prevented === 'taunt') e.ensureBattleData(a).tauntTurns = 2;
    const r = attack(a, mon(), prevented === 'taunt' ? 'Swords Dance' : 'Thunderbolt');
    assert(r.actionPrevented); assert.deepEqual((a.__battle?.tempTypes?.length ? a.__battle.tempTypes : [a.type1, a.type2].filter(Boolean)), ['Water']);
}));
test('Protean still changes on every executed move under Gen7 rules, with STAB and no permanent mutation', () => rng(.99, () => {
    const a = mon('Protean', { type1: 'Water' }), b = mon(), state = e.createBattleState();
    assert(attack(a, b, 'Thunderbolt', state).damage > attack(mon(), mon(), 'Thunderbolt').damage);
    assert.deepEqual((a.__battle?.tempTypes?.length ? a.__battle.tempTypes : [a.type1, a.type2].filter(Boolean)), ['Electric']); state.turn++;
    attack(a, b, 'Flamethrower', state); assert.deepEqual((a.__battle?.tempTypes?.length ? a.__battle.tempTypes : [a.type1, a.type2].filter(Boolean)), ['Fire']);
    clearBattleTransientState([a]); assert.deepEqual((a.__battle?.tempTypes?.length ? a.__battle.tempTypes : [a.type1, a.type2].filter(Boolean)), ['Water']);
}));
test('Levitate blocks Ground damage but not Sand Attack, including a corrupted Levitate recipient', () => rng(.01, () => {
    const a = mon(), d = mon('Levitate'); const r = attack(a, d, 'Sand Attack');
    assert(!r.blocked); assert.equal(e.ensureBattleData(d).statStages.accuracy, -1);
    assert.equal(attack(a, mon('Levitate'), 'Earthquake').damage, 0);
    assert(attack(mon('Mold Breaker'), mon('Levitate'), 'Earthquake').damage > 0);
}));
test('Synchronize returns bad poison as bad poison under the engine Gen7 rules', () => rng(.01, () => {
    const a = mon(), d = mon('Synchronize'); attack(a, d, 'Toxic');
    assert.equal(d.status, 'badly_poison'); assert.equal(a.status, 'badly_poison');
    assert.equal(e.ensureBattleData(a).toxicCounter, 1);
}));
test('Synchronize can paralyze a Ground-type source, while Safeguard still protects the source', () => rng(.01, () => {
    const a = mon(null, { type1: 'Ground' }), d = mon('Synchronize'), state = e.createBattleState();
    attack(a, d, 'Thunder Wave', state); assert.equal(d.status, 'paralyze'); assert.equal(a.status, 'paralyze');
    const protectedSource = mon(), other = mon('Synchronize'), guarded = e.createBattleState();
    guarded.sides.player.screens.safeguardTurns = 3; attack(protectedSource, other, 'Thunder Wave', guarded);
    assert.equal(other.status, 'paralyze'); assert.equal(protectedSource.status, 'normal');
}));
test('Synchronize still respects major status immunities and never reflects an orb to the opponent', () => rng(.01, () => {
    const immune = mon('Immunity'); attack(immune, mon('Synchronize'), 'Toxic'); assert.equal(immune.status, 'normal');
    const a = mon('Synchronize', { heldItem: 'toxic_orb' }), d = mon(), state = e.createBattleState();
    end(a, d, state); assert.equal(a.status, 'badly_poison'); assert.equal(d.status, 'normal');
}));
test('Shield Dust prevents Poison Touch; suppressing Shield Dust allows the same contact roll', () => rng(.1, () => {
    const d = mon('Shield Dust'); attack(mon('Poison Touch'), d, 'Pound'); assert.equal(d.status, 'normal');
    const suppressed = mon('Shield Dust'); e.ensureBattleData(suppressed).abilitySuppressed = true;
    attack(mon('Poison Touch'), suppressed, 'Pound'); assert.equal(suppressed.status, 'poison');
}));
for (const [ability, move] of [['Water Absorb', 'Water Gun'], ['Volt Absorb', 'Thunderbolt'], ['Dry Skin', 'Water Gun']]) test(ability + ' retains immunity but cannot heal under Heal Block', () => rng(.99, () => {
    const d = mon(ability, { currentHp: 200 }); e.ensureBattleData(d).healBlockTurns = 3;
    const r = attack(mon(), d, move); assert(r.blocked); assert.equal(d.currentHp, 200);
    const ordinary = mon(ability, { currentHp: 200 }); attack(mon(), ordinary, move); assert.equal(ordinary.currentHp, 300);
}));
for (const move of ['Thief', 'Covet']) test('Mold Breaker bypasses Sticky Hold for ' + move + ', preserving item ownership after combat', () => rng(.99, () => {
    const a = mon('Mold Breaker'), d = mon('Sticky Hold', { heldItem: 'leftovers' });
    attack(a, d, move); assert.equal(a.heldItem, 'leftovers'); assert.equal(d.heldItem, null);
    clearBattleTransientState([a, d]); assert(!a.heldItem); assert.equal(d.heldItem, 'leftovers');
    const ordinary = mon(), protectedMon = mon('Sticky Hold', { heldItem: 'leftovers' });
    attack(ordinary, protectedMon, move); assert(!ordinary.heldItem); assert.equal(protectedMon.heldItem, 'leftovers');
}));
for (const ability of ['Magic Guard', 'Poison Heal']) test('Bad poison counter advances under ' + ability + ' and resumes properly after suppression', () => rng(.99, () => {
    const a = mon(ability, { status: 'badly_poison' }), d = mon(), state = e.createBattleState();
    end(a, d, state); end(a, d, state); assert.equal(a.currentHp, 400);
    e.ensureBattleData(a).abilitySuppressed = true; end(a, d, state);
    assert.equal(a.currentHp, 325); assert.equal(e.ensureBattleData(a).toxicCounter, 4);
}));
test('Magic Guard prevents Powder damage but the powdered Fire move still fails', () => rng(.99, () => {
    const a = mon('Magic Guard'); e.ensureBattleData(a).powdered = true;
    const r = attack(a, mon(), 'Flamethrower'); assert(r.actionPrevented); assert.equal(a.currentHp, 400);
    const plain = mon(); e.ensureBattleData(plain).powdered = true;
    assert(attack(plain, mon(), 'Flamethrower').actionPrevented); assert.equal(plain.currentHp, 300);
}));

test('Protean is not triggered by display metadata, calling moves that fail, or delayed attacks', () => rng(.99, () => {
    const a = mon('Protean', { type1: 'Water', abilities: ['Hidden Power', 'Sleep Talk', 'Future Sight'], iv: {hp:0,attack:0,defense:0,speed:0,specialAttack:0,specialDefense:0} }), d = mon(), state = e.createBattleState();
    e.battleMoveTypes(a, d, state); assert(!a.__battle?.tempTypes?.length);
    attack(a, d, 'Sleep Talk', state); assert(!a.__battle?.tempTypes?.length);
    attack(a, d, 'Future Sight', state); assert(!a.__battle?.tempTypes?.length);
    end(a, d, state); end(a, d, state); end(a, d, state); assert(!a.__battle?.tempTypes?.length);
}));
for (const [ability, stat] of [['Big Pecks', 'defense'], ['White Smoke', 'attack'], ['Keen Eye', 'accuracy']]) test(ability + ' blocks opponent drops but allows its own drops', () => {
    const a = mon(ability); e.applyStageChange(a, stat, -1, [], mon()); assert.equal(e.ensureBattleData(a).statStages[stat], 0);
    e.applyStageChange(a, stat, -1, [], a); assert.equal(e.ensureBattleData(a).statStages[stat], -1);
});
for (const [ability, stat] of [['Lightning Rod', 'specialAttack'], ['Motor Drive', 'speed']]) test(ability + ' absorbs Electric attacks and raises the right stat', () => rng(.99, () => {
    const a = mon(ability); assert(attack(mon(), a, 'Thunderbolt').blocked); assert.equal(a.currentHp, 400); assert.equal(e.ensureBattleData(a).statStages[stat], 1);
}));
for (const [ability, extra, ratio] of [['Pure Power', {}, 2], ['Hustle', {}, 1.5]]) test(ability + ' strengthens physical attacks in real damage resolution', () => rng(.1, () => {
    const base = attack(mon(null, extra), mon(), 'Pound').damage, gain = attack(mon(ability, extra), mon(), 'Pound').damage;
    assert(Math.abs(gain - base * ratio) <= 3);
}));
test('Hustle lowers only physical accuracy and Keen Eye ignores boosted evasion', () => rng(.9, () => {
    assert(attack(mon('Hustle'), mon(), 'Pound').missed); assert(!attack(mon('Hustle'), mon(), 'Water Gun').missed);
    const a = mon('Keen Eye'), d = mon(); e.ensureBattleData(d).statStages.evasion = 6;
    assert(!attack(a, d, 'Pound').missed); assert(attack(mon(), d, 'Pound').missed);
}));
for (const ability of ['Filter', 'Solid Rock']) test(ability + ' reduces only super-effective damage', () => rng(.99, () => {
    const extra = { type1: 'Rock' }, base = attack(mon(), mon(null, extra), 'Water Gun').damage;
    assert(Math.abs(attack(mon(), mon(ability, extra), 'Water Gun').damage - base * .75) <= 1);
    assert.equal(attack(mon(), mon(ability), 'Pound').damage, attack(mon(), mon(), 'Pound').damage);
}));
test('Multiscale requires full HP; Marvel Scale requires a major status', () => rng(.99, () => {
    const base = attack(mon(), mon(), 'Pound').damage;
    assert(Math.abs(attack(mon(), mon('Multiscale'), 'Pound').damage - base / 2) <= 1);
    assert.equal(attack(mon(), mon('Multiscale', {currentHp:399}), 'Pound').damage, base);
    assert.equal(attack(mon(), mon('Marvel Scale'), 'Pound').damage, base);
    assert(attack(mon(), mon('Marvel Scale', {status:'burn'}), 'Pound').damage < base);
}));
test('Shell Armor prevents critical hits; Super Luck raises their chance; Sniper increases their damage', () => {
    rng(0, () => { const normal = attack(mon(), mon(), 'Pound'); assert(normal.critical);
        assert(!attack(mon(), mon('Shell Armor'), 'Pound').critical);
        assert(Math.abs(attack(mon('Sniper'), mon(), 'Pound').damage - normal.damage * 1.5) <= 1); });
    rng(.07, () => { assert(!attack(mon(), mon(), 'Pound').critical); assert(attack(mon('Super Luck'), mon(), 'Pound').critical); });
});
test('Magma Armor prevents freeze, and Overcoat prevents powders and hail damage', () => rng(.01, () => {
    assert(!e.applyStatus(mon('Magma Armor'), 'freeze', null, []));
    const a = mon('Overcoat'), state = e.createBattleState(); state.weather = {kind:'hail',turns:5};
    attack(mon(), a, 'Spore', state); assert.equal(a.status, 'normal'); end(a, mon(), state); assert.equal(a.currentHp, 400);
}));
test('Sand Rush doubles Speed in sand; Sand Veil raises evasion and prevents sand damage', () => rng(.9, () => {
    const state = e.createBattleState(); state.weather = {kind:'sandstorm',turns:5};
    assert.equal(e.getBattleSpeed(mon('Sand Rush'), null, state), 200);
    const a = mon('Sand Veil'); assert(attack(mon(), a, 'Pound', state).missed); end(a, mon(), state); assert.equal(a.currentHp, 400);
}));
test('Solar Power boosts special damage in sun, costs HP, and is suppressed by Cloud Nine', () => rng(.99, () => {
    const state = e.createBattleState(); state.weather = {kind:'sun',turns:5};
    const a = mon('Solar Power'), d = mon(), base = attack(mon(), mon(), 'Water Gun', state).damage;
    assert(Math.abs(attack(a, d, 'Water Gun', state).damage - base * 1.5) <= 3); end(a, d, state); assert.equal(a.currentHp, 350);
    const blocked = mon('Solar Power'); end(blocked, mon('Cloud Nine'), state); assert.equal(blocked.currentHp, 400);
}));
test('Swarm boosts Bug attacks only at one third HP or less', () => rng(.99, () => {
    const base = attack(mon(), mon(), 'Bug Bite').damage;
    assert(Math.abs(attack(mon('Swarm', {currentHp:133}), mon(), 'Bug Bite').damage - base * 1.5) <= 1);
    assert.equal(attack(mon('Swarm', {currentHp:134}), mon(), 'Bug Bite').damage, base);
}));
test('Suction Cups stops phazing unless Mold Breaker bypasses it', () => rng(.99, () => {
    assert(!attack(mon(), mon('Suction Cups'), 'Roar').forceSwitch);
    assert(attack(mon('Mold Breaker'), mon('Suction Cups'), 'Roar').forceSwitch);
}));
for (const ability of ['Frisk', 'Forewarn']) test(ability + ' provides an entry hint without changing the opponent', () => {
    const a = mon(ability), d = mon(null, {heldItem:'leftovers',abilities:['Growl','Hyper Beam','Pound']});
    const before = structuredClone(d), state = e.createBattleState();
    const messages = e.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,d);
    assert(messages.some(s=>s.includes(ability==='Frisk'?'leftovers':'Hyper Beam'))); assert.equal(d.heldItem,before.heldItem); assert.deepEqual(d.abilities,before.abilities);
});
test('Analytic boosts a hit after a voluntary opposing switch, without boosting a first hit on an unmoved target', () => rng(.99, () => {
    const a = mon('Analytic'), d = mon(), outgoing = mon(), state = e.createBattleState();
    const plan = require('../server/game/battle/turnActions');
    plan.planTurnActions(state,[{pokemon:a,action:'attack',moveName:'Pound'},{pokemon:outgoing,action:'switch'}]);
    plan.spendTurnAction(state,outgoing); e.ensureBattleData(d).switchedInTurn = state.turn;
    const base = attack(mon(),mon(),'Pound').damage;
    assert(Math.abs(attack(a,d,'Pound',state).damage-base*1.3)<=1);
    assert.equal(attack(mon('Analytic'),mon(),'Pound').damage,base);
}));
for (const move of ['Fissure', 'Counter', 'Grass Knot']) test('Forewarn ranks the nonstandard power of ' + move + ' above Pound', () => {
    const a = mon('Forewarn'), d = mon(null, {abilities:['Pound',move]}), state = e.createBattleState();
    assert(e.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,d).some(s=>s.includes(move)));
});
test('Forewarn stays silent against a set containing only status moves', () => {
    const state = e.createBattleState(); assert(!e.applySwitchInEffects(mon('Forewarn'),state.sides.player,state.sides.enemy,state,mon(null,{abilities:['Growl','Splash']})).some(s=>s.includes('Forewarn')));
});
const dex = require('../data/game/pokedex.json'), abilityDex = require('../server/game/abilities/abilityDex'), coverage = require('../server/game/abilities/abilityCoverage');
const supportedSpecies = dex.filter(p=>p.id<=649), studied = [...new Set(supportedSpecies.flatMap(p=>abilityDex.getSpeciesAbilitySlots(p.id).map(a=>a.name)))].sort();
test('Review scope is 167 unique Gen1–5 abilities: 160 singles, five doubles, Illuminate overworld and Honey Gather pending', () => {
    assert.equal(studied.length,167); assert.equal(studied.filter(n=>coverage.status(n)==='single_battle').length,160);
    assert.deepEqual(studied.filter(n=>coverage.status(n)==='double_only'),['Friend Guard','Healer','Minus','Plus','Telepathy']);
    assert.deepEqual(studied.filter(n=>coverage.status(n)==='overworld_pending'),['Honey Gather']);
});
for (const ability of studied.filter(n=>coverage.status(n)==='single_battle')) test('Complete shared lifecycle, snapshot and permanent identity: ' + ability, () => rng(.8, () => {
    const factory = require('../server/game/drift/pokemonFactory'), codec = require('../server/game/drift/checkpointCodec');
    const species = supportedSpecies.find(p=>abilityDex.getSpeciesAbilitySlots(p.id).some(a=>a.name===ability));
    const a = factory.create(species.id,50,true), d = factory.create(143,50,true), state = e.createBattleState();
    a.passiveAbility=ability; d.passiveAbility=null; a.heldItem=d.heldItem=null;
    a.abilities=['Pound','Swords Dance']; a.movePp=[35,20]; d.abilities=['Splash']; d.movePp=[40];
    const before={id:a.data.id,k:a.k,iv:structuredClone(a.iv),ev:structuredClone(a.ev),nature:a.nature};
    e.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,d);
    e.applySwitchInEffects(d,state.sides.enemy,state.sides.player,state,a);
    attack(a,d,'Swords Dance',state); state.turn++; attack(a,d,'Pound',state); end(a,d,state);
    const restored=codec.decode(codec.encode({a,d,state})).a;
    assert.equal(restored.currentHp,a.currentHp); assert.deepEqual(restored.__battle,a.__battle);
    clearBattleTransientState([restored]);
    assert.equal(restored.passiveAbility,ability); assert.deepEqual(restored.abilities,['Pound','Swords Dance']);
    assert.deepEqual({id:restored.data.id,k:restored.k,iv:restored.iv,ev:restored.ev,nature:restored.nature},before);
}));

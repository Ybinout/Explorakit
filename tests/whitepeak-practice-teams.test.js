const test = require('node:test');
const assert = require('node:assert/strict');
const trainers = require('../server/game/whitepeak/trainers');
const engine = require('../server/game/battle/battleEngine');
const resources = require('../server/game/battle/battleResources');
const Pokemon = require('../server/game/models/Pokemon');
const progression = require('../server/game/models/progression');
const dex = require('../data/game/pokedex.json');
const machines = Object.values(require('../data/game/machines.json').machines);
const corruption = require('../server/game/corruption/pokemon');
const held = require('../server/game/items/heldItems');
const abilities = require('../server/game/abilities/abilityDex');
const keys = ['practice_spectral_rush', 'practice_rain_current', 'practice_sand_balance'];

for (const key of keys) test(`${key} offers a complete, legal K4 roster with one modest corruption and unique working items`, () => {
    const entry = trainers.list().find(t => t.key === key);
    assert(entry);
    assert.equal(entry.species.length, 6);
    assert.equal(new Set(entry.species).size, 6);
    const team = trainers.create(key, Array.from({length: 6}, (_, i) => ({level: 80 + i * 5})), 100, {uniqueItems: true}).pokemons;
    assert.deepEqual(team.map(p => p.data.id), entry.species);
    assert.equal(team.filter(corruption.corrupted).length, 1);
    assert.equal(team[0].data.id, 94);
    assert.equal(new Set(team.map(p => p.heldItem)).size, 6);
    for (const p of team) {
        assert.equal(p.level, 100);
        assert.equal(p.k, 4);
        assert(Object.values(p.iv).every(iv => iv === 31));
        assert.equal(Object.values(p.ev).reduce((sum, ev) => sum + ev, 0), 508);
        assert(Object.values(p.ev).every(ev => ev <= 252));
        assert(held.enabled(p, engine.createBattleState()), `${p.truename}: held item disabled`);
        assert.equal(p.abilities.length, 4);
        assert(abilities.getSpeciesAbilitySlots(p.data.id).some(a => a.name === p.passiveAbility));
        for (const [slot, move] of p.abilities.entries()) {
            assert(machines.some(m => m.move === move && m.species.includes(p.data.id)), `${p.truename}: ${move} is not learnable`);
            assert(engine.getMoveByName(move));
            assert.equal(p.movePp[slot], resources.getMaxMovePp(move));
        }
        assert.equal(p.currentHp, p.maxHp);
        if (p.corruption) {
            assert.deepEqual(Object.keys(p.corruption.modules), ['combat']);
            assert.equal(require('../server/game/corruption/balance').penalty(p), 1);
        }
    }
});

test('practice teams retain House level/count adaptation and are fresh independent copies', () => {
    for (const key of keys) for (let count = 1; count <= 6; count++) {
        const own = Array.from({length: count}, (_, i) => ({level: 33 + i * 11}));
        const before = JSON.stringify(own), team = trainers.create(key, own).pokemons;
        assert.equal(team.length, count);
        assert.deepEqual(team.map(p => p.level), own.map(p => p.level));
        assert.equal(team.filter(corruption.corrupted).length, 1);
        assert.equal(JSON.stringify(own), before);
        team[0].abilities[0] = 'Splash'; team[0].ev.hp = 0; team[0].currentHp = 0;
        const again = trainers.create(key, own, 200).pokemons;
        assert(again.every(p => p.level === 200 && p.currentHp === p.maxHp));
        assert.notEqual(again[0].abilities[0], 'Splash');
        assert.notEqual(team[0].uuid, again[0].uuid);
    }
});

test('the three practice teams supply hazards, priority and distinct weather plans', () => {
    const teams = keys.map(key => trainers.create(key, Array(6).fill({level: 100})).pokemons);
    for (const team of teams) {
        assert(team.some(p => p.abilities.includes('Stealth Rock')));
        assert(team.some(p => p.abilities.some(m => engine.getMoveByName(m).combat.priority > 0 && engine.getMoveByName(m).combat.damage_class !== 'status')));
    }
    assert(teams[1].some(p => p.passiveAbility === 'Drizzle'));
    assert.equal(teams[1].filter(p => p.passiveAbility === 'Swift Swim').length, 2);
    assert(teams[2].some(p => p.passiveAbility === 'Sand Stream'));
    assert(teams[2].some(p => p.passiveAbility === 'Unaware'));
    assert.notDeepEqual(teams[0].map(p => p.data.id), teams[1].map(p => p.data.id));
    assert.notDeepEqual(teams[1].map(p => p.data.id), teams[2].map(p => p.data.id));
});

test('every shipped Rock species is immune to sand through a real complete residual phase', () => {
    const rocks = dex.filter(p => p.id <= 649 && p.type.includes('Rock'));
    assert(rocks.length > 30);
    for (const species of rocks) {
        const p = new Pokemon(species.id, null, null, progression.getTotalExperienceForLevel(100, progression.getExperienceRate(species.exp)));
        const foe = new Pokemon(143, null, null, progression.getTotalExperienceForLevel(100, 1));
        p.passiveAbility = null; p.heldItem = null; foe.passiveAbility = null; foe.heldItem = null;
        engine.ensureBattleData(p); engine.ensureBattleData(foe);
        const state = engine.createBattleState(); state.weather = {kind: 'sandstorm', turns: 0, persistent: true};
        const before = p.currentHp, enemyBefore = foe.currentHp;
        const messages = engine.processEndOfRound(p, foe, state.sides.player, state.sides.enemy, state);
        assert.equal(p.currentHp, before, species.name.english);
        assert.equal(foe.currentHp, enemyBefore - Math.max(1, Math.floor(foe.maxHp / 16)));
        assert(messages.some(m => m.includes('tempête de sable')));
    }
});

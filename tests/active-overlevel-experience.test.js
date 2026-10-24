const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBattleExperience, reduceActiveOverlevelExperience, BATTLE_EXPERIENCE_MULTIPLIERS, EXPEDITION_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
const { AdventureExperience } = require('../server/game/battle/adventureExperience');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const factory = require('../server/game/drift/pokemonFactory');

test('active penalty starts at five levels, composes with existing scaling and never removes XP', () => {
    for (const enemyLevel of [2, 20, 60, 100]) for (const lead of [-5, 0, 4, 5, 6, 20]) {
        const enemy = { level: enemyLevel }, active = { level: Math.max(1, enemyLevel + lead) };
        assert.equal(reduceActiveOverlevelExperience(101, enemy, active), lead >= 5 ? 70 : 101);
    }
    assert.equal(reduceActiveOverlevelExperience(1, {level: 2}, {level: 100}), 1);
    assert.equal(reduceActiveOverlevelExperience(0, {level: 2}, {level: 100}), 0);
    assert.equal(reduceActiveOverlevelExperience(101, {}, {level: 100}), 101);
});

for (const kind of ['wild', 'trainer', 'arena']) for (const lead of [4, 5, 6]) for (const expShare of [false, true]) {
    test(`Adventure ${kind} +${lead}, Multi Exp ${expShare}: only current fighter penalized, shares and replay preserved`, () => {
        const reserve = factory.create(1, 20 + lead), active = factory.create(7, 20 + lead), enemy = factory.create(19, 20);
        // Original lead is now in reserve after a switch; current combat order wins.
        reserve.battlePartySlot = 0; active.battlePartySlot = 1;
        const player = {id: 'test', equipe: {pokemons: [active, reserve]}};
        const tracker = new AdventureExperience({expShare});
        tracker.enter(reserve, enemy); tracker.enter(active, enemy);
        const base = calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS[kind], active);
        const originalActive = Math.floor(base * (expShare ? 1 : 0.5));
        const expectedActive = lead >= 5 ? Math.max(1, Math.floor(originalActive * 0.7)) : originalActive;
        const expectedReserve = Math.floor(base * (expShare ? 0.4 : 0.5));
        const before = player.equipe.pokemons.map(p => p.experience), events = [];
        enemy.currentHp = 0;
        tracker.reward(player, enemy, BATTLE_EXPERIENCE_MULTIPLIERS[kind], {to: () => ({emit: (name, payload) => events.push(payload)})});
        assert.deepEqual(player.equipe.pokemons.map((p, i) => p.experience - before[i]), [expectedActive, expectedReserve]);
        assert.deepEqual(events.map(e => e.xpGained), [expectedActive, expectedReserve]);
        assert.deepEqual(tracker.reward(player, enemy, 1, null), []);
    });
}

for (const mode of ['rift', 'colosseum']) for (const kind of ['wild', 'trainer', 'arena']) for (const lead of [4, 5, 6]) {
    test(`${mode} ${kind} +${lead}: active XP reduced without reducing Multi Exp or native reserve share`, () => {
        const active = factory.create(1, 20 + lead), reserve = factory.create(7, 20 + lead), enemy = factory.create(19, 20);
        active.heldItem = 'exp_share';
        const player = {run: {mode}, equipe: {pokemons: [active, reserve]}, drifts: [], equipped: []};
        const base = calculateBattleExperience(enemy, EXPEDITION_EXPERIENCE_MULTIPLIERS[kind], active);
        const sharing = mode === 'colosseum' ? Math.floor(base * 48 / 10) : base * 2;
        const fighter = mode === 'colosseum' ? Math.max(1, Math.floor(Math.floor(sharing * 9 / 10) * 4 / 5)) : sharing;
        const expected = lead >= 5 ? Math.max(1, Math.floor(fighter * 0.7)) : fighter;
        const reserveExpected = Math.max(mode === 'colosseum' ? Math.floor(sharing * 0.4) : 0, Math.max(1, Math.floor(fighter / 2)));
        const before = [active.experience, reserve.experience], events = [];
        const battle = Object.assign(Object.create(DriftBattle.prototype), {type: kind, a: player, rewarded: new Set(), emit: (_, name, payload) => events.push(payload)});
        battle.reward(enemy); battle.reward(enemy);
        assert.deepEqual([active.experience - before[0], reserve.experience - before[1]], [expected, reserveExpected]);
        assert.deepEqual(events.map(e => e.xpGained), [expected, reserveExpected]);
    });
}

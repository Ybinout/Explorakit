const test = require('node:test');
const assert = require('node:assert/strict');
const Pokemon = require('../server/game/models/Pokemon');
const {
    chooseSpeciesAbility,
    evolveSpeciesAbility,
    getSpeciesAbilitySlots
} = require('../server/game/abilities/abilityDex');
const {
    FAMILY_ABILITIES,
    getAbilitySpeedMultiplier
} = require('../server/game/abilities/abilityEngine');
const {
    applySwitchInEffects,
    createBattleState,
    ensureBattleData,
    getMovePriority,
    processEndOfRound,
    useattack
} = require('../server/game/battle/battleEngine');
const { switchPokemonByIndex } = require('../server/game/battle/battleTeam');

function createPokemon(overrides = {}) {
    return Object.assign({
        uuid: `ability-${Math.random()}`,
        name: 'Testmon',
        truename: 'Testmon',
        type1: 'Normal',
        type2: null,
        level: 50,
        maxHp: 200,
        currentHp: 200,
        currentAttack: 100,
        currentDefense: 100,
        currentSpecialAttack: 100,
        currentSpecialDefense: 100,
        currentSpeed: 100,
        status: 'normal',
        passiveAbility: null,
        abilities: ['Pound'],
        data: { base: { HP: 80, Defense: 80, 'Sp. Defense': 80 } }
    }, overrides);
}

function attack(moveName, attacker, defender, state = createBattleState(), options = {}) {
    return useattack(moveName, attacker, defender, {
        battleState: state,
        attackerSide: state.sides.player,
        defenderSide: state.sides.enemy,
        attackerTeam: [attacker],
        defenderTeam: [defender],
        ...options
    });
}

function withoutCritical(work) {
    const previousRandom = Math.random;
    Math.random = () => 0.99;
    try {
        return work();
    } finally {
        Math.random = previousRandom;
    }
}

test('les 809 Pokemon ont leurs vrais slots de talents Gen 7', () => {
    for (let id = 1; id <= 809; id += 1) {
        assert.ok(getSpeciesAbilitySlots(id).length > 0, `Pokemon #${id}`);
    }
    assert.deepEqual(
        getSpeciesAbilitySlots(1).map(({ name, hidden }) => ({ name, hidden })),
        [
            { name: 'Overgrow', hidden: false },
            { name: 'Chlorophyll', hidden: true }
        ]
    );
    assert.equal(chooseSpeciesAbility(1, () => 0), 'Chlorophyll');
    assert.equal(chooseSpeciesAbility(1, () => 0.99), 'Overgrow');
    assert.equal(chooseSpeciesAbility(809, () => 0), 'Iron Fist');
    assert.ok(getSpeciesAbilitySlots(658).some((slot) => slot.name === 'Battle Bond' && slot.special));
    assert.notEqual(chooseSpeciesAbility(658, () => 0), 'Battle Bond');
    assert.notEqual(chooseSpeciesAbility(658, () => 0.99), 'Battle Bond');
    assert.equal(evolveSpeciesAbility(1, 2, 'Overgrow', () => 0.99), 'Overgrow');
    assert.equal(evolveSpeciesAbility(1, 2, 'Chlorophyll', () => 0.99), 'Chlorophyll');
    const pikachu = new Pokemon(25, 'Pika', 1, 0);
    assert.ok(getSpeciesAbilitySlots(25).some((slot) => slot.name === pikachu.passiveAbility));
});

test('les quatre familles de talents sont declarees et auditees separement', () => {
    assert.deepEqual(Object.keys(FAMILY_ABILITIES), [
        'immunity_absorption',
        'switch_entry',
        'damage_stats',
        'weather_terrain'
    ]);
    for (const abilities of Object.values(FAMILY_ABILITIES)) assert.ok(abilities.length > 0);
});

test('les absorptions, Levitation et Brise Moule modifient les attaques', () => withoutCritical(() => {
    const state = createBattleState();
    const waterAbsorb = createPokemon({ passiveAbility: 'Water Absorb', currentHp: 100 });
    const waterResult = attack('Water Gun', createPokemon(), waterAbsorb, state);
    assert.equal(waterResult.blocked, true);
    assert.equal(waterAbsorb.currentHp, 150);

    const levitate = createPokemon({ passiveAbility: 'Levitate' });
    assert.equal(attack('Earthquake', createPokemon(), levitate).damage, 0);

    const moldBreaker = createPokemon({ passiveAbility: 'Mold Breaker' });
    const bypassed = attack('Earthquake', moldBreaker, levitate);
    assert.ok(bypassed.damage > 0);
}));

test("les talents d'entree appliquent meteo, terrain, baisse et copie", () => {
    const state = createBattleState();
    const opponent = createPokemon({ passiveAbility: 'Overgrow', currentDefense: 80, currentSpecialDefense: 120 });
    const intimidator = createPokemon({ passiveAbility: 'Intimidate' });
    applySwitchInEffects(intimidator, state.sides.player, state.sides.enemy, state, opponent);
    assert.equal(ensureBattleData(opponent).statStages.attack, -1);

    const drizzle = createPokemon({ passiveAbility: 'Drizzle' });
    applySwitchInEffects(drizzle, state.sides.player, state.sides.enemy, state, opponent);
    assert.equal(state.weather.kind, 'rain');
    assert.equal(state.weather.turns, 5);

    const surge = createPokemon({ passiveAbility: 'Electric Surge' });
    applySwitchInEffects(surge, state.sides.player, state.sides.enemy, state, opponent);
    assert.equal(state.terrain.kind, 'electric_terrain');

    const tracer = createPokemon({ passiveAbility: 'Trace' });
    applySwitchInEffects(tracer, state.sides.player, state.sides.enemy, state, opponent);
    assert.equal(tracer.passiveAbility, 'Overgrow');
});

test('les multiplicateurs offensifs, defensifs, priorites et recul sont actifs', () => withoutCritical(() => {
    const control = createPokemon();
    const defender = createPokemon();
    const baseDamage = attack('Pound', control, defender).damage;

    const hugePower = createPokemon({ passiveAbility: 'Huge Power' });
    const boostedDamage = attack('Pound', hugePower, createPokemon()).damage;
    assert.ok(boostedDamage > baseDamage * 1.8);

    const thickFatTarget = createPokemon({ passiveAbility: 'Thick Fat' });
    const normalFireDamage = attack('Flamethrower', createPokemon(), createPokemon()).damage;
    const reducedFireDamage = attack('Flamethrower', createPokemon(), thickFatTarget).damage;
    assert.ok(reducedFireDamage < normalFireDamage);

    const prankster = createPokemon({ passiveAbility: 'Prankster' });
    assert.equal(getMovePriority('Growl', prankster), 1);

    const recoilUser = createPokemon({ abilities: ['Double-Edge'] });
    attack('Double-Edge', recoilUser, createPokemon());
    assert.ok(recoilUser.currentHp < recoilUser.maxHp);
    const rockHead = createPokemon({ passiveAbility: 'Rock Head', abilities: ['Double-Edge'] });
    attack('Double-Edge', rockHead, createPokemon());
    assert.equal(rockHead.currentHp, rockHead.maxHp);
}));

test('les talents de meteo changent vitesse, soins et suppression', () => {
    const state = createBattleState();
    state.weather.kind = 'rain';
    state.weather.turns = 5;
    const swimmer = createPokemon({ passiveAbility: 'Swift Swim' });
    assert.equal(getAbilitySpeedMultiplier(swimmer, state), 2);

    const rainDish = createPokemon({ passiveAbility: 'Rain Dish', currentHp: 100 });
    const opponent = createPokemon();
    processEndOfRound(rainDish, opponent, state.sides.player, state.sides.enemy, state);
    assert.equal(rainDish.currentHp, 112);

    const suppressedState = createBattleState();
    suppressedState.weather.kind = 'rain';
    suppressedState.weather.turns = 5;
    const airLock = createPokemon({ passiveAbility: 'Air Lock' });
    assert.equal(getAbilitySpeedMultiplier(swimmer, suppressedState, airLock), 1);
});

test('Medic Nature et Regenerator se declenchent a la sortie', () => {
    const naturalCure = createPokemon({ passiveAbility: 'Natural Cure', status: 'burn' });
    const replacement = createPokemon({ uuid: 'replacement' });
    switchPokemonByIndex([naturalCure, replacement], 1);
    assert.equal(naturalCure.status, 'normal');

    const regenerator = createPokemon({ passiveAbility: 'Regenerator', currentHp: 50 });
    switchPokemonByIndex([regenerator, createPokemon({ uuid: 'replacement-2' })], 1);
    assert.equal(regenerator.currentHp, 116);
});

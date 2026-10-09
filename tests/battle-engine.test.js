const test = require('node:test');
const assert = require('node:assert/strict');
const moves = require('../data/game/moves.json');
const {
    createBattleState,
    createSideState,
    ensureBattleData,
    getEffectiveness,
    getBattleSpeed,
    getSpecialMoveResolution,
    orderBattleActions,
    resolveRedirectedTarget,
    processEndOfRound,
    processTurnStart,
    applySwitchInEffects,
    calculateDamage,
    useattack
} = require('../server/game/battle/battleEngine');
const { getMaxMovePp, normalizeMovePp } = require('../server/game/battle/battleResources');
const { resolveMoveSwitches } = require('../server/game/battle/battleTeam');

function createPokemon(overrides = {}) {
    const pokemon = {
        uuid: `pokemon-${Math.random()}`,
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
        abilities: ['Pound'],
        data: { base: { HP: 80, Defense: 80, 'Sp. Defense': 80 } }
    };
    return Object.assign(pokemon, overrides);
}

function withRandom(value, work) {
    const previousRandom = Math.random;
    Math.random = () => value;
    try {
        return work();
    } finally {
        Math.random = previousRandom;
    }
}

function attack(moveName, attacker, defender, battleState = createBattleState(), extraOptions = {}) {
    return useattack(moveName, attacker, defender, {
        battleState,
        attackerSide: battleState.sides.player,
        defenderSide: battleState.sides.enemy,
        attackerTeam: [attacker],
        defenderTeam: [defender],
        ...extraOptions
    });
}

test('les degats distinguent physique et special, ainsi que les coups critiques', () => {
    const attacker = createPokemon({
        type1: 'Ghost',
        currentAttack: 100,
        currentSpecialAttack: 100
    });
    const defender = createPokemon({
        type1: 'Normal',
        currentDefense: 50,
        currentSpecialDefense: 200
    });
    const pound = moves.find((move) => move.ename === 'Pound');
    const waterGun = moves.find((move) => move.ename === 'Water Gun');

    const physicalDamage = withRandom(0.5, () => calculateDamage(attacker, defender, pound));
    const specialDamage = withRandom(0.5, () => calculateDamage(attacker, defender, waterGun));
    const normalDamage = withRandom(0.5, () => calculateDamage(attacker, defender, pound));
    const criticalDamage = withRandom(0, () => calculateDamage(attacker, defender, pound));

    assert.ok(physicalDamage > specialDamage);
    assert.ok(criticalDamage > normalDamage);
});

test('raté, immunité et efficacité exposent un résultat cohérent', () => {
    const attacker = createPokemon({ abilities: ['Hypnosis', 'Earthquake'] });
    const target = createPokemon();
    const missed = withRandom(0.99, () => attack('Hypnosis', attacker, target));

    assert.equal(missed.missed, true);
    assert.equal(missed.success, false);
    assert.equal(getEffectiveness('Electric', 'Ground'), 0);
    assert.equal(getEffectiveness('Fire', 'Grass'), 2);
    assert.equal(getEffectiveness('Fire', 'Water'), 0.5);
    assert.equal(getEffectiveness('Normal', 'Rock'), 0.5);
    assert.equal(getEffectiveness('Normal', 'Steel'), 0.5);
    assert.equal(getEffectiveness('Fire', 'Dragon'), 0.5);
    assert.equal(getEffectiveness('Water', 'Dragon'), 0.5);
    assert.equal(getEffectiveness('Grass', 'Steel'), 0.5);
    assert.equal(getEffectiveness('Ground', 'Ice'), 1);
    assert.equal(getEffectiveness('Fighting', 'Ghost'), 0);
    assert.equal(getEffectiveness('Fairy', 'Fire'), 0.5);

    const immuneTarget = createPokemon({ type1: 'Flying' });
    const immune = withRandom(0.5, () => attack('Earthquake', attacker, immuneTarget));
    assert.equal(immune.effectiveness, 0);
    assert.equal(immune.damage, 0);
});

test('une capacité de statut modifie les statistiques sans infliger de dégâts', () => {
    const attacker = createPokemon({ abilities: ['Growl'] });
    const target = createPokemon({ currentAttack: 120 });
    const result = withRandom(0.5, () => attack('Growl', attacker, target));

    assert.equal(result.success, true);
    assert.equal(result.damage, 0);
    assert.equal(ensureBattleData(target).statStages.attack, -1);
});

test('Hurlement, Demi-Tour et Relais déclenchent leurs changements dans une vraie résolution', () => {
    withRandom(0.5, () => {
        const roarUser = createPokemon({ abilities: ['Roar'] });
        const forcedTarget = createPokemon({ uuid: 'forced-target' });
        const forcedReplacement = createPokemon({ uuid: 'forced-replacement' });
        const roarResult = attack('Roar', roarUser, forcedTarget, createBattleState(), {
            attackerTeam: [roarUser],
            defenderTeam: [forcedTarget, forcedReplacement]
        });
        const roarSwitches = resolveMoveSwitches(
            roarResult,
            [roarUser],
            [forcedTarget, forcedReplacement]
        );
        assert.equal(roarResult.forceSwitch, true);
        assert.equal(roarSwitches.defender.incoming, forcedReplacement);

        const uTurnUser = createPokemon({ abilities: ['U-turn'] });
        const uTurnReplacement = createPokemon({ uuid: 'u-turn-replacement' });
        const uTurnTarget = createPokemon({ type1: 'Grass' });
        const attackerTeam = [uTurnUser, uTurnReplacement];
        const uTurnResult = attack('U-turn', uTurnUser, uTurnTarget, createBattleState(), {
            attackerTeam,
            defenderTeam: [uTurnTarget]
        });
        const uTurnSwitches = resolveMoveSwitches(uTurnResult, attackerTeam, [uTurnTarget]);
        assert.ok(uTurnResult.damage > 0);
        assert.equal(uTurnResult.switchSelf, true);
        assert.equal(uTurnSwitches.attacker.incoming, uTurnReplacement);

        const batonUser = createPokemon({ abilities: ['Baton Pass'] });
        const batonReplacement = createPokemon({ uuid: 'baton-replacement' });
        ensureBattleData(batonUser).statStages.attack = 2;
        const batonTeam = [batonUser, batonReplacement];
        const batonResult = attack('Baton Pass', batonUser, createPokemon(), createBattleState(), {
            attackerTeam: batonTeam
        });
        const batonSwitches = resolveMoveSwitches(batonResult, batonTeam, []);
        assert.equal(batonResult.batonPass, true);
        assert.equal(batonSwitches.attacker.incoming, batonReplacement);
        assert.equal(ensureBattleData(batonReplacement).statStages.attack, 2);
    });
});

test('les immunites de statut et les terrains empechent les statuts invalides', () => {
    withRandom(0.1, () => {
        const fireTarget = createPokemon({ type1: 'Fire' });
        attack('Will-O-Wisp', createPokemon(), fireTarget);
        assert.equal(fireTarget.status, 'normal');

        const steelTarget = createPokemon({ type1: 'Steel' });
        attack('Toxic', createPokemon(), steelTarget);
        assert.equal(steelTarget.status, 'normal');

        const groundTarget = createPokemon({ type1: 'Ground' });
        attack('Thunder Wave', createPokemon(), groundTarget);
        assert.equal(groundTarget.status, 'normal');

        const electricTerrain = createBattleState();
        electricTerrain.terrain.kind = 'electric_terrain';
        const groundedTarget = createPokemon();
        attack('Spore', createPokemon(), groundedTarget, electricTerrain);
        assert.equal(groundedTarget.status, 'normal');
    });
});

test('paralysie, attirance et sommeil differe ont un cycle de vie fini', () => {
    const paralyzed = createPokemon({ status: 'paralyze', currentSpeed: 120 });
    assert.equal(getBattleSpeed(paralyzed), 60);

    const attracted = createPokemon();
    ensureBattleData(attracted).infatuationTurns = 2;
    withRandom(0.9, () => {
        processTurnStart(attracted, { move: { ename: 'Pound', combat: { damage_class: 'physical' } } });
        processTurnStart(attracted, { move: { ename: 'Pound', combat: { damage_class: 'physical' } } });
    });
    assert.equal(ensureBattleData(attracted).infatuationTurns, 0);

    const state = createBattleState();
    const sleepy = createPokemon();
    const enemy = createPokemon({ uuid: 'enemy' });
    withRandom(0.1, () => attack('Yawn', enemy, sleepy, state));
    processEndOfRound(sleepy, enemy, state.sides.enemy, state.sides.player, state);
    assert.equal(sleepy.status, 'normal');
    withRandom(0.1, () => processEndOfRound(sleepy, enemy, state.sides.enemy, state.sides.player, state));
    assert.equal(sleepy.status, 'sleep');
});

test('les cas speciaux de degats ne sont plus des attaques a zero degat', () => {
    withRandom(0.5, () => {
        const attacker = createPokemon({ level: 50 });
        const defender = createPokemon();
        const dragonRage = attack('Dragon Rage', attacker, defender);
        assert.equal(dragonRage.damage, 40);

        defender.currentHp = 200;
        const seismicToss = attack('Seismic Toss', attacker, defender);
        assert.equal(seismicToss.damage, 50);

        const counterUser = createPokemon();
        const opponent = createPokemon();
        const firstHit = attack('Pound', opponent, counterUser);
        const counter = attack('Counter', counterUser, opponent);
        assert.ok(firstHit.damage > 0);
        assert.equal(counter.damage, Math.min(opponent.maxHp, firstHit.damage * 2));
    });
});

test('toutes les capacites special_case possedent une resolution explicite', () => {
    const attacker = createPokemon();
    const defender = createPokemon();
    const specialMoves = moves.filter((move) => move.combat?.power_type === 'special_case');
    const unsupported = specialMoves
        .filter((move) => getSpecialMoveResolution(move, attacker, defender, { attackerTeam: [attacker] })?.unsupported)
        .map((move) => move.ename);
    assert.deepEqual(unsupported, []);
});

test('les effets auparavant inconnus modifient vraiment le combat', () => {
    withRandom(0.5, () => {
        const attacker = createPokemon({ currentAttack: 140, currentDefense: 70 });
        const defender = createPokemon({ type1: 'Normal' });
        attack('Trick-or-Treat', attacker, defender);
        assert.ok(ensureBattleData(defender).tempTypes.includes('Ghost'));

        attack('Power Trick', attacker, defender);
        assert.equal(attacker.currentAttack, 70);
        assert.equal(attacker.currentDefense, 140);

        attacker.currentHp = 40;
        defender.currentHp = 160;
        attack('Pain Split', attacker, defender);
        assert.equal(attacker.currentHp, 100);
        assert.equal(defender.currentHp, 100);
    });
});

test('Toile Gluante ralentit le prochain Pokemon qui entre au combat', () => {
    const state = createBattleState();
    const attacker = createPokemon();
    const defender = createPokemon();
    attack('Sticky Web', attacker, defender, state);
    assert.equal(state.sides.enemy.hazards.stickyWeb, true);

    const replacement = createPokemon();
    applySwitchInEffects(replacement, state.sides.enemy, state.sides.player, state);
    assert.equal(ensureBattleData(replacement).statStages.speed, -1);
});

test('une attaque OHKO echoue toujours contre un Pokemon de niveau superieur', () => {
    const attacker = createPokemon({ level: 20 });
    const defender = createPokemon({ level: 50 });
    const result = withRandom(0, () => attack('Fissure', attacker, defender));
    assert.equal(result.missed, true);
    assert.equal(defender.currentHp, defender.maxHp);
});

test('Anti-Soin bloque totalement Repos et les soins directs', () => {
    const user = createPokemon({ currentHp: 40 });
    const opponent = createPokemon();
    ensureBattleData(user).healBlockTurns = 3;
    const result = withRandom(0.5, () => attack('Rest', user, opponent));
    assert.equal(result.success, false);
    assert.equal(user.currentHp, 40);
    assert.equal(user.status, 'normal');
});

test('Poudre et Lien du Destin ont des consequences reelles', () => {
    withRandom(0.99, () => {
        const powderUser = createPokemon();
        const fireUser = createPokemon();
        attack('Powder', powderUser, fireUser);
        const hpBefore = fireUser.currentHp;
        const fireResult = attack('Ember', fireUser, powderUser);
        assert.equal(fireResult.success, false);
        assert.ok(fireUser.currentHp < hpBefore);

        const destinyUser = createPokemon({ currentHp: 1 });
        const attacker = createPokemon();
        attack('Destiny Bond', destinyUser, attacker);
        attack('Pound', attacker, destinyUser);
        assert.equal(destinyUser.currentHp, 0);
        assert.equal(attacker.currentHp, 0);
    });
});

test('brulure et poison infligent leurs degats de fin de tour', () => {
    const state = createBattleState();
    const burned = createPokemon({ status: 'burn' });
    const poisoned = createPokemon({ status: 'poison', uuid: 'poisoned' });
    processEndOfRound(burned, poisoned, state.sides.player, state.sides.enemy, state);
    assert.equal(burned.currentHp, 188);
    assert.equal(poisoned.currentHp, 175);
});

test('les PP sont consommes, retires par Depit et epuises par Rancune', () => {
    withRandom(0.99, () => {
        const attacker = createPokemon({ abilities: ['Pound'] });
        const spiteUser = createPokemon({ abilities: ['Spite'] });
        normalizeMovePp(attacker);
        normalizeMovePp(spiteUser);

        attack('Pound', attacker, spiteUser);
        assert.equal(attacker.movePp[0], getMaxMovePp('Pound') - 1);
        attack('Spite', spiteUser, attacker);
        assert.equal(attacker.movePp[0], getMaxMovePp('Pound') - 5);

        const grudgeUser = createPokemon({ currentHp: 1, abilities: ['Grudge'] });
        attack('Grudge', grudgeUser, attacker);
        attack('Pound', attacker, grudgeUser);
        assert.equal(attacker.movePp[0], 0);
    });
});

test('Lutte remplace automatiquement une equipe de capacites sans PP', () => {
    const attacker = createPokemon({ abilities: ['Pound'], movePp: [0] });
    const defender = createPokemon();
    const result = withRandom(0.99, () => attack('Pound', attacker, defender));
    assert.equal(result.moveName, 'Struggle');
    assert.ok(result.damage > 0);
    assert.ok(attacker.currentHp < attacker.maxHp);
});

test('les objets tenus se declenchent, se bloquent, se recyclent et se transmettent', () => {
    withRandom(0.5, () => {
        const berryUser = createPokemon({ currentHp: 60, heldItem: 'oran_berry' });
        const attacker = createPokemon({ abilities: ['Pound'] });
        attack('Pound', attacker, berryUser);
        assert.equal(berryUser.heldItem, null);
        assert.equal(ensureBattleData(berryUser).consumedHeldItem, 'oran_berry');

        berryUser.abilities = ['Recycle'];
        berryUser.currentHp = berryUser.maxHp;
        attack('Recycle', berryUser, attacker);
        assert.equal(berryUser.heldItem, 'oran_berry');

        const embargoUser = createPokemon({ abilities: ['Embargo'] });
        attack('Embargo', embargoUser, berryUser);
        const heldBefore = berryUser.heldItem;
        berryUser.currentHp = 20;
        attack('Pound', attacker, berryUser);
        assert.equal(berryUser.heldItem, heldBefore);

        const trickUser = createPokemon({ heldItem: 'leftovers', abilities: ['Trick'] });
        const target = createPokemon({ heldItem: 'sitrus_berry' });
        attack('Trick', trickUser, target);
        assert.equal(trickUser.heldItem, 'sitrus_berry');
        assert.equal(target.heldItem, 'leftovers');
    });
});

test('les talents peuvent etre copies, echanges, neutralises et modifier les regles', () => {
    withRandom(0.5, () => {
        const actor = createPokemon({ passiveAbility: 'Simple', abilities: ['Swords Dance', 'Skill Swap', 'Role Play'] });
        const target = createPokemon({ passiveAbility: 'Insomnia', abilities: ['Pound'] });

        attack('Swords Dance', actor, target);
        assert.equal(ensureBattleData(actor).statStages.attack, 4);

        attack('Role Play', actor, target);
        assert.equal(actor.passiveAbility, 'Insomnia');

        attack('Skill Swap', actor, target);
        assert.equal(target.passiveAbility, 'Insomnia');

        const grassUser = createPokemon({ abilities: ['Sleep Powder', 'Gastro Acid'] });
        attack('Sleep Powder', grassUser, target);
        assert.equal(target.status, 'normal');
        attack('Gastro Acid', grassUser, target);
        attack('Sleep Powder', grassUser, target);
        assert.equal(target.status, 'sleep');
    });
});

test('Reflet Magik, Saisie, Possessif et Electrisation changent vraiment le tour', () => {
    withRandom(0.5, () => {
        const coatUser = createPokemon({ abilities: ['Magic Coat', 'Pound'] });
        const statusUser = createPokemon({ abilities: ['Toxic', 'Swords Dance', 'Pound', 'Electrify'] });
        attack('Magic Coat', coatUser, statusUser);
        attack('Toxic', statusUser, coatUser);
        assert.equal(statusUser.status, 'badly_poison');
        assert.equal(coatUser.status, 'normal');

        const snatchUser = createPokemon({ abilities: ['Snatch'] });
        attack('Snatch', snatchUser, statusUser);
        attack('Swords Dance', statusUser, snatchUser);
        assert.equal(ensureBattleData(snatchUser).statStages.attack, 2);
        assert.equal(ensureBattleData(statusUser).statStages.attack, 0);

        const imprisonUser = createPokemon({ abilities: ['Imprison', 'Pound'] });
        attack('Imprison', imprisonUser, statusUser);
        const blocked = attack('Pound', statusUser, imprisonUser);
        assert.equal(blocked.blocked, true);

        const electricTarget = createPokemon({ type1: 'Ground', abilities: ['Ember'] });
        attack('Electrify', statusUser, electricTarget);
        const electrified = attack('Ember', electricTarget, statusUser);
        assert.equal(electrified.move.type, 'Electric');
    });
});

test('les effets de doubles et de recompense exposent un etat exploitable par un orchestrateur', () => {
    const state = createBattleState();
    const actor = createPokemon({ abilities: ['Follow Me', 'After You', 'Ally Switch', 'Happy Hour'] });
    const ally = createPokemon({ uuid: 'ally' });
    const target = createPokemon({ uuid: 'target' });

    attack('Follow Me', actor, target, state);
    assert.equal(state.sides.player.redirectionPokemonId, actor.uuid);
    assert.equal(
        resolveRedirectedTarget(ally, state.sides.player, [actor, ally], { combat: { target: 'single' } }),
        actor
    );
    attack('After You', actor, target, state, { targetAlly: ally, activeAllies: [actor, ally] });
    assert.equal(state.sides.player.afterYouPokemonId, ally.uuid);
    const activeAllies = [actor, ally];
    assert.equal(attack('Ally Switch', actor, target, state, { activeAllies }).allySwitch, true);
    assert.deepEqual(activeAllies, [ally, actor]);
    attack('Happy Hour', actor, target, state);
    assert.equal(state.sides.player.rewardMultiplier, 2);
    const controlUser = createPokemon({ abilities: ['Quash', 'Celebration'] });
    attack('Quash', controlUser, target, state);
    assert.equal(ensureBattleData(target).quashed, true);
    attack('Celebration', controlUser, target, state);
    assert.equal(ensureBattleData(controlUser).celebrated, true);
});

test("l'ordre commun respecte Quash, Apres Vous, les priorites et Distorsion", () => {
    const state = createBattleState();
    const fast = createPokemon({ uuid: 'fast', currentSpeed: 200 });
    const slow = createPokemon({ uuid: 'slow', currentSpeed: 20 });
    const actions = [
        { pokemon: fast, moveName: 'Pound', side: state.sides.player },
        { pokemon: slow, moveName: 'Pound', side: state.sides.enemy }
    ];

    assert.equal(orderBattleActions(actions, state, () => 0)[0].pokemon, fast);
    ensureBattleData(fast).quashed = true;
    assert.equal(orderBattleActions(actions, state, () => 0)[0].pokemon, slow);
    ensureBattleData(fast).quashed = false;
    state.field.trickRoomTurns = 2;
    assert.equal(orderBattleActions(actions, state, () => 0)[0].pokemon, slow);
    state.field.trickRoomTurns = 0;
    state.sides.enemy.afterYouPokemonId = slow.uuid;
    assert.equal(orderBattleActions(actions, state, () => 0)[0].pokemon, slow);
});

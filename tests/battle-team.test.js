const test = require('node:test');
const assert = require('node:assert/strict');
const {
    autoSwitchPokemon,
    hasAlivePokemon,
    resolveTeamOutcome,
    resolveMoveSwitches,
    switchPokemonByIndex,
    swapActiveAllies
} = require('../server/game/battle/battleTeam');

test('victoire, defaite et match nul utilisent la meme regle dans tous les combats', () => {
    assert.equal(resolveTeamOutcome([{ currentHp: 1 }], [{ currentHp: 0 }]), 'victory');
    assert.equal(resolveTeamOutcome([{ currentHp: 0 }], [{ currentHp: 1 }]), 'defeat');
    assert.equal(resolveTeamOutcome([{ currentHp: 0 }], [{ currentHp: 0 }]), 'draw');
    assert.equal(resolveTeamOutcome([{ currentHp: 1 }], [{ currentHp: 1 }]), 'ongoing');
});

test('un changement refuse un Pokemon KO et place un Pokemon valide en tete', () => {
    const team = [{ name: 'KO', currentHp: 0 }, { name: 'Valide', currentHp: 20 }];
    assert.equal(switchPokemonByIndex(team, 0), false);
    assert.equal(autoSwitchPokemon(team), true);
    assert.equal(team[0].name, 'Valide');
    assert.equal(hasAlivePokemon(team), true);
});

test('les changements forces et Relais remplacent vraiment le Pokemon actif', () => {
    const outgoing = { uuid: 'out', currentHp: 20, __battle: { statStages: { attack: 2 }, substituteHp: 10 } };
    const incoming = { uuid: 'in', currentHp: 30 };
    const enemy = { uuid: 'enemy', currentHp: 30 };
    const enemyReplacement = { uuid: 'enemy-2', currentHp: 30 };
    const attackerTeam = [outgoing, incoming];
    const defenderTeam = [enemy, enemyReplacement];

    const switched = resolveMoveSwitches(
        { switchSelf: true, batonPass: true, forceSwitch: true },
        attackerTeam,
        defenderTeam
    );

    assert.equal(switched.attacker.incoming, incoming);
    assert.equal(switched.defender.incoming, enemyReplacement);
    assert.equal(attackerTeam[0], incoming);
    assert.equal(defenderTeam[0], enemyReplacement);
    assert.equal(incoming.__battle.statStages.attack, 2);
    assert.equal(incoming.__battle.substituteHp, 10);
    assert.equal(outgoing.__battle, undefined);
});

test('Interversion permute deux allies actifs sans toucher au banc', () => {
    const left = { uuid: 'left', currentHp: 20 };
    const right = { uuid: 'right', currentHp: 20 };
    const active = [left, right];
    assert.equal(swapActiveAllies(active, left), true);
    assert.deepEqual(active, [right, left]);
});

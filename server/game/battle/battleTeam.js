const { applySwitchOutAbility } = require('../abilities/abilityEngine');

function getPokemonList(teamOrPokemons) {
    if (Array.isArray(teamOrPokemons)) return teamOrPokemons;
    if (Array.isArray(teamOrPokemons?.pokemons)) return teamOrPokemons.pokemons;
    return [];
}

function hasAlivePokemon(teamOrPokemons) {
    return getPokemonList(teamOrPokemons)
        .some((pokemon) => Number(pokemon?.currentHp || 0) > 0);
}

function getFirstAliveIndex(teamOrPokemons) {
    return getPokemonList(teamOrPokemons)
        .findIndex((pokemon) => Number(pokemon?.currentHp || 0) > 0);
}

function clearSwitchOutState(pokemon) {
    if (!pokemon || typeof pokemon !== 'object') return;
    applySwitchOutAbility(pokemon);
    if (Object.prototype.hasOwnProperty.call(pokemon, '__passiveAbilityBeforeBattle')) {
        pokemon.passiveAbility = pokemon.__passiveAbilityBeforeBattle;
        delete pokemon.__passiveAbilityBeforeBattle;
    }
    if (Object.prototype.hasOwnProperty.call(pokemon, '__moveAndStatOverrides')) {
        Object.assign(pokemon, pokemon.__moveAndStatOverrides);
        delete pokemon.__moveAndStatOverrides;
        pokemon.resetCombatStats?.();
    }
    // Sleep is non-volatile: switching must not reset its remaining actions.
    const sleepTurns = pokemon.status === 'sleep' && Number.isFinite(pokemon.__battle?.sleepTurns)
        ? pokemon.__battle.sleepTurns : null;
    delete pokemon.__battle;
    if (sleepTurns !== null) pokemon.__battle = { sleepTurns };
}

function switchPokemonByIndex(teamOrPokemons, index) {
    const pokemons = getPokemonList(teamOrPokemons);
    if (!Number.isInteger(index) || index < 0 || index >= pokemons.length) return false;
    if (Number(pokemons[index]?.currentHp || 0) <= 0) return false;
    if (index !== 0) {
        clearSwitchOutState(pokemons[0]);
        [pokemons[0], pokemons[index]] = [pokemons[index], pokemons[0]];
    }
    return true;
}

function autoSwitchPokemon(teamOrPokemons) {
    return switchPokemonByIndex(teamOrPokemons, getFirstAliveIndex(teamOrPokemons));
}

function getReplacementIndex(teamOrPokemons, excludedPokemon = null) {
    return getPokemonList(teamOrPokemons).findIndex((pokemon, index) =>
        index > 0
        && pokemon !== excludedPokemon
        && Number(pokemon?.currentHp || 0) > 0
    );
}

function switchToNextAlive(teamOrPokemons, options = {}) {
    const pokemons = getPokemonList(teamOrPokemons);
    const outgoing = pokemons[0] || null;
    const index = options.index ?? getReplacementIndex(pokemons, outgoing);
    if (!Number.isInteger(index) || index <= 0 || !(pokemons[index]?.currentHp > 0)) return null;

    const batonState = options.batonPass && outgoing?.__battle
        ? {
            statStages: { ...(outgoing.__battle.statStages || {}) },
            substituteHp: Number(outgoing.__battle.substituteHp || 0),
            curseSource: outgoing.__battle.curseSource || null,
            aquaRing: Boolean(outgoing.__battle.aquaRing),
            ingrain: Boolean(outgoing.__battle.ingrain)
        }
        : null;

    switchPokemonByIndex(pokemons, index);
    const incoming = pokemons[0];

    if (batonState && incoming) {
        incoming.__battle = {
            ...(incoming.__battle || {}),
            ...batonState
        };
    }

    return { outgoing, incoming, index };
}

function resolveMoveSwitches(moveResult, attackerTeam, defenderTeam, { attackerIndex } = {}) {
    const resolution = { attacker: null, defender: null };
    if (moveResult?.forceSwitch && Number(getPokemonList(defenderTeam)[0]?.currentHp) > 0) {
        resolution.defender = switchToNextAlive(defenderTeam);
    }
    if (moveResult?.switchSelf && Number(getPokemonList(attackerTeam)[0]?.currentHp) > 0
        && (!moveResult.chooseSwitch || Number.isInteger(attackerIndex))) {
        resolution.attacker = switchToNextAlive(attackerTeam, {
            batonPass: Boolean(moveResult.batonPass), index: attackerIndex
        });
    }
    return resolution;
}

function swapActiveAllies(activePokemons, actor) {
    if (!Array.isArray(activePokemons) || activePokemons.length < 2) return false;
    const actorIndex = activePokemons.indexOf(actor);
    if (actorIndex < 0) return false;
    const allyIndex = activePokemons.findIndex((pokemon, index) =>
        index !== actorIndex && Number(pokemon?.currentHp || 0) > 0
    );
    if (allyIndex < 0) return false;
    [activePokemons[actorIndex], activePokemons[allyIndex]] = [activePokemons[allyIndex], activePokemons[actorIndex]];
    return true;
}

function resolveTeamOutcome(playerTeam, opponentTeam) {
    const playerAlive = hasAlivePokemon(playerTeam);
    const opponentAlive = hasAlivePokemon(opponentTeam);
    if (playerAlive && !opponentAlive) return 'victory';
    if (!playerAlive && opponentAlive) return 'defeat';
    if (!playerAlive && !opponentAlive) return 'draw';
    return 'ongoing';
}

module.exports = {
    autoSwitchPokemon,
    clearSwitchOutState,
    getFirstAliveIndex,
    getPokemonList,
    getReplacementIndex,
    hasAlivePokemon,
    resolveMoveSwitches,
    resolveTeamOutcome,
    switchPokemonByIndex,
    switchToNextAlive,
    swapActiveAllies
};

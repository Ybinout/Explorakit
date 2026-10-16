const HOME_RESPAWN_POINT = Object.freeze({
    map: 'maison',
    x: 272,
    y: 432
});

const POKEMON_CENTER_RESPAWN_POINT = Object.freeze({
    map: 'centre',
    x: 304,
    y: 432
});
const { restoreMovePp } = require('../battle/battleResources');

function hasConsciousPokemon(team) {
    return Array.isArray(team?.pokemons)
        && team.pokemons.some((pokemon) => Number(pokemon?.currentHp || 0) > 0);
}

function healTeam(team) {
    if (!Array.isArray(team?.pokemons)) return team;

    team.pokemons.forEach((pokemon) => {
        const maxHp = Math.max(1, Math.floor(Number(pokemon?.maxHp) || 1));
        pokemon.currentHp = maxHp;
        pokemon.status = 'normal';
        delete pokemon.riftFainted;
        restoreMovePp(pokemon);
        delete pokemon.__battle;
    });

    return team;
}

function normalizeRespawnPoint(point) {
    const map = typeof point?.map === 'string' ? point.map.trim() : '';
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!map || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { map, x: Math.round(x), y: Math.round(y) };
}

function resolveRespawnPoint(savedPoint) {
    return normalizeRespawnPoint(savedPoint) || { ...HOME_RESPAWN_POINT };
}

function getPokemonCenterRespawnPoint() {
    return { ...POKEMON_CENTER_RESPAWN_POINT };
}

module.exports = {
    HOME_RESPAWN_POINT,
    POKEMON_CENTER_RESPAWN_POINT,
    getPokemonCenterRespawnPoint,
    hasConsciousPokemon,
    healTeam,
    normalizeRespawnPoint,
    resolveRespawnPoint
};

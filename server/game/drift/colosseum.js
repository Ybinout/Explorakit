const factory = require('./pokemonFactory');
const { pokemonSnapshot } = require('./runReport');
const ai = require('./colosseumAI');

const EXPLORATION_MS = 60 * 60 * 1000;
function durationMinutes(value = 60) {
    if (![30, 60].includes(value)) {
        const { LobbyError } = require('./lobbyStore');
        const error = new LobbyError('invalid_rules', 'Choisis un format Colosseum de 30 minutes ou 1 heure.');
        error.statusCode = 400; throw error;
    }
    return value;
}
// Fixed opposition, independent of the player's team: scores are comparable.
const ROSTERS = [
    [19, 16, 10, 13, 43, 60],
    [20, 17, 70, 75, 64, 58],
    [26, 31, 80, 93, 67, 123],
    [6, 9, 3, 65, 94, 68],
    [149, 248, 376, 445, 448, 373]
];
const TITLES = ['Aspirant', 'Challenger', 'Vétéran', 'Maître', 'Champion'];
// Distinct types and generations, with modest base stats before evolved teams.
// The same wave is identical for everyone; reconnecting never rerolls an opponent.
const OPENING_TEAMS = [
    [163, 263],
    [179, 270],
    [66, 285],
    [58, 54],
    [33, 180, 70],
    [17, 61, 404]
];

function waveInfo(wave) {
    const level = Math.min(100, 10 + (wave - 1) * 3);
    const size = Math.min(6, 2 + Math.floor((wave - 1) / 4));
    const tier = Math.min(4, Math.floor((wave - 1) / 6));
    // Past level 100, increase the existing Pokémon potential by one each wave.
    const potential = 2 + Math.max(0, wave - 31);
    return { wave, level, size, potential, difficulty: ai.difficulty(wave), title: `${TITLES[tier]} du Colosseum · ${wave}`,
        points: 100 * wave + 10 * level * size };
}

function opponent(wave) {
    const info = waveInfo(wave), pool = ROSTERS[Math.min(4, Math.floor((wave - 1) / 6))];
    const pokemons = Array.from({ length: info.size }, (_, index) => {
        const id = OPENING_TEAMS[wave - 1]?.[index] ?? pool[(index + wave - 1) % pool.length];
        const pokemon = factory.create(id, info.level, true);
        pokemon.k = info.potential;
        pokemon.recalculateStats();
        pokemon.currentHp = pokemon.maxHp;
        ai.preparePokemon(pokemon, wave, index);
        return pokemon;
    });
    return { npc: true, colosseumWave: wave, username: info.title, equipe: { pokemons }, drifts: [], equipped: [], chain: 0 };
}

const snapshotTeam = pokemons => pokemons.map(p => pokemonSnapshot(p));
function initialState() { return { score: 0, wins: 0, wave: 0, lastTeam: [], next: waveInfo(1) }; }

module.exports = { EXPLORATION_MS, durationMinutes, waveInfo, opponent, snapshotTeam, initialState };

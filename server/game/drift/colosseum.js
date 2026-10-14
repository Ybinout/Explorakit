const factory = require('./pokemonFactory');
const { pokemonSnapshot } = require('./runReport');

const EXPLORATION_MS = 60 * 60 * 1000;
// Fixed opposition, independent of the player's team: scores are comparable.
const ROSTERS = [
    [19, 16, 10, 13, 43, 60],
    [20, 17, 70, 75, 64, 58],
    [26, 31, 80, 93, 67, 123],
    [6, 9, 3, 65, 94, 68],
    [149, 248, 376, 445, 448, 373]
];
const TITLES = ['Aspirant', 'Challenger', 'Vétéran', 'Maître', 'Champion'];

function waveInfo(wave) {
    const level = Math.min(100, 10 + (wave - 1) * 3);
    const size = Math.min(6, 2 + Math.floor((wave - 1) / 4));
    const tier = Math.min(4, Math.floor((wave - 1) / 6));
    // Past level 100, increase the existing Pokémon potential by one each wave.
    const potential = 2 + Math.max(0, wave - 31);
    return { wave, level, size, potential, title: `${TITLES[tier]} du Colosseum · ${wave}`,
        points: 100 * wave + 10 * level * size };
}

function opponent(wave) {
    const info = waveInfo(wave), pool = ROSTERS[Math.min(4, Math.floor((wave - 1) / 6))];
    const pokemons = Array.from({ length: info.size }, (_, index) => {
        const pokemon = factory.create(pool[(index + wave - 1) % pool.length], info.level, true);
        pokemon.k = info.potential;
        pokemon.recalculateStats();
        pokemon.currentHp = pokemon.maxHp;
        return pokemon;
    });
    return { npc: true, username: info.title, equipe: { pokemons }, drifts: [], equipped: [], chain: 0 };
}

const snapshotTeam = pokemons => pokemons.map(p => pokemonSnapshot(p));
function initialState() { return { score: 0, wins: 0, wave: 0, lastTeam: [], next: waveInfo(1) }; }

module.exports = { EXPLORATION_MS, waveInfo, opponent, snapshotTeam, initialState };

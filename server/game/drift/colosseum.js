const factory = require('./pokemonFactory');
const { pokemonSnapshot } = require('./runReport');
const ai = require('./colosseumAI');
const { randomUUID } = require('node:crypto');
const dex = new Map(require('../../../data/game/pokedex.json').map(p => [p.id, p]));
const catalogue = require('../../../data/game/drifts.json');

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
const ELITE_ROSTER = [149, 248, 376, 445, 448, 373, 121, 212, 230, 282, 407, 473, 130, 306, 350, 461, 466, 467];
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

// Fixed, visible specialties rather than a team selected to counter the player.
const GUARDIANS = [
    { name: 'Le Rempart', specialty: 'Roche · Sol · Acier', hint: 'Les défenses sont solides. Prépare des attaques spéciales Eau ou Plante et surveille les doubles types.', team: [185, 75, 208, 112, 95, 76] },
    { name: 'La Canopée', specialty: 'Plante · Poison', hint: 'Une équipe qui résiste à la Plante. Le Feu et le Psy peuvent ouvrir une brèche, mais attention à Nostenfer.', team: [45, 49, 71, 89, 169, 407] },
    { name: 'Le Courant', specialty: 'Eau · Électrik', hint: 'Des profils rapides et des doubles types. Une seule attaque Sol ne suffira pas contre toute cette équipe.', team: [26, 171, 181, 121, 466, 479] },
    { name: 'La Fournaise', specialty: 'Feu · Vol', hint: 'La Roche menace plusieurs adversaires. Garde aussi une réponse aux Pokémon rapides et aux attaques spéciales.', team: [6, 59, 229, 169, 398, 467] },
    { name: 'Le Mirage', specialty: 'Psy · Spectre', hint: 'Prévois des attaques Ténèbres ou Spectre et plusieurs réponses : certains adversaires peuvent se soigner.', team: [196, 94, 65, 429, 477, 282] },
    { name: 'La Couronne', specialty: 'Dragon · Acier', hint: 'Une équipe d’élite avec des résistances complémentaires. Alterne tes réponses Glace, Combat et Sol.', team: [230, 212, 330, 376, 448, 445] }
];
const REWARD_SETS = [['DRF-002', 'DRF-013', 'DRF-040'], ['DRF-004', 'DRF-022', 'DRF-033'], ['DRF-010', 'DRF-018', 'DRF-035']];
function milestoneSize(version = 5) { return version >= 3 ? 5 : 10; }
function guardianAt(wave, version) { return GUARDIANS[(Math.ceil(wave / milestoneSize(version)) - 1) % GUARDIANS.length]; }
function roster(wave, version = 5) {
    if (version >= 5) return require('./colosseumVariety').encounter(wave).slots.map(s=>s.id);
    const size = Math.min(6, 2 + Math.floor((wave - 1) / 4));
    if (version >= 2 && wave % milestoneSize(version) === 0) return guardianAt(wave, version).team.slice(0, size);
    const elite = version >= 2 && wave >= 25;
    const pool = elite ? ELITE_ROSTER : ROSTERS[Math.min(4, Math.floor((wave - 1) / 6))];
    const offset = (wave - 1) * (elite ? 5 : 1);
    return Array.from({ length: size }, (_, i) => OPENING_TEAMS[wave - 1]?.[i] ?? pool[(i + offset) % pool.length]);
}

function guardianDrifts(wave, version) {
    if (version < 4 || wave % milestoneSize(version) !== 0) return [];
    // Fixed loadouts, not counters picked after seeing the player's team.
    const thematic = [20, 22, 40, 11, 42, 2][(wave / 5 - 1) % GUARDIANS.length];
    const ids = [13, ...(wave >= 10 ? [thematic] : []), ...(wave >= 20 ? [31] : [])];
    const rarity = wave >= 15 ? 'rare' : 'common';
    return ids.map(number => {
        const definitionId = `DRF-${String(number).padStart(3, '0')}`;
        const definition = catalogue.definitions.find(d => d.id === definitionId);
        return { uuid: `guardian-${wave}-${definitionId}`, definitionId, rarity, element: null,
            name: definition.name, description: definition.description, rule: definition.rule,
            value: definition.values[rarity], unit: definition.unit };
    });
}

function waveInfo(wave, version = 5) {
    const baseLevel = Math.min(100, 10 + (wave - 1) * 3);
    const size = Math.min(6, 2 + Math.floor((wave - 1) / 4));
    const tier = Math.min(4, Math.floor((wave - 1) / 6));
    // Past level 100, increase the existing Pokémon potential by one each wave.
    const potential = 2 + Math.max(0, wave - 31);
    const interval = milestoneSize(version);
    const guardian = version >= 2 && wave % interval === 0 ? guardianAt(wave, version) : null;
    const level = Math.min(100, baseLevel + (version >= 4 && guardian ? Math.min(3, Math.ceil(wave / 10)) : 0));
    const encounter = version >= 5 ? require('./colosseumVariety').encounter(wave) : null;
    const preview = roster(wave, version).map((id, index) => ({ id, name: dex.get(id).name.french || dex.get(id).name.english, types: dex.get(id).type,
        ...(version >= 3 ? require('./colosseumSets').preview(id, wave, index, encounter?.slots[index]) : {}) }));
    return { wave, level, size, potential, milestoneSize: interval, difficulty: ai.difficulty(wave, version),
        guardian: guardian ? { name: guardian.name, specialty: guardian.specialty, hint: guardian.hint } : null,
        nextGuardian: version >= 2 ? { wave: Math.ceil(wave / interval) * interval, name: guardianAt(wave, version).name, specialty: guardianAt(wave, version).specialty } : null,
        ...(encounter ? {strategy:encounter.strategy} : {}),
        drifts: guardianDrifts(wave, version), preview, title: `${guardian ? guardian.name : TITLES[tier] + ' du Colosseum'} · ${wave}`,
        points: 100 * wave + 10 * baseLevel * size };
}

function opponent(wave, version = 5) {
    const info = waveInfo(wave, version);
    const pokemons = roster(wave, version).map((id, index) => {
        const pokemon = factory.create(id, info.level, true);
        pokemon.k = info.potential;
        pokemon.recalculateStats();
        pokemon.currentHp = pokemon.maxHp;
        ai.preparePokemon(pokemon, wave, index, version);
        return pokemon;
    });
    return { npc: true, colosseumWave: wave, colosseumVersion: version, username: info.title, equipe: { pokemons }, drifts: info.drifts, equipped: info.drifts.map(d=>d.uuid), chain: 0 };
}

function rewardOffer(wave, version = 5) {
    const interval = milestoneSize(version);
    const rarity = wave >= interval * 3 ? 'legendary' : 'epic';
    return { id: randomUUID(), wave, options: REWARD_SETS[(wave / interval - 1) % REWARD_SETS.length].map(id => {
        const d = catalogue.definitions.find(d => d.id === id);
        return { definitionId: id, rarity, name: d.name, description: d.description, value: d.values[rarity], unit: d.unit };
    }) };
}

function chooseReward(p, data) {
    const { fail, requireMutable } = require('./economy');
    requireMutable(p);
    const state = p.run.colosseum;
    if (p.run.mode !== 'colosseum' || p.run.phase !== 'colosseum_ready' || !state?.reward || data?.offerId !== state.reward.id)
        fail('Cette récompense n’est plus disponible.');
    const option = state.reward.options.find(o => o.definitionId === data?.definitionId);
    if (!option) fail('Choisis l’un des trois Drifts proposés.');
    const drift = { uuid: randomUUID(), definitionId: option.definitionId, rarity: option.rarity, element: null };
    require('./fusion').acquire(p, drift, 'colosseum');
    state.lastReward = { wave: state.reward.wave, name: option.name, rarity: option.rarity };
    state.reward = null;
    // The five-slot limit and duplicate-definition rule still apply: no auto-equip.
    return { success: true };
}

const snapshotTeam = pokemons => pokemons.map(p => pokemonSnapshot(p));
// Keep the entrants' identities/order, but use each companion's latest permanent
// form and maximum attained level, including those lost before the final battle.
function recordTeam(report) {
    const player = report?.players?.[0];
    const entry = player?.tournamentTeam;
    const latest = new Map((player?.pokemon || []).map(p => [p.uuid, p]));
    const roster = entry?.length ? entry : report?.colosseum?.lastTeam || player?.team || [];
    return roster.slice(0, 6).map(p => {
        const final = p.uuid ? latest.get(p.uuid) : null;
        return final && final.level >= p.level ? final : p;
    });
}
function recordDefeat(report) {
    const player = report?.players?.[0], battle = player?.lastBattle;
    if (!battle || player?.reason !== 'defeated' || !['defeat','draw'].includes(battle.outcome)) return null;
    return { name: battle.name, type: battle.type, wave: battle.wave || null, turns: battle.turns || 0,
        outcome: battle.outcome, team: (battle.team || []).slice(0,6).map(p => ({
            pokemonId:p.pokemonId, name:p.name, level:p.level, knockedOut:p.currentHp <= 0,
            heldItem:p.heldItem, passiveAbility:p.passiveAbility, moves:(p.moves || []).slice(0,4),
            moveNames:(p.moveNames || p.moves || []).slice(0,4)
        })) };
}
function initialState() { return { version: 5, score: 0, wins: 0, wave: 0, lastTeam: [], reward: null, lastReward: null, next: waveInfo(1) }; }

module.exports = { EXPLORATION_MS, durationMinutes, milestoneSize, waveInfo, opponent, snapshotTeam, recordTeam, recordDefeat, initialState, rewardOffer, chooseReward };

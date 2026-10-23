const { v4: uuidv4 } = require('uuid');
const Team = require('../game/models/Team');
const Pokemon = require('../game/models/Pokemon');
const { dbPool, withTransaction } = require('../config/database');
const { normalizeMovePp } = require('../game/battle/battleResources');
const { createDeterministicRandom, normalizeSpeciesAbility } = require('../game/abilities/abilityDex');

const PERSISTED_STATUSES = new Set(['normal', 'burn', 'poison', 'badly_poison', 'paralyze', 'sleep', 'freeze']);

function normalizePokemonStatus(status) {
    return typeof status === 'string' && PERSISTED_STATUSES.has(status) ? status : 'normal';
}

const POKEMON_COLUMNS = [
    'uuid', 'team_id', 'position', 'pokemon_id', 'name', 'level', 'experience',
    'iv_attack', 'iv_defense', 'iv_hp', 'iv_special_attack', 'iv_special_defense',
    'iv_speed', 'nature', 'k', 'current_hp', 'status', 'passive_ability', 'held_item', 'current_attack', 'current_defense',
    'current_special_attack', 'current_special_defense', 'current_speed',
    'ability1', 'ability2', 'ability3', 'ability4',
    'ev_hp', 'ev_attack', 'ev_defense', 'ev_special_attack', 'ev_special_defense', 'ev_speed',
    'move1_pp', 'move2_pp', 'move3_pp', 'move4_pp', 'pending_moves', 'experience_rate'
];

function pokemonToRow(pokemon, teamId, position) {
    if (!pokemon?.data?.id || !pokemon?.iv) {
        throw new Error(`Pokémon invalide à la position ${position}`);
    }
    const abilities = Array.isArray(pokemon.abilities) ? pokemon.abilities.slice(0, 4) : [];
    while (abilities.length < 4) abilities.push(null);
    normalizeMovePp(pokemon);
    const movePp = pokemon.movePp.slice(0, 4);
    while (movePp.length < 4) movePp.push(null);
    return [
        pokemon.uuid || uuidv4(), teamId, position, pokemon.data.id, pokemon.name,
        pokemon.level, pokemon.experience, pokemon.iv.attack, pokemon.iv.defense,
        pokemon.iv.hp, pokemon.iv.specialAttack, pokemon.iv.specialDefense,
        pokemon.iv.speed, pokemon.nature, pokemon.k, pokemon.currentHp, normalizePokemonStatus(pokemon.status),
        pokemon.passiveAbility || null, pokemon.heldItem || null,
        pokemon.currentAttack, pokemon.currentDefense, pokemon.currentSpecialAttack,
        pokemon.currentSpecialDefense, pokemon.currentSpeed, ...abilities, pokemon.ev.hp, pokemon.ev.attack, pokemon.ev.defense, pokemon.ev.specialAttack, pokemon.ev.specialDefense, pokemon.ev.speed, ...movePp, JSON.stringify(pokemon.pendingMoves || []), pokemon.experienceRate
    ];
}

function rowToPokemon(row) {
    const pokemon = new Pokemon(
        row.pokemon_id, row.name, row.level, row.experience,
        {
            attack: row.iv_attack, defense: row.iv_defense, hp: row.iv_hp,
            specialAttack: row.iv_special_attack,
            specialDefense: row.iv_special_defense, speed: row.iv_speed
        },
        row.nature, row.k, { hp: row.ev_hp, attack: row.ev_attack, defense: row.ev_defense, specialAttack: row.ev_special_attack, specialDefense: row.ev_special_defense, speed: row.ev_speed }, row.experience_rate
    );
    pokemon.uuid = row.uuid;
    pokemon.currentHp = row.current_hp;
    pokemon.status = normalizePokemonStatus(row.status);
    pokemon.passiveAbility = normalizeSpeciesAbility(
        row.pokemon_id,
        row.passive_ability,
        createDeterministicRandom(row.uuid)
    );
    pokemon.heldItem = row.held_item || null;
    // Reconstruct permanent stats from nature/IV/EV, never stale battle overrides.
    pokemon.resetCombatStats();
    pokemon.abilities = [row.ability1, row.ability2, row.ability3, row.ability4].filter(Boolean);
    pokemon.movePp = [row.move1_pp, row.move2_pp, row.move3_pp, row.move4_pp]
        .slice(0, pokemon.abilities.length);
    normalizeMovePp(pokemon);
    pokemon.pendingMoves = typeof row.pending_moves === 'string' ? JSON.parse(row.pending_moves) : row.pending_moves || [];
    return pokemon;
}

async function getTeamRecord(userId, executor = dbPool) {
    const [rows] = await executor.execute(
        'SELECT id, user_id, team_name FROM teams WHERE user_id = ? LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function getTeamPokemons(teamId, executor = dbPool) {
    const [rows] = await executor.execute(
        'SELECT * FROM pokemons WHERE team_id = ? ORDER BY position ASC',
        [teamId]
    );
    return rows;
}

async function loadEquipe(userId) {
    const teamRecord = await getTeamRecord(userId);
    if (!teamRecord) return null;
    const rows = await getTeamPokemons(teamRecord.id);
    const team = new Team();
    for (const row of rows) team.ajouterPokemon(rowToPokemon(row));
    return team;
}

async function editEquipe(userId, team, executor = null) {
    if (!Array.isArray(team?.pokemons) || team.pokemons.length > 6) {
        throw new Error('Une équipe doit contenir entre 0 et 6 Pokémon.');
    }

    const save = async (connection) => {
        let teamRecord = await getTeamRecord(userId, connection);
        if (!teamRecord) {
            const [result] = await connection.execute(
                'INSERT INTO teams (user_id, team_name) VALUES (?, ?)',
                [userId, 'Équipe principale']
            );
            teamRecord = { id: result.insertId };
        }

        await connection.execute('DELETE FROM pokemons WHERE team_id = ?', [teamRecord.id]);
        const placeholders = POKEMON_COLUMNS.map(() => '?').join(', ');
        const insertSql = `INSERT INTO pokemons (${POKEMON_COLUMNS.join(', ')}) VALUES (${placeholders})`;
        for (const [index, pokemon] of require('../game/battle/partyOrder').orderedParty(team.pokemons).entries()) {
            const values = pokemonToRow(pokemon, teamRecord.id, index + 1);
            pokemon.uuid = values[0];
            await connection.execute(insertSql, values);
        }
        return teamRecord.id;
    };
    return executor ? save(executor) : withTransaction(save);
}

module.exports = {
    POKEMON_COLUMNS,
    editEquipe,
    getTeamPokemons,
    getTeamRecord,
    loadEquipe,
    normalizePokemonStatus,
    pokemonToRow,
    rowToPokemon
};

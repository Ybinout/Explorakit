const bcrypt = require('bcrypt');
const Pokemon = require('../game/models/Pokemon');
const { dbPool, withTransaction } = require('../config/database');
const { POKEMON_COLUMNS, pokemonToRow } = require('./teamRepository');
const { ensureInitialProgress, markPokemonCaught } = require('./progressionRepository');

const STARTER_ITEMS = [
    ['pokeball', 10],
    ['superball', 5],
    ['hyperball', 2],
    ['oran_berry', 2]
];

function normalizeCredentials(username, password) {
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (normalizedUsername.length < 3 || normalizedUsername.length > 50) {
        throw new Error("Le nom d'utilisateur doit contenir entre 3 et 50 caractères.");
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Le mot de passe doit contenir entre 8 et 128 caractères.');
    }
    return { username: normalizedUsername, password };
}

const STARTERS = Object.freeze({
    1: { name: 'Bulbizarre', passiveAbility: 'Overgrow', abilities: ['Tackle', 'Growl', 'Vine Whip', 'Growth'] },
    4: { name: 'Salamèche', passiveAbility: 'Blaze', abilities: ['Scratch', 'Growl', 'Ember', 'Smokescreen'] },
    7: { name: 'Carapuce', passiveAbility: 'Torrent', abilities: ['Tackle', 'Tail Whip', 'Water Gun', 'Withdraw'] }
});

function createStarterPokemon(starterId = 1) {
    const normalizedStarterId = Number.parseInt(starterId, 10);
    const definition = STARTERS[normalizedStarterId];
    if (!definition) throw new Error('Starter invalide.');
    const starter = new Pokemon(normalizedStarterId, definition.name, 5, 64, null, 'Bashful', 2);
    definition.abilities.forEach((moveName) => starter.addAbility(moveName));
    starter.passiveAbility = definition.passiveAbility;
    return starter;
}

async function createUserWithStarter(username, password, options = {}) {
    const credentials = normalizeCredentials(username, password);
    const sprite = options.sprite === 'sprite2.png' ? 'sprite2.png' : 'sprite.png';
    const starterId = Number.parseInt(options.starterId, 10) || 1;
    if (!STARTERS[starterId]) throw new Error('Starter invalide.');
    const passwordHash = await bcrypt.hash(credentials.password, 10);

    return withTransaction(async (connection) => {
        const [userResult] = await connection.execute(
            'INSERT INTO users (username, password_hash, x, y, map, sprite) VALUES (?, ?, ?, ?, ?, ?)',
            [credentials.username, passwordHash, 80, 208, 'start', sprite]
        );
        const userId = userResult.insertId;
        const [teamResult] = await connection.execute(
            'INSERT INTO teams (user_id, team_name) VALUES (?, ?)',
            [userId, 'Équipe principale']
        );

        const starter = createStarterPokemon(starterId);
        await connection.execute(
            `INSERT INTO pokemons (${POKEMON_COLUMNS.join(', ')}) VALUES (${POKEMON_COLUMNS.map(() => '?').join(', ')})`,
            pokemonToRow(starter, teamResult.insertId, 1)
        );

        for (const [itemKey, quantity] of STARTER_ITEMS) {
            await connection.execute(
                'INSERT INTO user_items (user_id, item_key, quantity) VALUES (?, ?, ?)',
                [userId, itemKey, quantity]
            );
        }
        await ensureInitialProgress(userId, connection);
        await markPokemonCaught(userId, starter, connection);
        return { id: userId, username: credentials.username, money: 0 };
    });
}

async function authenticateUser(username, password) {
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername || typeof password !== 'string') return null;

    const [rows] = await dbPool.execute(
        'SELECT id, username, password_hash, money FROM users WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );
    const user = rows[0];
    if (!user) return null;

    const hasBcryptHash = /^\$2[aby]\$/.test(user.password_hash);
    const passwordMatches = hasBcryptHash
        ? await bcrypt.compare(password, user.password_hash)
        : password === user.password_hash;
    if (!passwordMatches) return null;

    if (!hasBcryptHash) {
        const upgradedHash = await bcrypt.hash(password, 10);
        await dbPool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [upgradedHash, user.id]);
    }
    return { id: user.id, username: user.username, money: Number(user.money) || 0 };
}

async function awardUserMoney(userId, amount) {
    const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (!Number.isInteger(userId) || normalizedAmount <= 0) return 0;
    await dbPool.execute('UPDATE users SET money = money + ? WHERE id = ?', [normalizedAmount, userId]);
    return normalizedAmount;
}

module.exports = {
    awardUserMoney,
    authenticateUser,
    createStarterPokemon,
    createUserWithStarter,
    normalizeCredentials,
    STARTERS
};

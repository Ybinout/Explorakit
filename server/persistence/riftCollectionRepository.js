const { dbPool, withTransaction } = require('../config/database');
const catalog = require('../../data/game/cosmetics.json');
function invalid(message, statusCode = 400) {
    return Object.assign(new Error(message), { statusCode });
}
async function collection(id) {
    const [[owned], [appearance]] = await Promise.all([
        dbPool.execute('SELECT cosmetic_key FROM rift_cosmetics WHERE user_id=?', [id]),
        dbPool.execute('SELECT title_key,frame_key FROM rift_appearance WHERE user_id=?', [id]),
    ]);
    return {
        catalog,
        owned: owned.map((r) => r.cosmetic_key),
        appearance: appearance[0] || { title_key: null, frame_key: null },
    };
}
async function purchase(id, key) {
    const item = catalog.find((c) => c.key === key);
    if (!item) throw invalid('Cosmétique inconnu.');
    await withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
        await c.execute('INSERT IGNORE INTO rift_profiles(user_id) VALUES (?)', [id]);
        const [[profile]] = await c.execute('SELECT coins FROM rift_profiles WHERE user_id=? FOR UPDATE', [
            id,
        ]);
        const [owned] = await c.execute(
            'SELECT cosmetic_key FROM rift_cosmetics WHERE user_id=? AND cosmetic_key=?',
            [id, key]
        );
        if (owned.length) return;
        if (Number(profile.coins) < item.price) throw invalid('Pas assez de pièces.');
        await c.execute('UPDATE rift_profiles SET coins=coins-? WHERE user_id=?', [item.price, id]);
        await c.execute('INSERT INTO rift_cosmetics(user_id,cosmetic_key) VALUES (?,?)', [id, key]);
    });
    return collection(id);
}
async function equip(id, type, key) {
    if (!['title', 'frame'].includes(type)) throw invalid('Type invalide.');
    if (key !== null && !catalog.some((c) => c.key === key && c.type === type))
        throw invalid('Cosmétique invalide.');
    await withTransaction(async (c) => {
        if (key !== null) {
            const [rows] = await c.execute(
                'SELECT cosmetic_key FROM rift_cosmetics WHERE user_id=? AND cosmetic_key=?',
                [id, key]
            );
            if (!rows.length) throw invalid('Ce cosmétique ne t’appartient pas.', 403);
        }
        await c.execute(
            `INSERT INTO rift_appearance(user_id,${type}_key) VALUES (?,?) ON DUPLICATE KEY UPDATE ${type}_key=VALUES(${type}_key)`,
            [id, key]
        );
    });
    return collection(id);
}
async function history(id) {
    const [rows] = await dbPool.execute(
        `SELECT r.report_json FROM rift_reports r JOIN rift_run_entries e ON e.run_id=r.run_id WHERE e.user_id=? ORDER BY r.created_at DESC,r.run_id DESC LIMIT 20`,
        [id]
    );
    return rows.map((r) => JSON.parse(r.report_json));
}
module.exports = { collection, purchase, equip, history };

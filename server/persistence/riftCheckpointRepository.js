const { dbPool } = require('../config/database');
async function load() {
    const [[row]] = await dbPool.execute('SELECT payload FROM rift_checkpoints WHERE id = 1');
    return row?.payload || null;
}
async function save(payload) {
    await dbPool.execute(
        'INSERT INTO rift_checkpoints (id,payload) VALUES (1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=CURRENT_TIMESTAMP',
        [payload]
    );
}
module.exports = { load, save };

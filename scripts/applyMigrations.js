const fs = require('fs');
const path = require('path');
const { getDatabaseConfig, mysql } = require('./databaseConnection');

const migrationFiles = [
    '001_transactional_storage.sql',
    '002_unbounded_experience.sql',
    '003_respawn_checkpoint.sql',
    '004_persistent_pokemon_status.sql',
    '005_battle_resources.sql',
    '006_battle_economy.sql',
    '007_player_progression.sql',
    '008_effort_values.sql',
    '009_pokemon_center_return.sql',
    '010_rift_accounts.sql',
    '011_rift_reward_duration.sql',
    '012_rift_durability_cosmetics.sql',
    '013_colosseum.sql',
    '014_colosseum_formats.sql',
    '015_ranks_friends.sql',
    '016_move_learning.sql',
    '017_evolution_experience.sql',
    '018_repel_steps.sql',
    '019_pokemon_storage.sql'
];

async function applyMigrations() {
    const connection = await mysql.createConnection({ ...getDatabaseConfig(), multipleStatements: true });
    let lockAcquired = false;
    try {
        const [[lockRow]] = await connection.query("SELECT GET_LOCK('explorakit_schema_migration', 10) AS acquired");
        lockAcquired = lockRow.acquired === 1;
        if (!lockAcquired) throw new Error('Impossible de verrouiller les migrations.');

        await connection.query(
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                name VARCHAR(191) NOT NULL PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        for (const filename of migrationFiles) {
            const [rows] = await connection.execute('SELECT name FROM schema_migrations WHERE name = ? LIMIT 1', [filename]);
            if (rows.length) {
                console.log(`Déjà appliquée : ${filename}`);
                continue;
            }
            const sql = fs.readFileSync(path.resolve(__dirname, '..', 'database', 'migrations', filename), 'utf8');
            console.log(`Application : ${filename}`);
            await connection.query(sql);
            await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [filename]);
        }
        console.log('Migrations terminées.');
    } finally {
        if (lockAcquired) await connection.query("SELECT RELEASE_LOCK('explorakit_schema_migration')");
        await connection.end();
    }
}

if (require.main === module) {
    applyMigrations().catch((error) => {
        console.error(`Migration interrompue : ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { applyMigrations };

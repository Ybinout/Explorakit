const { getDatabaseConfig, mysql } = require('./databaseConnection');

async function verifyMigration() {
    const connection = await mysql.createConnection(getDatabaseConfig());
    try {
        const [tables] = await connection.query(
            `SELECT TABLE_NAME, ENGINE
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN (
                 'users', 'teams', 'pokemons', 'user_items', 'player_story_flags',
                 'player_quests', 'player_badges', 'user_pokedex', 'user_npc_battles'
               )
             ORDER BY TABLE_NAME`
        );
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pokemons'
               AND COLUMN_NAME IN (
                 'level', 'experience', 'uuid', 'team_id', 'position', 'status',
                 'passive_ability', 'held_item', 'move1_pp', 'move2_pp', 'move3_pp', 'move4_pp'
               )
             ORDER BY COLUMN_NAME`
        );
        const [respawnColumns] = await connection.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
               AND COLUMN_NAME IN ('respawn_x', 'respawn_y', 'respawn_map', 'money')
             ORDER BY COLUMN_NAME`
        );
        const [constraints] = await connection.query(
            `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME
             FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND CONSTRAINT_NAME IN (
                 'uniq_team_user', 'uniq_team_position', 'fk_teams_user',
                 'fk_pokemons_team', 'fk_user_items_user'
               )
             ORDER BY CONSTRAINT_NAME`
        );
        const [migrations] = await connection.query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
        const experienceColumn = columns.find((column) => column.COLUMN_NAME === 'experience');
        const levelColumn = columns.find((column) => column.COLUMN_NAME === 'level');
        const valid = tables.length === 9
            && tables.every((table) => table.ENGINE === 'InnoDB')
            && constraints.length === 5
            && migrations.length >= 7
            && respawnColumns.length === 4
            && respawnColumns.some((column) => column.COLUMN_NAME === 'money')
            && columns.some((column) => column.COLUMN_NAME === 'status')
            && columns.some((column) => column.COLUMN_NAME === 'passive_ability')
            && columns.some((column) => column.COLUMN_NAME === 'held_item')
            && ['move1_pp', 'move2_pp', 'move3_pp', 'move4_pp']
                .every((columnName) => columns.some((column) => column.COLUMN_NAME === columnName))
            && /bigint(?:\(\d+\))? unsigned/i.test(experienceColumn?.COLUMN_TYPE || '')
            && /int(?:\(\d+\))? unsigned/i.test(levelColumn?.COLUMN_TYPE || '');
        console.log(JSON.stringify({ valid, tables, columns, respawnColumns, constraints, migrations }, null, 2));
        if (!valid) process.exitCode = 2;
        return valid;
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    verifyMigration().catch((error) => {
        console.error(JSON.stringify({ valid: false, code: error.code, message: error.message }));
        process.exitCode = 1;
    });
}

module.exports = { verifyMigration };

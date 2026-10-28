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
                 'player_quests', 'player_badges', 'user_pokedex', 'user_npc_battles',
                 'rift_profiles', 'rift_runs', 'rift_run_entries',
                 'rift_checkpoints', 'rift_reports', 'rift_cosmetics', 'rift_appearance', 'colosseum_runs', 'colosseum_bests', 'rift_ratings', 'rift_rating_results', 'trainer_friendships', 'pokemon_storage', 'user_item_discoveries', 'trainer_messages', 'trainer_message_reads'
               )
             ORDER BY TABLE_NAME`
        );
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pokemons'
               AND COLUMN_NAME IN (
                 'level', 'experience', 'uuid', 'team_id', 'position', 'status',
                 'ev_hp', 'ev_attack', 'ev_defense', 'ev_special_attack', 'ev_special_defense', 'ev_speed',
                 'passive_ability', 'held_item', 'move1_pp', 'move2_pp', 'move3_pp', 'move4_pp', 'pending_moves', 'experience_rate'
               )
             ORDER BY COLUMN_NAME`
        );
        const [respawnColumns] = await connection.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
               AND COLUMN_NAME IN ('respawn_x', 'respawn_y', 'respawn_map', 'money', 'center_return_x', 'center_return_y', 'center_return_map', 'repel_steps')
             ORDER BY COLUMN_NAME`
        );
        const [constraints] = await connection.query(
            `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME
             FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND CONSTRAINT_NAME IN (
                 'uniq_team_user', 'uniq_team_position', 'fk_teams_user',
                 'fk_pokemons_team', 'fk_user_items_user',
                 'fk_rift_profiles_user', 'fk_rift_entries_user', 'fk_rift_entries_run',
                 'fk_rating_user', 'fk_rating_result_run', 'fk_rating_result_user', 'fk_friends_low', 'fk_friends_high', 'fk_friends_requester', 'fk_storage_user', 'uniq_storage_slot', 'fk_item_discovery_user', 'fk_message_sender', 'fk_message_recipient', 'fk_message_read_user', 'fk_message_read_peer'
               )
             ORDER BY CONSTRAINT_NAME`
        );
        const [migrations] = await connection.query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
        const experienceColumn = columns.find((column) => column.COLUMN_NAME === 'experience');
        const levelColumn = columns.find((column) => column.COLUMN_NAME === 'level');
        const [riftColumns] = await connection.query(
            `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('rift_profiles', 'rift_runs', 'rift_run_entries',
                 'rift_checkpoints', 'rift_reports', 'rift_cosmetics', 'rift_appearance', 'colosseum_runs', 'colosseum_bests', 'rift_ratings', 'rift_rating_results', 'trainer_friendships')
             ORDER BY TABLE_NAME, ORDINAL_POSITION`
        );
        const [entryKey] = await connection.query(
            `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'rift_run_entries'
               AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`
        );
        const [colosseumKey] = await connection.query(
            `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='colosseum_bests'
               AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`
        );
        const valid = tables.length === 25
            && migrations.some(migration=>migration.name==='022_social_messages.sql')
            && tables.every((table) => table.ENGINE === 'InnoDB')
            && constraints.length === 21
            && migrations.some((migration) => migration.name === '010_rift_accounts.sql')
            && migrations.some((migration) => migration.name === '011_rift_reward_duration.sql')
            && migrations.some((migration) => migration.name === '012_rift_durability_cosmetics.sql')
            && migrations.some((migration) => migration.name === '013_colosseum.sql')
            && migrations.some(migration => migration.name === '014_colosseum_formats.sql')
            && migrations.some(migration => migration.name === '015_ranks_friends.sql')
            && migrations.some(migration => migration.name === '016_move_learning.sql')
            && columns.some(column => column.COLUMN_NAME === 'pending_moves')
            && migrations.some(migration => migration.name === '017_evolution_experience.sql')
            && columns.some(column => column.COLUMN_NAME === 'experience_rate')
            && ['rating','games'].every(name => riftColumns.some(c => c.TABLE_NAME === 'rift_ratings' && c.COLUMN_NAME === name && c.IS_NULLABLE === 'NO'))
            && colosseumKey.map(column => column.COLUMN_NAME).join(',') === 'user_id,duration_minutes'
            && ['colosseum_runs', 'colosseum_bests'].every(table => riftColumns.some(column => column.TABLE_NAME === table && column.COLUMN_NAME === 'duration_minutes' && column.IS_NULLABLE === 'NO'))
            && entryKey.map((column) => column.COLUMN_NAME).join(',') === 'run_id,user_id'
            && ['wins', 'losses', 'games_started', 'coins'].every((name) => riftColumns.some((column) =>
                column.TABLE_NAME === 'rift_profiles' && column.COLUMN_NAME === name
                && /bigint(?:\(\d+\))? unsigned/i.test(column.COLUMN_TYPE)))
            && [['reward_exploration_ms', /^int(?:\(\d+\))? unsigned$/i],
                ['reward_version', /^smallint(?:\(\d+\))? unsigned$/i]]
                .every(([name, type]) => riftColumns.some((column) =>
                    column.TABLE_NAME === 'rift_runs' && column.COLUMN_NAME === name
                    && type.test(column.COLUMN_TYPE) && column.IS_NULLABLE === 'YES'
                    && (column.COLUMN_DEFAULT === null || column.COLUMN_DEFAULT === 'NULL')))
            && migrations.some(migration => migration.name === '018_repel_steps.sql')
            && respawnColumns.some(column => column.COLUMN_NAME === 'repel_steps' && column.IS_NULLABLE === 'NO' && /smallint.*unsigned/i.test(column.COLUMN_TYPE))
            && migrations.some(migration => migration.name === '019_pokemon_storage.sql')
            && migrations.some(migration => migration.name === '020_unique_item_discoveries.sql')
            && respawnColumns.length === 8
            && respawnColumns.some((column) => column.COLUMN_NAME === 'money')
            && columns.some((column) => column.COLUMN_NAME === 'status')
            && columns.some((column) => column.COLUMN_NAME === 'passive_ability')
            && columns.some((column) => column.COLUMN_NAME === 'held_item')
            && ['ev_hp', 'ev_attack', 'ev_defense', 'ev_special_attack', 'ev_special_defense', 'ev_speed', 'move1_pp', 'move2_pp', 'move3_pp', 'move4_pp']
                .every((columnName) => columns.some((column) => column.COLUMN_NAME === columnName))
            && /bigint(?:\(\d+\))? unsigned/i.test(experienceColumn?.COLUMN_TYPE || '')
            && /int(?:\(\d+\))? unsigned/i.test(levelColumn?.COLUMN_TYPE || '');
        console.log(JSON.stringify({ valid, tables, columns, respawnColumns, riftColumns, constraints, migrations }, null, 2));
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

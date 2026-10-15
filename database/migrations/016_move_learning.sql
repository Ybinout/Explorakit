-- Old saves have no pending offer. Safe to resume if DDL succeeded before its migration receipt.
SET @has_move_learning = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pokemons' AND COLUMN_NAME='pending_moves');
SET @move_learning_ddl = IF(@has_move_learning=0, 'ALTER TABLE pokemons ADD COLUMN pending_moves JSON DEFAULT NULL', 'SELECT 1');
PREPARE move_learning_migration FROM @move_learning_ddl;
EXECUTE move_learning_migration;
DEALLOCATE PREPARE move_learning_migration;

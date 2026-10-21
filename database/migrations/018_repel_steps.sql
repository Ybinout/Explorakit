-- Additive, rerunnable: Adventure protection travels with its saved position.
SET @has_repel_steps = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='repel_steps');
SET @repel_steps_ddl = IF(@has_repel_steps=0, 'ALTER TABLE users ADD COLUMN repel_steps SMALLINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE repel_steps_migration FROM @repel_steps_ddl;
EXECUTE repel_steps_migration;
DEALLOCATE PREPARE repel_steps_migration;

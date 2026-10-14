-- Original records and attempts default to the one-hour format. Never rewrite their score.
SET @has_format = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='colosseum_runs' AND COLUMN_NAME='duration_minutes');
SET @ddl = IF(@has_format=0, 'ALTER TABLE colosseum_runs ADD COLUMN duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60', 'SELECT 1');
PREPARE format_migration FROM @ddl; EXECUTE format_migration; DEALLOCATE PREPARE format_migration;
SET @has_format = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='colosseum_bests' AND COLUMN_NAME='duration_minutes');
SET @ddl = IF(@has_format=0, 'ALTER TABLE colosseum_bests ADD COLUMN duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60, DROP PRIMARY KEY, ADD PRIMARY KEY (user_id,duration_minutes)', 'SELECT 1');
PREPARE format_migration FROM @ddl; EXECUTE format_migration; DEALLOCATE PREPARE format_migration;

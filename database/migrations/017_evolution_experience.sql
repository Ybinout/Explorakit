-- Preserve each companion's XP curve through evolution. NULL keeps legacy species defaults.
SET @has_experience_rate = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pokemons' AND COLUMN_NAME='experience_rate');
SET @experience_rate_ddl = IF(@has_experience_rate=0, 'ALTER TABLE pokemons ADD COLUMN experience_rate DECIMAL(10,6) DEFAULT NULL', 'SELECT 1');
PREPARE experience_rate_migration FROM @experience_rate_ddl;
EXECUTE experience_rate_migration;
DEALLOCATE PREPARE experience_rate_migration;

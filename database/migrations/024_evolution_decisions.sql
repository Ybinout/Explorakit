-- Durable pending/cancelled evolution offers; existing companions retain their state.
SET @has_evolution_state=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pokemons' AND COLUMN_NAME='evolution_state');
SET @evolution_state_ddl=IF(@has_evolution_state=0,'ALTER TABLE pokemons ADD COLUMN evolution_state JSON DEFAULT NULL','SELECT 1');
PREPARE evolution_state_migration FROM @evolution_state_ddl;
EXECUTE evolution_state_migration;
DEALLOCATE PREPARE evolution_state_migration;

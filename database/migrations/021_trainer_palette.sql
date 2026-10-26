-- Only the default trainer uses this cosmetic palette; no sprite or gameplay data changes.
SET @has_sprite_palette = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='sprite_palette');
SET @sprite_palette_ddl = IF(@has_sprite_palette=0, 'ALTER TABLE users ADD COLUMN sprite_palette VARCHAR(24) NULL DEFAULT NULL', 'SELECT 1');
PREPARE sprite_palette_migration FROM @sprite_palette_ddl;
EXECUTE sprite_palette_migration;
DEALLOCATE PREPARE sprite_palette_migration;

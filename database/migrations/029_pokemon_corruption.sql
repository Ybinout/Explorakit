-- Additive permanent module state; existing Pokémon remain uncorrupted.
SET @has_corruption=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pokemons' AND COLUMN_NAME='corruption');
SET @corruption_ddl=IF(@has_corruption=0,'ALTER TABLE pokemons ADD COLUMN corruption JSON DEFAULT NULL','SELECT 1');
PREPARE corruption_migration FROM @corruption_ddl;
EXECUTE corruption_migration;
DEALLOCATE PREPARE corruption_migration;
CREATE TABLE IF NOT EXISTS corruption_receipts (
 id CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 operation VARCHAR(10) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_corruption_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX idx_corruption_receipt_owner (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

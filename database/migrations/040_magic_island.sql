-- Safe to resume after a partially completed DDL run; existing forms are preserved.
SET @magic_form_sql = (SELECT IF(COUNT(*) = 0,
 'ALTER TABLE pokemons ADD COLUMN form_data LONGTEXT NULL', 'SELECT 1')
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pokemons' AND COLUMN_NAME='form_data');
PREPARE magic_form_stmt FROM @magic_form_sql;
EXECUTE magic_form_stmt;
DEALLOCATE PREPARE magic_form_stmt;

CREATE TABLE IF NOT EXISTS magic_island_receipts (
 request_id CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 request_hash CHAR(64) NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_magic_receipt_user (user_id,created_at),
 CONSTRAINT fk_magic_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS magic_island_expeditions (
 user_id INT NOT NULL PRIMARY KEY,
 mission_day DATE NOT NULL,
 mission_key VARCHAR(40) NOT NULL,
 started_at BIGINT UNSIGNED NOT NULL,
 ready_at BIGINT UNSIGNED NOT NULL,
 pokemon_data LONGTEXT NOT NULL,
 rewards_json LONGTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_magic_expedition_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

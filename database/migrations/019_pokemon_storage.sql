-- Dedicated storage: active party schema and existing companions stay unchanged.
CREATE TABLE IF NOT EXISTS pokemon_storage (
 uuid CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 box_index TINYINT UNSIGNED NOT NULL,
 slot_index TINYINT UNSIGNED NOT NULL,
 pokemon_data JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uniq_storage_slot(user_id,box_index,slot_index),
 CONSTRAINT fk_storage_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

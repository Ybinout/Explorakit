-- Sparse private labels: adding capacity never moves or rewrites stored Pokémon.
CREATE TABLE IF NOT EXISTS pokemon_storage_boxes (
 user_id INT NOT NULL,
 box_index TINYINT UNSIGNED NOT NULL,
 name VARCHAR(24) NOT NULL,
 PRIMARY KEY(user_id,box_index),
 CONSTRAINT fk_storage_box_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

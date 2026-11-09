-- Per-placement independent growth, evaluated from timestamps; no background plant timers.
CREATE TABLE IF NOT EXISTS housing_berry_crops (
 user_id INT NOT NULL,
 furniture_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 slot_index TINYINT UNSIGNED NOT NULL,
 berry_key VARCHAR(100) NOT NULL,
 planted_at BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(user_id,furniture_id,slot_index),
 CONSTRAINT berry_crop_owner FOREIGN KEY(user_id) REFERENCES housing_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS berry_recipe_discoveries (
 user_id INT NOT NULL,
 recipe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ingredients_json JSON NOT NULL,
 family_key VARCHAR(60) NOT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 1,
 first_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(user_id,recipe_key),
 CONSTRAINT berry_recipe_owner FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS berry_consumption_receipts (
 battle_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 pokemon_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id INT NOT NULL,
 item_key VARCHAR(100) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(battle_id,pokemon_uuid,item_key),
 KEY berry_consumption_owner(user_id,created_at),
 CONSTRAINT berry_consumption_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

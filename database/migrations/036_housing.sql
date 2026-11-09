-- Shared templates/assets; only compact per-owner furniture coordinates are stored.
CREATE TABLE IF NOT EXISTS housing_profiles (
 user_id INT NOT NULL PRIMARY KEY,
 entry_key VARCHAR(80) NULL,
 floors_json JSON NOT NULL,
 inventory_json JSON NOT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT housing_profile_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS housing_visits (
 user_id INT NOT NULL PRIMARY KEY,
 owner_id INT NOT NULL,
 floor_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
 inside_house TINYINT UNSIGNED NOT NULL DEFAULT 1,
 return_map VARCHAR(100) NOT NULL,
 return_x INT NOT NULL,
 return_y INT NOT NULL,
 CONSTRAINT housing_visit_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT housing_visit_owner FOREIGN KEY(owner_id) REFERENCES housing_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS housing_receipts (
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY housing_receipt_owner(user_id,created_at),
 CONSTRAINT housing_receipt_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One bounded durable session per player; RNG/payout survives disconnect/restart.
CREATE TABLE IF NOT EXISTS casino_slot_sessions (
 user_id INT NOT NULL PRIMARY KEY,
 next_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 snapshot JSON NULL,
 settle_at BIGINT UNSIGNED NULL,
 version INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY casino_slot_pending(settle_at),
 CONSTRAINT casino_slot_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

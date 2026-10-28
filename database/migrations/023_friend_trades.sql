-- Durable receipts make a committed exchange safe to replay after a lost ack.
CREATE TABLE IF NOT EXISTS trainer_trade_receipts (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 user_low INT NOT NULL,
 user_high INT NOT NULL,
 offer_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 receipt_json JSON NOT NULL,
 completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_trade_low (user_low,completed_at),
 KEY idx_trade_high (user_high,completed_at),
 CONSTRAINT fk_trade_low FOREIGN KEY(user_low) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_trade_high FOREIGN KEY(user_high) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

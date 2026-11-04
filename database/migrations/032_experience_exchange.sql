CREATE TABLE IF NOT EXISTS experience_exchange_receipts (
 request_id CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 request_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX experience_exchange_owner(user_id,created_at),
 CONSTRAINT fk_experience_exchange_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

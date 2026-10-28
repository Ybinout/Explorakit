-- Private messages are durable; presence and opt-in travel groups are transient.
CREATE TABLE IF NOT EXISTS trainer_messages (
 id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_low INT NOT NULL,
 user_high INT NOT NULL,
 sender_id INT NOT NULL,
 recipient_id INT NOT NULL,
 client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 body VARCHAR(500) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uniq_trainer_message_retry (sender_id,client_id),
 KEY idx_trainer_conversation (user_low,user_high,id),
 KEY idx_trainer_inbox (recipient_id,sender_id,id),
 CONSTRAINT fk_message_sender FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_message_recipient FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trainer_message_reads (
 user_id INT NOT NULL,
 peer_id INT NOT NULL,
 last_read_id INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,peer_id),
 CONSTRAINT fk_message_read_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_message_read_peer FOREIGN KEY(peer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

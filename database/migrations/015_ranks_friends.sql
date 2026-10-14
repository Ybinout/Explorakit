-- Additive tables only. Historical results and account balances are preserved.
CREATE TABLE IF NOT EXISTS rift_ratings (
 user_id INT NOT NULL PRIMARY KEY,
 rating INT UNSIGNED NOT NULL DEFAULT 1000,
 games INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_rift_rating (rating, user_id),
 CONSTRAINT fk_rating_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rift_rating_results (
 run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id INT NOT NULL,
 placement TINYINT UNSIGNED NOT NULL,
 rating_before INT UNSIGNED NOT NULL,
 rating_after INT UNSIGNED NOT NULL,
 delta SMALLINT NOT NULL,
 PRIMARY KEY(run_id,user_id),
 CONSTRAINT fk_rating_result_run FOREIGN KEY (run_id) REFERENCES rift_runs(id) ON DELETE CASCADE,
 CONSTRAINT fk_rating_result_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trainer_friendships (
 user_low INT NOT NULL,
 user_high INT NOT NULL,
 requested_by INT NOT NULL,
 status ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_low,user_high),
 KEY idx_friends_high(user_high,status),
 CONSTRAINT fk_friends_low FOREIGN KEY(user_low) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_friends_high FOREIGN KEY(user_high) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_friends_requester FOREIGN KEY(requested_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

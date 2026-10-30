-- One durable, owner-scoped attempt and a monotonic personal record.
CREATE TABLE IF NOT EXISTS super_tournament_profiles (
 user_id INT NOT NULL PRIMARY KEY,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 snapshot LONGBLOB NULL,
 score INT UNSIGNED NOT NULL DEFAULT 0,
 best_score INT UNSIGNED NOT NULL DEFAULT 0,
 best_rooms SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_super_tournament_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX super_tournament_ranking(best_score, best_rooms)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whitepeak_roulette_rounds (
 id CHAR(36) PRIMARY KEY, active_slot TINYINT NULL UNIQUE,
 phase VARCHAR(16) NOT NULL, opens_at BIGINT NOT NULL, closes_at BIGINT NOT NULL,
 result_at BIGINT NOT NULL, next_at BIGINT NOT NULL, result TINYINT NULL,
 INDEX roulette_history(phase,next_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whitepeak_roulette_bets (
 id CHAR(36) PRIMARY KEY, round_id CHAR(36) NOT NULL, user_id INT NOT NULL,
 choice_json JSON NOT NULL, amount BIGINT NOT NULL, payout BIGINT NOT NULL DEFAULT 0,
 INDEX roulette_bets_round(round_id,user_id), INDEX roulette_bets_user(user_id,round_id),
 CONSTRAINT roulette_round_fk FOREIGN KEY(round_id) REFERENCES whitepeak_roulette_rounds(id) ON DELETE CASCADE,
 CONSTRAINT roulette_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whitepeak_duels (
 id CHAR(36) PRIMARY KEY, phase VARCHAR(16) NOT NULL,
 user_a INT NOT NULL, user_b INT NOT NULL, stake BIGINT NOT NULL,
 offers_json JSON NOT NULL, result_json JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX club_duel_recovery(phase),
 CONSTRAINT club_duel_a_fk FOREIGN KEY(user_a) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT club_duel_b_fk FOREIGN KEY(user_b) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whitepeak_duel_scores (
 user_id INT PRIMARY KEY, wins INT UNSIGNED NOT NULL DEFAULT 0,
 losses INT UNSIGNED NOT NULL DEFAULT 0, draws INT UNSIGNED NOT NULL DEFAULT 0,
 points INT UNSIGNED NOT NULL DEFAULT 0,
 CONSTRAINT club_score_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

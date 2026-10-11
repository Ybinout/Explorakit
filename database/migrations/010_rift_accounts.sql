-- Persistent RiftMon account statistics, separate from Adventure money.
-- Applying this migration never attributes victories from old ephemeral runs.
CREATE TABLE IF NOT EXISTS rift_profiles (
    user_id INT NOT NULL,
    wins BIGINT UNSIGNED NOT NULL DEFAULT 0,
    losses BIGINT UNSIGNED NOT NULL DEFAULT 0,
    games_started BIGINT UNSIGNED NOT NULL DEFAULT 0,
    coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_rift_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rift_runs (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    roster_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    participant_count TINYINT UNSIGNED NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    winner_id INT NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_rift_runs_finished (finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rift_run_entries (
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id INT NOT NULL,
    outcome ENUM('pending', 'win', 'loss') NOT NULL DEFAULT 'pending',
    coins_earned INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, user_id),
    KEY idx_rift_entries_user (user_id),
    CONSTRAINT fk_rift_entries_run FOREIGN KEY (run_id) REFERENCES rift_runs (id) ON DELETE CASCADE,
    CONSTRAINT fk_rift_entries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

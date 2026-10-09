CREATE TABLE IF NOT EXISTS player_story_flags (
    user_id INT NOT NULL,
    flag_key VARCHAR(100) NOT NULL,
    flag_value VARCHAR(255) NOT NULL DEFAULT 'true',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, flag_key),
    CONSTRAINT fk_story_flags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_quests (
    user_id INT NOT NULL,
    quest_key VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    progress INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (user_id, quest_key),
    CONSTRAINT fk_player_quests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_badges (
    user_id INT NOT NULL,
    badge_key VARCHAR(100) NOT NULL,
    awarded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, badge_key),
    CONSTRAINT fk_player_badges_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_pokedex (
    user_id INT NOT NULL,
    pokemon_id INT NOT NULL,
    seen_count INT UNSIGNED NOT NULL DEFAULT 0,
    caught_count INT UNSIGNED NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMP NULL DEFAULT NULL,
    first_caught_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pokemon_id),
    CONSTRAINT fk_user_pokedex_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_npc_battles (
    user_id INT NOT NULL,
    battle_key VARCHAR(100) NOT NULL,
    dialogue_name VARCHAR(100) NOT NULL,
    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reward_json TEXT NULL,
    PRIMARY KEY (user_id, battle_key),
    CONSTRAINT fk_user_npc_battles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO player_story_flags (user_id, flag_key, flag_value)
SELECT id, 'starter_chosen', 'true' FROM users;

INSERT IGNORE INTO player_quests (user_id, quest_key, status, progress)
SELECT id, 'main_sister_search', 'active', 0 FROM users;

INSERT IGNORE INTO player_quests (user_id, quest_key, status, progress)
SELECT id, 'first_challenge', 'active', 0 FROM users;

INSERT INTO user_pokedex (user_id, pokemon_id, seen_count, caught_count, first_seen_at, first_caught_at)
SELECT t.user_id, p.pokemon_id, COUNT(*), COUNT(*), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM teams t
INNER JOIN pokemons p ON p.team_id = t.id
GROUP BY t.user_id, p.pokemon_id
ON DUPLICATE KEY UPDATE
    seen_count = GREATEST(seen_count, VALUES(seen_count)),
    caught_count = GREATEST(caught_count, VALUES(caught_count)),
    first_seen_at = COALESCE(first_seen_at, VALUES(first_seen_at)),
    first_caught_at = COALESCE(first_caught_at, VALUES(first_caught_at));

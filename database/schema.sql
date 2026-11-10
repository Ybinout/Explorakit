DROP TABLE IF EXISTS casino_slot_sessions;
DROP TABLE IF EXISTS housing_receipts;
DROP TABLE IF EXISTS housing_visits;
DROP TABLE IF EXISTS housing_profiles;
DROP TABLE IF EXISTS corruption_receipts;
DROP TABLE IF EXISTS trainer_trade_receipts;
DROP TABLE IF EXISTS trainer_message_reads;
DROP TABLE IF EXISTS trainer_messages;
DROP TABLE IF EXISTS pokemon_storage_boxes;
DROP TABLE IF EXISTS pokemon_storage;
DROP TABLE IF EXISTS trainer_friendships;
DROP TABLE IF EXISTS rift_rating_results;
DROP TABLE IF EXISTS rift_ratings;
DROP TABLE IF EXISTS colosseum_bests;
DROP TABLE IF EXISTS colosseum_runs;
DROP TABLE IF EXISTS rift_reports;
DROP TABLE IF EXISTS rift_cosmetics;
DROP TABLE IF EXISTS rift_appearance;
DROP TABLE IF EXISTS rift_checkpoints;
-- Empty development/test schema. Never apply to an existing production database.

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `pokemon_game`
--

DROP TABLE IF EXISTS `rift_run_entries`;
DROP TABLE IF EXISTS `rift_runs`;
DROP TABLE IF EXISTS `rift_profiles`;
DROP TABLE IF EXISTS `user_npc_battles`;
DROP TABLE IF EXISTS `user_pokedex`;
DROP TABLE IF EXISTS `player_badges`;
DROP TABLE IF EXISTS `player_quests`;
DROP TABLE IF EXISTS `player_story_flags`;

-- --------------------------------------------------------

--
-- Structure de la table `pokemons`
--

DROP TABLE IF EXISTS `pokemons`;
CREATE TABLE IF NOT EXISTS `pokemons` (
  ev_hp SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ev_attack SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ev_defense SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ev_special_attack SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ev_special_defense SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ev_speed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uuid` char(36) NOT NULL,
  `team_id` int(11) NOT NULL,
  `position` int(11) NOT NULL,
  `pokemon_id` int(11) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  `level` int unsigned NOT NULL DEFAULT 1,
  `experience` bigint unsigned NOT NULL DEFAULT 0,
  `iv_attack` int(11) DEFAULT NULL,
  `iv_defense` int(11) DEFAULT NULL,
  `iv_hp` int(11) DEFAULT NULL,
  `iv_special_attack` int(11) DEFAULT NULL,
  `iv_special_defense` int(11) DEFAULT NULL,
  `iv_speed` int(11) DEFAULT NULL,
  `nature` varchar(20) DEFAULT NULL,
  `k` int(11) DEFAULT NULL,
  `current_hp` int(11) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'normal',
  `passive_ability` varchar(50) DEFAULT NULL,
  `held_item` varchar(50) DEFAULT NULL,
  `current_attack` int(11) DEFAULT NULL,
  `current_defense` int(11) DEFAULT NULL,
  `current_special_attack` int(11) DEFAULT NULL,
  `current_special_defense` int(11) DEFAULT NULL,
  `current_speed` int(11) DEFAULT NULL,
  `ability1` varchar(50) DEFAULT NULL,
  `ability2` varchar(50) DEFAULT NULL,
  `ability3` varchar(50) DEFAULT NULL,
  `ability4` varchar(50) DEFAULT NULL,
  `move1_pp` smallint unsigned DEFAULT NULL,
  `move2_pp` smallint unsigned DEFAULT NULL,
  `move3_pp` smallint unsigned DEFAULT NULL,
  `move4_pp` smallint unsigned DEFAULT NULL,
  `pending_moves` JSON DEFAULT NULL,
  `experience_rate` DECIMAL(10,6) DEFAULT NULL,
  `evolution_state` JSON DEFAULT NULL,
  `corruption` JSON DEFAULT NULL,
  `shiny` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  UNIQUE KEY `uniq_team_position` (`team_id`,`position`),
  KEY `team_id` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `teams`
--

DROP TABLE IF EXISTS `teams`;
CREATE TABLE IF NOT EXISTS `teams` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `team_name` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_team_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `x` int(11) DEFAULT '80',
  `y` int(11) DEFAULT '208',
  `map` varchar(50) DEFAULT 'start',
  `respawn_x` int(11) DEFAULT NULL,
  `respawn_y` int(11) DEFAULT NULL,
  `respawn_map` varchar(50) DEFAULT NULL,
  `center_return_x` int DEFAULT NULL,
  `center_return_y` int DEFAULT NULL,
  `center_return_map` varchar(50) DEFAULT NULL,
  `sprite` varchar(50) DEFAULT 'sprite.png',
  `sprite_palette` varchar(24) DEFAULT NULL,
  `money` bigint unsigned NOT NULL DEFAULT 0,
  `repel_steps` smallint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `user_items`
--

DROP TABLE IF EXISTS `user_items`;
CREATE TABLE IF NOT EXISTS `user_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `item_key` varchar(50) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_item` (`user_id`,`item_key`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Exemple d'inventaire de base pour un joueur
--

CREATE TABLE IF NOT EXISTS `player_story_flags` (
  `user_id` int(11) NOT NULL,
  `flag_key` varchar(100) NOT NULL,
  `flag_value` varchar(255) NOT NULL DEFAULT 'true',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`flag_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `player_quests` (
  `user_id` int(11) NOT NULL,
  `quest_key` varchar(100) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `progress` int unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`,`quest_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `player_badges` (
  `user_id` int(11) NOT NULL,
  `badge_key` varchar(100) NOT NULL,
  `awarded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`badge_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_pokedex` (
  `user_id` int(11) NOT NULL,
  `pokemon_id` int(11) NOT NULL,
  `seen_count` int unsigned NOT NULL DEFAULT 0,
  `caught_count` int unsigned NOT NULL DEFAULT 0,
  `shiny_seen_count` int unsigned NOT NULL DEFAULT 0,
  `shiny_caught_count` int unsigned NOT NULL DEFAULT 0,
  `first_seen_at` timestamp NULL DEFAULT NULL,
  `first_caught_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`pokemon_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_npc_battles` (
  `user_id` int(11) NOT NULL,
  `battle_key` varchar(100) NOT NULL,
  `dialogue_name` varchar(100) NOT NULL,
  `completed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reward_json` text NULL,
  PRIMARY KEY (`user_id`,`battle_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `teams`
  ADD CONSTRAINT `fk_teams_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `pokemons`
  ADD CONSTRAINT `fk_pokemons_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE;
ALTER TABLE `user_items`
  ADD CONSTRAINT `fk_user_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `player_story_flags`
  ADD CONSTRAINT `fk_story_flags_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `player_quests`
  ADD CONSTRAINT `fk_player_quests_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `player_badges`
  ADD CONSTRAINT `fk_player_badges_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `user_pokedex`
  ADD CONSTRAINT `fk_user_pokedex_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `user_npc_battles`
  ADD CONSTRAINT `fk_user_npc_battles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
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
    reward_exploration_ms INT UNSIGNED NULL DEFAULT NULL,
    reward_version SMALLINT UNSIGNED NULL DEFAULT NULL,
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

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

CREATE TABLE IF NOT EXISTS rift_checkpoints (
 id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 payload LONGBLOB NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS rift_reports (
 run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 report_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_rift_report_run FOREIGN KEY (run_id) REFERENCES rift_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rift_cosmetics (
 user_id INT NOT NULL,
 cosmetic_key VARCHAR(64) NOT NULL,
 purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,cosmetic_key),
 CONSTRAINT fk_cosmetic_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rift_appearance (
 user_id INT NOT NULL PRIMARY KEY,
 title_key VARCHAR(64) NULL,
 frame_key VARCHAR(64) NULL,
 CONSTRAINT fk_appearance_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colosseum_runs (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
 score BIGINT UNSIGNED NOT NULL DEFAULT 0,
 wins INT UNSIGNED NOT NULL DEFAULT 0,
 report_json MEDIUMTEXT NULL,
 started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at DATETIME(3) NULL,
 CONSTRAINT fk_colosseum_run_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS colosseum_bests (
 user_id INT NOT NULL,
 duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
 PRIMARY KEY (user_id,duration_minutes),
 run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 CONSTRAINT fk_colosseum_best_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_colosseum_best_run FOREIGN KEY (run_id) REFERENCES colosseum_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Dedicated storage: active party schema and existing companions stay unchanged.
CREATE TABLE IF NOT EXISTS pokemon_storage (
 uuid CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 box_index TINYINT UNSIGNED NOT NULL,
 slot_index TINYINT UNSIGNED NOT NULL,
 pokemon_data JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uniq_storage_slot(user_id,box_index,slot_index),
 CONSTRAINT fk_storage_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable receipts: moving, equipping or consuming an item never resets discovery.
CREATE TABLE IF NOT EXISTS user_item_discoveries (
 user_id INT NOT NULL,
 item_key VARCHAR(64) NOT NULL,
 discovered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,item_key),
 CONSTRAINT fk_item_discovery_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- One durable, owner-scoped attempt and a monotonic personal record.
CREATE TABLE IF NOT EXISTS super_tournament_profiles (
 user_id INT NOT NULL PRIMARY KEY,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 snapshot LONGBLOB NULL,
 score BIGINT UNSIGNED NOT NULL DEFAULT 0,
 best_score BIGINT UNSIGNED NOT NULL DEFAULT 0,
 best_rooms BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_super_tournament_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX super_tournament_ranking(best_score, best_rooms)
) ENGINE=InnoDB;

-- Sparse private labels: adding capacity never moves or rewrites stored Pokémon.
CREATE TABLE IF NOT EXISTS pokemon_storage_boxes (
 user_id INT NOT NULL,
 box_index TINYINT UNSIGNED NOT NULL,
 name VARCHAR(24) NOT NULL,
 PRIMARY KEY(user_id,box_index),
 CONSTRAINT fk_storage_box_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS corruption_receipts (
 id CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 operation VARCHAR(10) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_corruption_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX idx_corruption_receipt_owner (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dark_battle_checkpoints (
 user_id INT NOT NULL PRIMARY KEY,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 snapshot LONGBLOB NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT dark_battle_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Shared daily rifts and versioned raid snapshots. Party losses/rewards commit with each snapshot.
CREATE TABLE IF NOT EXISTS corruption_raid_world (
 day_key CHAR(10) NOT NULL PRIMARY KEY,
 snapshot MEDIUMBLOB NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS corruption_raids (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 phase VARCHAR(16) NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 snapshot MEDIUMBLOB NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY raid_phase(phase,updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS corruption_raid_members (
 user_id INT NOT NULL PRIMARY KEY,
 raid_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 CONSTRAINT corruption_raid_member_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT corruption_raid_member_raid FOREIGN KEY(raid_id) REFERENCES corruption_raids(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS corruption_raid_rewards (
 raid_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id INT NOT NULL,
 receipt_json JSON NOT NULL,
 PRIMARY KEY(raid_id,user_id),
 CONSTRAINT corruption_raid_reward_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT corruption_raid_reward_raid FOREIGN KEY(raid_id) REFERENCES corruption_raids(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Draft cards/teams never enter permanent party or storage tables.
CREATE TABLE IF NOT EXISTS draft_tables (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 phase VARCHAR(20) NOT NULL,
 version INT UNSIGNED NOT NULL,
 snapshot MEDIUMBLOB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY draft_phase(phase,updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS draft_members (
 user_id INT NOT NULL PRIMARY KEY,
 table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 CONSTRAINT draft_member_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT draft_member_table FOREIGN KEY(table_id) REFERENCES draft_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS draft_rewards (
 table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id INT NOT NULL,
 amount BIGINT UNSIGNED NOT NULL,
 placement TINYINT UNSIGNED NOT NULL,
 PRIMARY KEY(table_id,user_id),
 CONSTRAINT draft_reward_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT draft_reward_table FOREIGN KEY(table_id) REFERENCES draft_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB;

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

-- Per-placement independent growth, evaluated from timestamps; no background plant timers.
CREATE TABLE IF NOT EXISTS housing_berry_crops (
 user_id INT NOT NULL,
 furniture_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 slot_index TINYINT UNSIGNED NOT NULL,
 berry_key VARCHAR(100) NOT NULL,
 planted_at BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(user_id,furniture_id,slot_index),
 CONSTRAINT berry_crop_owner FOREIGN KEY(user_id) REFERENCES housing_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS berry_recipe_discoveries (
 user_id INT NOT NULL,
 recipe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ingredients_json JSON NOT NULL,
 family_key VARCHAR(60) NOT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 1,
 first_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(user_id,recipe_key),
 CONSTRAINT berry_recipe_owner FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS berry_consumption_receipts (
 battle_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 pokemon_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id INT NOT NULL,
 item_key VARCHAR(100) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(battle_id,pokemon_uuid,item_key),
 KEY berry_consumption_owner(user_id,created_at),
 CONSTRAINT berry_consumption_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_market_listings (
 id CHAR(36) NOT NULL PRIMARY KEY,
 seller_id INT NOT NULL,
 buyer_id INT NULL,
 request_hash CHAR(64) NOT NULL,
 category VARCHAR(32) NOT NULL,
 kind VARCHAR(8) NOT NULL,
 item_key VARCHAR(191) NULL,
 quantity INT UNSIGNED NOT NULL DEFAULT 1,
 price BIGINT UNSIGNED NOT NULL,
 pokemon_uuid CHAR(36) NULL,
 pokemon_data LONGTEXT NULL,
 search_text VARCHAR(255) NOT NULL,
 pokemon_types VARCHAR(40) NULL,
 pokemon_level INT NULL,
 pokemon_k TINYINT NULL,
 pokemon_shiny TINYINT NOT NULL DEFAULT 0,
 status VARCHAR(12) NOT NULL DEFAULT 'open',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 settled_at TIMESTAMP NULL,
 UNIQUE KEY uq_market_pokemon (pokemon_uuid),
 KEY ix_market_browse (status,category,created_at,id),
 KEY ix_market_seller (seller_id,status,created_at),
 CONSTRAINT fk_market_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_market_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_market_notices (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL,
 listing_id CHAR(36) NOT NULL,
 message VARCHAR(500) NOT NULL,
 read_at TIMESTAMP NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_market_notice (listing_id),
 KEY ix_market_notice_user (user_id,read_at,id),
 CONSTRAINT fk_market_notice_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_market_notice_listing FOREIGN KEY (listing_id) REFERENCES player_market_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- phpMyAdmin SQL Dump
-- version 5.1.1
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1:3306
-- Généré le : dim. 02 mars 2025 à 12:29
-- Version du serveur : 5.7.36
-- Version de PHP : 7.4.26

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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  UNIQUE KEY `uniq_team_position` (`team_id`,`position`),
  KEY `team_id` (`team_id`)
) ENGINE=InnoDB AUTO_INCREMENT=295 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Déchargement des données de la table `pokemons`
--

INSERT INTO `pokemons` (`id`, `uuid`, `team_id`, `position`, `pokemon_id`, `name`, `level`, `experience`, `iv_attack`, `iv_defense`, `iv_hp`, `iv_special_attack`, `iv_special_defense`, `iv_speed`, `nature`, `k`, `current_hp`, `status`, `passive_ability`, `held_item`, `current_attack`, `current_defense`, `current_special_attack`, `current_special_defense`, `current_speed`, `ability1`, `ability2`, `ability3`, `ability4`, `move1_pp`, `move2_pp`, `move3_pp`, `move4_pp`, `created_at`) VALUES
(294, '2e57be6e-da5d-4695-b9c3-a4e04be3f5f9', 1, 2, 269, 'toto', 132, 2500000, 31, 31, 31, 31, 31, 31, 'Timid', 1, 338, 'normal', NULL, NULL, 158, 229, 176, 281, 237, 'Frenzy Plant', 'Pound', 'Pound', 'Pound', 5, 35, 35, 35, '2025-03-01 15:23:20'),
(293, '0f2570de-6e62-4e97-be6e-836918e319db', 1, 1, 269, 'tata', 140, 3000000, 31, 31, 31, 31, 31, 31, 'Timid', 1, 358, 'normal', NULL, NULL, 168, 242, 187, 298, 251, 'Frenzy Plant', 'Pound', 'Pound', 'Pound', 5, 35, 35, 35, '2025-03-01 15:23:20');

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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Déchargement des données de la table `teams`
--

INSERT INTO `teams` (`id`, `user_id`, `team_name`, `created_at`) VALUES
(1, 1, 'Updated Team Name', '2024-08-24 13:50:32');

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
  `money` bigint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Déchargement des données de la table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `created_at`, `x`, `y`, `map`, `respawn_x`, `respawn_y`, `respawn_map`, `sprite`, `money`) VALUES
(1, 'aa', NULL, 'aa', '2024-08-19 12:16:40', 80, 208, 'start', NULL, NULL, NULL, 'sprite.png', 0);

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

INSERT INTO `user_items` (`user_id`, `item_key`, `quantity`) VALUES
(1, 'pokeball', 10),
(1, 'superball', 5),
(1, 'hyperball', 2),
(1, 'oran_berry', 2);

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

INSERT INTO `player_story_flags` (`user_id`, `flag_key`, `flag_value`) VALUES
(1, 'starter_chosen', 'true');
INSERT INTO `player_quests` (`user_id`, `quest_key`, `status`, `progress`) VALUES
(1, 'main_sister_search', 'active', 0),
(1, 'first_challenge', 'active', 0);
INSERT INTO `user_pokedex` (`user_id`, `pokemon_id`, `seen_count`, `caught_count`, `first_seen_at`, `first_caught_at`) VALUES
(1, 269, 2, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

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

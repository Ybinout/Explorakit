-- phpMyAdmin SQL Dump
-- version 5.1.1
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1:3306
-- Généré le : dim. 02 mars 2025 à 12:29
-- Version du serveur : 5.7.36
-- Version de PHP : 7.4.26

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `pokemon_game`
--

-- --------------------------------------------------------

--
-- Structure de la table `pokemons`
--

DROP TABLE IF EXISTS `pokemons`;
CREATE TABLE IF NOT EXISTS `pokemons` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uuid` char(36) DEFAULT NULL,
  `team_id` int(11) DEFAULT NULL,
  `position` int(11) DEFAULT NULL,
  `pokemon_id` int(11) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  `level` int(11) DEFAULT NULL,
  `experience` int(11) DEFAULT NULL,
  `iv_attack` int(11) DEFAULT NULL,
  `iv_defense` int(11) DEFAULT NULL,
  `iv_hp` int(11) DEFAULT NULL,
  `iv_special_attack` int(11) DEFAULT NULL,
  `iv_special_defense` int(11) DEFAULT NULL,
  `iv_speed` int(11) DEFAULT NULL,
  `nature` varchar(20) DEFAULT NULL,
  `k` int(11) DEFAULT NULL,
  `current_hp` int(11) DEFAULT NULL,
  `current_attack` int(11) DEFAULT NULL,
  `current_defense` int(11) DEFAULT NULL,
  `current_special_attack` int(11) DEFAULT NULL,
  `current_special_defense` int(11) DEFAULT NULL,
  `current_speed` int(11) DEFAULT NULL,
  `ability1` varchar(50) DEFAULT NULL,
  `ability2` varchar(50) DEFAULT NULL,
  `ability3` varchar(50) DEFAULT NULL,
  `ability4` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `team_id` (`team_id`)
) ENGINE=MyISAM AUTO_INCREMENT=295 DEFAULT CHARSET=latin1;

--
-- Déchargement des données de la table `pokemons`
--

INSERT INTO `pokemons` (`id`, `uuid`, `team_id`, `position`, `pokemon_id`, `name`, `level`, `experience`, `iv_attack`, `iv_defense`, `iv_hp`, `iv_special_attack`, `iv_special_defense`, `iv_speed`, `nature`, `k`, `current_hp`, `current_attack`, `current_defense`, `current_special_attack`, `current_special_defense`, `current_speed`, `ability1`, `ability2`, `ability3`, `ability4`, `created_at`) VALUES
(294, '2e57be6e-da5d-4695-b9c3-a4e04be3f5f9', 1, 2, 269, 'toto', 132, 2500000, 31, 31, 31, 31, 31, 31, 'Timid', 1, 338, 158, 229, 176, 281, 237, 'Frenzy Plant', 'Pound', 'Pound', 'Pound', '2025-03-01 15:23:20'),
(293, '0f2570de-6e62-4e97-be6e-836918e319db', 1, 1, 269, 'tata', 140, 3000000, 31, 31, 31, 31, 31, 31, 'Timid', 1, 358, 168, 242, 187, 298, 251, 'Frenzy Plant', 'Pound', 'Pound', 'Pound', '2025-03-01 15:23:20');

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
  KEY `user_id` (`user_id`)
) ENGINE=MyISAM AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;

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
  `x` int(11) DEFAULT '0',
  `y` int(11) DEFAULT '0',
  `map` varchar(50) DEFAULT 'default_map',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=MyISAM AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;

--
-- Déchargement des données de la table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `created_at`, `x`, `y`, `map`) VALUES
(1, 'aa', NULL, 'aa', '2024-08-19 12:16:40', 0, 0, 'default_map');
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

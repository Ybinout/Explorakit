-- Permet une progression largement au-delà du niveau 100 sans plafond applicatif.
-- BIGINT UNSIGNED reste borné techniquement par MySQL, mais dépasse très largement
-- les valeurs atteignables dans une partie normale.
ALTER TABLE pokemons
  MODIFY level INT UNSIGNED NOT NULL DEFAULT 1,
  MODIFY experience BIGINT UNSIGNED NOT NULL DEFAULT 0;

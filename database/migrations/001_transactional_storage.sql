-- À appliquer une seule fois sur une base Explorakit existante.
-- Sauvegarder la base avant migration et résoudre les éventuels doublons signalés.
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE users ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE teams ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE pokemons ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE user_items ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE teams ADD CONSTRAINT uniq_team_user UNIQUE (user_id);
ALTER TABLE pokemons MODIFY uuid CHAR(36) NOT NULL;
ALTER TABLE pokemons MODIFY team_id INT NOT NULL;
ALTER TABLE pokemons MODIFY position INT NOT NULL;
ALTER TABLE pokemons ADD CONSTRAINT uniq_team_position UNIQUE (team_id, position);

ALTER TABLE teams ADD CONSTRAINT fk_teams_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pokemons ADD CONSTRAINT fk_pokemons_team
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE user_items ADD CONSTRAINT fk_user_items_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;

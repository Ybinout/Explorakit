CREATE TABLE IF NOT EXISTS whitepeak_mode_scores (
 mode VARCHAR(3) NOT NULL, user_id INT NOT NULL,
 wins INT UNSIGNED NOT NULL DEFAULT 0, losses INT UNSIGNED NOT NULL DEFAULT 0,
 draws INT UNSIGNED NOT NULL DEFAULT 0, points INT UNSIGNED NOT NULL DEFAULT 0,
 last_team JSON NULL, last_format TINYINT UNSIGNED NULL, last_duel_id CHAR(36) NULL,
 PRIMARY KEY(mode,user_id),
 INDEX club_mode_order(mode,points,wins,losses,user_id),
 CONSTRAINT club_mode_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whitepeak_ranking_meta (
 id TINYINT PRIMARY KEY, initialized BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;
INSERT IGNORE INTO whitepeak_ranking_meta(id,initialized) VALUES(1,FALSE);

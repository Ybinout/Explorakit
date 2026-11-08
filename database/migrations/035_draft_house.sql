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

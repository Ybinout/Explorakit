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

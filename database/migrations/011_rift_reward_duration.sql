-- The reward policy and exploration clock are frozen at settlement.
-- Existing finished runs retain their recorded coins; NULL means legacy reward.
ALTER TABLE rift_runs
    ADD COLUMN reward_exploration_ms INT UNSIGNED NULL DEFAULT NULL,
    ADD COLUMN reward_version SMALLINT UNSIGNED NULL DEFAULT NULL;

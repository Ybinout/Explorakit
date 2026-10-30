-- Preserve existing scores and snapshots while allowing more than 65,535 rooms.
ALTER TABLE super_tournament_profiles
 MODIFY score BIGINT UNSIGNED NOT NULL DEFAULT 0,
 MODIFY best_score BIGINT UNSIGNED NOT NULL DEFAULT 0,
 MODIFY best_rooms BIGINT UNSIGNED NOT NULL DEFAULT 0;

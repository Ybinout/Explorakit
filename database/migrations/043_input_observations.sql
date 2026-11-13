-- Private, bounded server observations. Never included in progression payloads.
CREATE TABLE IF NOT EXISTS input_observations (
 user_id INT NOT NULL PRIMARY KEY,
 snapshot MEDIUMTEXT NOT NULL,
 last_alert_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_input_observation_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

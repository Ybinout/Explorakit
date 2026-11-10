CREATE TABLE IF NOT EXISTS player_market_listings (
 id CHAR(36) NOT NULL PRIMARY KEY,
 seller_id INT NOT NULL,
 buyer_id INT NULL,
 request_hash CHAR(64) NOT NULL,
 category VARCHAR(32) NOT NULL,
 kind VARCHAR(8) NOT NULL,
 item_key VARCHAR(191) NULL,
 quantity INT UNSIGNED NOT NULL DEFAULT 1,
 price BIGINT UNSIGNED NOT NULL,
 pokemon_uuid CHAR(36) NULL,
 pokemon_data LONGTEXT NULL,
 search_text VARCHAR(255) NOT NULL,
 pokemon_types VARCHAR(40) NULL,
 pokemon_level INT NULL,
 pokemon_k TINYINT NULL,
 pokemon_shiny TINYINT NOT NULL DEFAULT 0,
 status VARCHAR(12) NOT NULL DEFAULT 'open',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 settled_at TIMESTAMP NULL,
 UNIQUE KEY uq_market_pokemon (pokemon_uuid),
 KEY ix_market_browse (status,category,created_at,id),
 KEY ix_market_seller (seller_id,status,created_at),
 CONSTRAINT fk_market_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_market_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_market_notices (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL,
 listing_id CHAR(36) NOT NULL,
 message VARCHAR(500) NOT NULL,
 read_at TIMESTAMP NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_market_notice (listing_id),
 KEY ix_market_notice_user (user_id,read_at,id),
 CONSTRAINT fk_market_notice_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_market_notice_listing FOREIGN KEY (listing_id) REFERENCES player_market_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

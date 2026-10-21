-- Durable receipts: moving, equipping or consuming an item never resets discovery.
CREATE TABLE IF NOT EXISTS user_item_discoveries (
 user_id INT NOT NULL,
 item_key VARCHAR(64) NOT NULL,
 discovered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,item_key),
 CONSTRAINT fk_item_discovery_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing items and duplicate quantities are preserved, including those in PCs.
INSERT IGNORE INTO user_item_discoveries(user_id,item_key)
 SELECT user_id,item_key FROM user_items WHERE quantity>0 AND item_key IN
 ('leftovers','life_orb','choice_band','choice_specs','choice_scarf','focus_sash','assault_vest','eviolite','expert_belt','shell_bell','rocky_helmet','exp_share');
INSERT IGNORE INTO user_item_discoveries(user_id,item_key)
 SELECT t.user_id,p.held_item FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE p.held_item IN
 ('leftovers','life_orb','choice_band','choice_specs','choice_scarf','focus_sash','assault_vest','eviolite','expert_belt','shell_bell','rocky_helmet','exp_share');
INSERT IGNORE INTO user_item_discoveries(user_id,item_key)
 SELECT user_id,JSON_UNQUOTE(COALESCE(JSON_EXTRACT(pokemon_data,'$.held_item'),JSON_EXTRACT(pokemon_data,'$.heldItem'))) FROM pokemon_storage WHERE JSON_UNQUOTE(COALESCE(JSON_EXTRACT(pokemon_data,'$.held_item'),JSON_EXTRACT(pokemon_data,'$.heldItem'))) IN
 ('leftovers','life_orb','choice_band','choice_specs','choice_scarf','focus_sash','assault_vest','eviolite','expert_belt','shell_bell','rocky_helmet','exp_share');

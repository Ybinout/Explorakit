-- Les statuts non volatils survivent desormais aux sauvegardes et reconnexions.
ALTER TABLE pokemons
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'normal' AFTER current_hp;

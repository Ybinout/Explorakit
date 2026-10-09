-- Point de reapparition durable : dernier Centre Pokemon visite.
ALTER TABLE users
    ADD COLUMN respawn_x INT NULL AFTER map,
    ADD COLUMN respawn_y INT NULL AFTER respawn_x,
    ADD COLUMN respawn_map VARCHAR(50) NULL AFTER respawn_y;

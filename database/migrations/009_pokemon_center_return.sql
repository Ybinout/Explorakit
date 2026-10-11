-- Each player's last center entrance also identifies their center after a blackout.
ALTER TABLE users
    ADD COLUMN center_return_x INT NULL,
    ADD COLUMN center_return_y INT NULL,
    ADD COLUMN center_return_map VARCHAR(50) NULL;

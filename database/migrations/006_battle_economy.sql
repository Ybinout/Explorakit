SET @money_column_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'money'
);
SET @money_migration_sql = IF(
    @money_column_exists = 0,
    'ALTER TABLE users ADD COLUMN money BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER sprite',
    'SELECT 1'
);
PREPARE money_migration_statement FROM @money_migration_sql;
EXECUTE money_migration_statement;
DEALLOCATE PREPARE money_migration_statement;

const { spawnSync } = require('child_process');
const path = require('path');

const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;

if (!/test/i.test(testDatabaseName)) {
    console.error('Définissez DB_TEST_NAME avec un nom contenant « test » avant de lancer les tests MySQL.');
    process.exit(1);
}

const result = spawnSync(
    process.execPath,
    [
        '--test',
        '--test-concurrency=1', // Integration suites share one database; avoid inter-suite lock races.
        path.resolve(__dirname, '..', 'tests', 'mysql-integration.test.js'),
        path.resolve(__dirname, '..', 'tests', 'battle-runtime-integration.test.js'),
        path.resolve(__dirname, '..', 'tests', 'story-socket-integration.test.js'),
        path.resolve(__dirname, '..', 'tests', 'account-connection-socket.test.js'),
        path.resolve(__dirname, '..', 'tests', 'lucie-departure-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'professor-finale-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'wanda-callout-socket.test.js'),
        path.resolve(__dirname, '..', 'tests', 'void-ending-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'mirror-rift-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'town-trainer-admin.test.js'),
        path.resolve(__dirname, '..', 'tests', 'story-gates-socket.test.js'),
        path.resolve(__dirname, '..', 'tests', 'abra-encounter-socket.test.js'),
        path.resolve(__dirname, '..', 'tests', 'raph-trial-socket.test.js'),
        path.resolve(__dirname, '..', 'tests', 'pokemon-center-socket-integration.test.js'),
        path.resolve(__dirname, '..', 'tests', 'rift-account-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'release-features-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'colosseum-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'trainers-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'social-messages-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'friend-trade-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'wild-ability-availability-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'ability-capsule-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'nature-capsule-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'fishing-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'machines-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'move-sequences-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'held-item-transfer-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'battle-indicator-mysql.test.js'),
        path.resolve(__dirname, '..', 'tests', 'item-usage-mysql.test.js')
    ],
    {
        stdio: 'inherit',
        env: {
            ...process.env,
            RUN_MYSQL_TESTS: '1',
            NODE_ENV: 'test',
            BATTLE_DELAY_SCALE: '0',
            DB_NAME: testDatabaseName,
            DB_TEST_NAME: testDatabaseName
        }
    }
);
process.exit(result.status ?? 1);

const fs = require('fs');
const path = require('path');
const { getDatabaseConfig, mysql } = require('./databaseConnection');

async function setupTestDatabase() {
    const database = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;
    if (!/^[a-zA-Z0-9_]+$/.test(database) || !/test/i.test(database)) {
        throw new Error('DB_TEST_NAME doit être un identifiant simple contenant « test ».');
    }
    const connection = await mysql.createConnection({
        ...getDatabaseConfig(undefined),
        database: undefined,
        multipleStatements: true
    });
    try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await connection.changeUser({ database });
        const schema = fs.readFileSync(path.resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');
        await connection.query(schema);
        console.log(`Base de test prête : ${database}`);
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    setupTestDatabase().catch((error) => {
        console.error(`Préparation de la base de test impossible : ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { setupTestDatabase };

const mysql = require('mysql2/promise');

function getDatabaseConfig(database = process.env.DB_NAME || 'pokemon_game') {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database
    };
}

module.exports = { getDatabaseConfig, mysql };

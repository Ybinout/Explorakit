const mysql = require('mysql2/promise');

async function checkDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'pokemon_game'
    });
    try {
        const [versionRows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db');
        const [tableRows] = await connection.query(
            `SELECT TABLE_NAME, ENGINE
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('users', 'teams', 'pokemons', 'user_items')
             ORDER BY TABLE_NAME`
        );
        return { connection: true, ...versionRows[0], tables: tableRows };
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    checkDatabase()
        .then((result) => console.log(JSON.stringify(result, null, 2)))
        .catch((error) => {
            console.error(JSON.stringify({ connection: false, code: error.code, message: error.message }));
            process.exitCode = 1;
        });
}

module.exports = { checkDatabase };

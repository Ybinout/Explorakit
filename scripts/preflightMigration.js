const { getDatabaseConfig, mysql } = require('./databaseConnection');

const checks = [
    {
        name: 'plusieurs équipes pour un utilisateur',
        sql: 'SELECT user_id, COUNT(*) AS occurrences FROM teams GROUP BY user_id HAVING COUNT(*) > 1'
    },
    {
        name: 'positions dupliquées dans une équipe',
        sql: 'SELECT team_id, position, COUNT(*) AS occurrences FROM pokemons GROUP BY team_id, position HAVING COUNT(*) > 1'
    },
    {
        name: 'UUID Pokémon absents ou dupliqués',
        sql: `SELECT uuid, COUNT(*) AS occurrences FROM pokemons
              GROUP BY uuid HAVING uuid IS NULL OR uuid = '' OR COUNT(*) > 1`
    },
    {
        name: 'Pokémon sans équipe ou position',
        sql: 'SELECT id, uuid FROM pokemons WHERE team_id IS NULL OR position IS NULL'
    },
    {
        name: 'équipes orphelines',
        sql: 'SELECT t.id FROM teams t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL'
    },
    {
        name: 'Pokémon orphelins',
        sql: 'SELECT p.id FROM pokemons p LEFT JOIN teams t ON t.id = p.team_id WHERE t.id IS NULL'
    },
    {
        name: "objets d'utilisateurs orphelins",
        sql: 'SELECT i.id FROM user_items i LEFT JOIN users u ON u.id = i.user_id WHERE u.id IS NULL'
    }
];

async function runPreflight() {
    const connection = await mysql.createConnection(getDatabaseConfig());
    try {
        const [tables] = await connection.query(
            `SELECT TABLE_NAME, ENGINE, TABLE_ROWS
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('users', 'teams', 'pokemons', 'user_items')
             ORDER BY TABLE_NAME`
        );
        if (tables.length !== 4) throw new Error(`Schéma incomplet : ${tables.length}/4 tables critiques trouvées.`);

        const failures = [];
        for (const check of checks) {
            const [rows] = await connection.query(check.sql);
            if (rows.length) failures.push({ name: check.name, count: rows.length, examples: rows.slice(0, 5) });
        }

        console.log(JSON.stringify({ tables, compatible: failures.length === 0, failures }, null, 2));
        if (failures.length) process.exitCode = 2;
        return failures.length === 0;
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    runPreflight().catch((error) => {
        console.error(JSON.stringify({ compatible: false, code: error.code, message: error.message }));
        process.exitCode = 1;
    });
}

module.exports = { runPreflight };

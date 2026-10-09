const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findMysqlDump() {
    if (process.env.MYSQLDUMP_PATH && fs.existsSync(process.env.MYSQLDUMP_PATH)) return process.env.MYSQLDUMP_PATH;
    const wampRoot = 'C:\\wamp64\\bin\\mysql';
    if (fs.existsSync(wampRoot)) {
        const versions = fs.readdirSync(wampRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(wampRoot, entry.name, 'bin', 'mysqldump.exe'))
            .filter((candidate) => fs.existsSync(candidate))
            .sort()
            .reverse();
        if (versions[0]) return versions[0];
    }
    return 'mysqldump';
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupDatabase() {
    const database = process.env.DB_NAME || 'pokemon_game';
    const backupDirectory = path.resolve(__dirname, '..', 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, `${database}-${timestamp()}.sql`);
    const args = [
        `--host=${process.env.DB_HOST || 'localhost'}`,
        `--port=${Number(process.env.DB_PORT || 3306)}`,
        `--user=${process.env.DB_USER || 'root'}`,
        '--default-character-set=utf8mb4',
        '--routines', '--events', '--triggers', '--add-drop-table',
        `--result-file=${backupPath}`,
        '--databases', database
    ];
    const result = spawnSync(findMysqlDump(), args, {
        encoding: 'utf8',
        env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }
    });
    if (result.status !== 0) {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        throw new Error((result.stderr || result.error?.message || 'Échec de mysqldump').trim());
    }
    const size = fs.statSync(backupPath).size;
    if (size === 0) throw new Error('La sauvegarde créée est vide.');
    console.log(JSON.stringify({ backup: backupPath, bytes: size }, null, 2));
    return backupPath;
}

if (require.main === module) {
    try {
        backupDatabase();
    } catch (error) {
        console.error(JSON.stringify({ backup: false, message: error.message }));
        process.exitCode = 1;
    }
}

module.exports = { backupDatabase };

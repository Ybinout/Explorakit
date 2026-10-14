const { dbPool, withTransaction } = require('../config/database');

function identity(run) {
    const userId = Number(run?.players?.[0]?.id);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(run?.id || '') || run.players?.length !== 1 || !Number.isSafeInteger(userId) || userId <= 0)
        throw Error('Tentative Colosseum invalide.');
    return { id: run.id, userId };
}
async function transact(work) {
    for (let attempt = 0; ; attempt++) {
        try { return await withTransaction(work); }
        catch (error) { if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 3) throw error; }
    }
}
async function recordRunStarted(run) {
    const { id, userId } = identity(run);
    return transact(async connection => {
        const [insert] = await connection.execute('INSERT IGNORE INTO colosseum_runs (id,user_id) VALUES (?,?)', [id,userId]);
        const [[stored]] = await connection.execute('SELECT user_id FROM colosseum_runs WHERE id=? FOR UPDATE', [id]);
        if (Number(stored.user_id) !== userId) throw Error('Cette tentative appartient à un autre dresseur.');
        return { recorded: Boolean(insert.affectedRows) };
    });
}
async function recordRunFinished(run) {
    const { id, userId } = identity(run);
    const score = run.report?.colosseum?.score, wins = run.report?.colosseum?.wins;
    const finishedAt = new Date(run.finishedAt);
    if (![score,wins].every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isFinite(finishedAt.getTime()) || run.report?.runId !== id)
        throw Error('Résultat Colosseum invalide.');
    return transact(async connection => {
        // Serialize one user's records, including simultaneous settlements of two runs.
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [[stored]] = await connection.execute('SELECT user_id,finished_at FROM colosseum_runs WHERE id=? FOR UPDATE', [id]);
        if (!stored || Number(stored.user_id) !== userId) throw Error('Tentative Colosseum non enregistrée.');
        if (stored.finished_at) return { recorded: false };
        await connection.execute('UPDATE colosseum_runs SET score=?,wins=?,report_json=?,finished_at=? WHERE id=?',
            [score,wins,JSON.stringify(run.report),finishedAt,id]);
        if (wins > 0) {
            const [[best]] = await connection.execute('SELECT r.score,r.wins FROM colosseum_bests b JOIN colosseum_runs r ON r.id=b.run_id WHERE b.user_id=?', [userId]);
            if (!best || score > Number(best.score) || (score === Number(best.score) && wins > Number(best.wins)))
                await connection.execute('INSERT INTO colosseum_bests (user_id,run_id) VALUES (?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)', [userId,id]);
        }
        return { recorded: true };
    });
}
async function getFinishedRuns(ids) {
    const receipts = [], list = [...ids];
    for (let offset = 0; offset < list.length; offset += 100) {
        const batch = list.slice(offset,offset+100);
        const [rows] = await dbPool.execute(`SELECT id,finished_at,report_json FROM colosseum_runs WHERE id IN (${batch.map(()=>'?').join(',')}) AND finished_at IS NOT NULL`, batch);
        for (const row of rows) receipts.push({ id: row.id, winnerId: null, finishedAt: new Date(row.finished_at).getTime(), report: JSON.parse(row.report_json) });
    }
    return receipts;
}
async function leaderboard(userId) {
    const [rows] = await dbPool.execute(`SELECT ranked.*,u.username,r.report_json FROM (
        SELECT b.user_id,b.run_id,r.score,r.wins,r.finished_at,
          ROW_NUMBER() OVER (ORDER BY r.score DESC,r.wins DESC,r.finished_at ASC,r.id ASC) AS position
        FROM colosseum_bests b JOIN colosseum_runs r ON r.id=b.run_id
      ) ranked JOIN users u ON u.id=ranked.user_id JOIN colosseum_runs r ON r.id=ranked.run_id
      WHERE ranked.position<=50 OR ranked.user_id=? ORDER BY ranked.position`, [userId]);
    const entries = rows.map(row => ({ rank: Number(row.position), userId: Number(row.user_id), username: row.username,
        score: Number(row.score), wins: Number(row.wins), finishedAt: new Date(row.finished_at).getTime(),
        team: (JSON.parse(row.report_json).colosseum.lastTeam || []).map(p => ({ pokemonId:p.pokemonId,name:p.name,level:p.level,knockedOut:p.currentHp<=0 })) }));
    return { entries: entries.filter(row=>row.rank<=50), personal: entries.find(row=>row.userId===userId) || null };
}
module.exports = { recordRunStarted, recordRunFinished, getFinishedRuns, leaderboard };

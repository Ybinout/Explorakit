const { INITIAL_RATING, placements, calculateRatings } = require('../game/social/ranks');
const receipt = row => ({ userId: Number(row.user_id), place: Number(row.placement), before: Number(row.rating_before), after: Number(row.rating_after), delta: Number(row.delta) });
async function load(connection, runId) {
    const [rows] = await connection.execute('SELECT user_id,placement,rating_before,rating_after,delta FROM rift_rating_results WHERE run_id=? ORDER BY user_id', [runId]);
    return rows.map(receipt);
}
// Called within the same transaction as coins, outcomes and the run's finish.
async function settle(connection, run, entries) {
    const ids = entries.map(e => Number(e.user_id)).sort((a,b) => a-b);
    const places = placements(ids, run.report, run.winnerId);
    if (!places) return [];
    const players = [];
    for (const id of ids) {
        await connection.execute('INSERT IGNORE INTO rift_ratings(user_id,rating) VALUES (?,?)', [id,INITIAL_RATING]);
        const [[row]] = await connection.execute('SELECT rating FROM rift_ratings WHERE user_id=? FOR UPDATE', [id]);
        players.push({ userId: id, rating: Number(row.rating), place: places.find(p => p.userId === id).place });
    }
    const changes = calculateRatings(players);
    for (const p of changes) {
        await connection.execute('UPDATE rift_ratings SET rating=?,games=games+1 WHERE user_id=?', [p.after,p.userId]);
        await connection.execute('INSERT INTO rift_rating_results(run_id,user_id,placement,rating_before,rating_after,delta) VALUES (?,?,?,?,?,?)', [run.id,p.userId,p.place,p.before,p.after,p.delta]);
    }
    return changes;
}
module.exports = { load, settle };

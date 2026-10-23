const { dbPool, withTransaction } = require('../config/database');
const { INITIAL_RATING, riftRank, colosseumRank, eloThresholds, colosseumThresholds } = require('../game/social/ranks');
const cosmetics = require('../../data/game/cosmetics.json');
const { sanitizeSpriteName } = require('./playerRepository');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function id(value) {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) fail('Dresseur invalide.');
    return Number(value);
}
const select = `SELECT u.id,u.username,u.sprite,p.wins,p.losses,p.games_started,r.rating,r.games,a.title_key,a.frame_key
    FROM users u LEFT JOIN rift_profiles p ON p.user_id=u.id LEFT JOIN rift_ratings r ON r.user_id=u.id
    LEFT JOIN rift_appearance a ON a.user_id=u.id`;
function publicTrainer(row) {
    const rating = row.rating == null ? INITIAL_RATING : Number(row.rating), games = Number(row.games) || 0;
    return { id: Number(row.id), username: row.username, sprite: sanitizeSpriteName(row.sprite),
        title: cosmetics.find(c => c.key === row.title_key)?.name || null,
        frame: cosmetics.find(c => c.key === row.frame_key)?.color || null,
        rift: { wins: Number(row.wins) || 0, losses: Number(row.losses) || 0, gamesStarted: Number(row.games_started) || 0,
            rating, ratedGames: games, rank: riftRank(rating, games) } };
}
const relation = (row, viewer) => !row ? 'none' : row.status === 'accepted' ? 'friends' : Number(row.requested_by) === viewer ? 'outgoing' : 'incoming';
async function relationship(viewer, target, executor = dbPool) {
    if (viewer === target) return 'self';
    const [[row]] = await executor.execute('SELECT requested_by,status FROM trainer_friendships WHERE user_low=? AND user_high=?', [Math.min(viewer,target),Math.max(viewer,target)]);
    return relation(row, viewer);
}
async function profile(viewer, target) {
    viewer=id(viewer);target=id(target);
    const [[row]] = await dbPool.execute(select+' WHERE u.id=?', [target]);
    if (!row) fail('Dresseur introuvable.',404);
    const [records] = await dbPool.execute(`SELECT b.duration_minutes,r.score,r.wins,r.report_json FROM colosseum_bests b
        JOIN colosseum_runs r ON r.id=b.run_id WHERE b.user_id=? ORDER BY b.duration_minutes`, [target]);
    return { ...publicTrainer(row), relationship: await relationship(viewer,target),
        colosseum: [30,60].map(minutes => {
            const record = records.find(r => Number(r.duration_minutes) === minutes);
            const score = Number(record?.score) || 0, wins = Number(record?.wins) || 0;
            const team = record ? require('../game/drift/colosseum').recordTeam(JSON.parse(record.report_json)) : [];
            return { durationMinutes: minutes, score, wins, rank: colosseumRank(score,wins),
                defeat: record ? require('../game/drift/colosseum').recordDefeat(JSON.parse(record.report_json)) : null,
                team: team.slice(0,6).map(p => ({ pokemonId:p.pokemonId,name:p.name,level:p.level,knockedOut:p.currentHp<=0 })) };
        }) };
}
async function search(viewer, query, offset = 0) {
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length < 2 || q.length > 50) fail('Saisis entre 2 et 50 caractères.');
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) fail('Page invalide.');
    const pattern=q.replace(/[!%_]/g,c=>'!'+c)+'%';
    const [rows]=await dbPool.execute(select+` WHERE u.username LIKE ? ESCAPE '!' ORDER BY u.username,u.id LIMIT 21 OFFSET ${offset}`, [pattern]);
    return { entries: rows.slice(0,20).map(publicTrainer), hasMore: rows.length>20 && offset<1000 };
}
async function friends(viewer) {
    viewer=id(viewer);
    const [rows]=await dbPool.execute(select+` JOIN trainer_friendships f ON u.id=IF(f.user_low=?,f.user_high,f.user_low)
        WHERE f.user_low=? OR f.user_high=? ORDER BY f.status DESC,u.username,u.id LIMIT 250`, [viewer,viewer,viewer]);
    const [relations]=await dbPool.execute('SELECT user_low,user_high,requested_by,status FROM trainer_friendships WHERE user_low=? OR user_high=?', [viewer,viewer]);
    const entries=rows.map(row=>({ ...publicTrainer(row), relationship:relation(relations.find(r=>[Number(r.user_low),Number(r.user_high)].includes(Number(row.id))),viewer) }));
    return { accepted:entries.filter(p=>p.relationship==='friends'), incoming:entries.filter(p=>p.relationship==='incoming'), outgoing:entries.filter(p=>p.relationship==='outgoing') };
}
async function friendAction(viewer, target, action) {
    viewer=id(viewer);target=id(target);
    if (viewer===target) fail('Tu ne peux pas t’ajouter toi-même.');
    if (!['request','accept','decline','cancel','remove'].includes(action)) fail('Action inconnue.');
    const pair=[Math.min(viewer,target),Math.max(viewer,target)];
    await withTransaction(async c=>{
        // Serialize all operations on either account, including crossing requests.
        for(const userId of pair){const [[user]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)fail('Dresseur introuvable.',404);}
        const [[row]]=await c.execute('SELECT requested_by,status FROM trainer_friendships WHERE user_low=? AND user_high=? FOR UPDATE',pair);
        const state=relation(row,viewer);
        if(action==='request') {
            if(row)return;
            for(const userId of pair){
                const [[counts]]=await c.execute("SELECT COUNT(*) AS total,SUM(status='pending') AS pending FROM trainer_friendships WHERE user_low=? OR user_high=?",[userId,userId]);
                if(Number(counts.total)>=200 || Number(counts.pending)>=50)fail('La limite de contacts ou de demandes en attente est atteinte.',409);
            }
            await c.execute('INSERT INTO trainer_friendships(user_low,user_high,requested_by) VALUES (?,?,?)',[...pair,viewer]);
        } else if(action==='accept') {
            if(state==='friends')return;
            if(state!=='incoming')fail('Seul le destinataire peut accepter cette demande.',403);
            await c.execute("UPDATE trainer_friendships SET status='accepted' WHERE user_low=? AND user_high=?",pair);
        } else {
            if(!row)return;
            const expected={decline:'incoming',cancel:'outgoing',remove:'friends'}[action];
            if(state!==expected)fail('Cette action n’est pas autorisée pour cette demande.',403);
            await c.execute('DELETE FROM trainer_friendships WHERE user_low=? AND user_high=?',pair);
        }
    });
    return { relationship:await relationship(viewer,target) };
}
async function leaderboard(viewer) {
    viewer=id(viewer);
    const [rows]=await dbPool.execute(`SELECT ranked.position,u.id,u.username,u.sprite,p.wins,p.losses,p.games_started,r.rating,r.games,a.title_key,a.frame_key
      FROM (SELECT user_id,ROW_NUMBER() OVER (ORDER BY rating DESC,user_id ASC) AS position FROM rift_ratings WHERE games>0) ranked
      JOIN users u ON u.id=ranked.user_id JOIN rift_ratings r ON r.user_id=u.id LEFT JOIN rift_profiles p ON p.user_id=u.id
      LEFT JOIN rift_appearance a ON a.user_id=u.id WHERE ranked.position<=50 OR u.id=? ORDER BY ranked.position`,[viewer]);
    const entries=rows.map(row=>({...publicTrainer(row),position:Number(row.position)}));
    return { entries:entries.filter(p=>p.position<=50),personal:entries.find(p=>p.id===viewer)||null,
        rules:{initialRating:INITIAL_RATING,eloThresholds,colosseumThresholds} };
}
module.exports={profile,search,friends,friendAction,leaderboard,publicTrainer};

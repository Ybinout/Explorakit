const { createHash } = require('node:crypto');
const { dbPool, withTransaction } = require('../config/database');
const { calculateAccountReward } = require('../game/drift/accountReward');

function normalizeUserId(value) {
    const id = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Compte RiftMon invalide.');
    return id;
}

function normalizeRunId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
        throw new Error('Partie RiftMon invalide.');
    }
    return value;
}

function normalizeRoster(players) {
    const list = players instanceof Map ? [...players.values()] : players;
    if (!Array.isArray(list) || list.length < 2 || list.length > 16) {
        throw new Error('Une partie RiftMon requiert entre 2 et 16 comptes.');
    }
    const ids = list.map((player) => normalizeUserId(player?.userId ?? player?.id)).sort((a, b) => a - b);
    if (new Set(ids).size !== ids.length) throw new Error('Un compte ne peut participer deux fois à la même partie.');
    return ids;
}

// Transactions on distinct runs can touch the same profiles. Retry MySQL's
// deadlock victim; the unique run and entry keys make every replay harmless.
async function transact(work) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await withTransaction(work);
        } catch (error) {
            if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
}

async function getProfile(userId) {
    const [rows] = await dbPool.execute(
        `SELECT p.wins, p.losses, p.games_started, p.coins
         FROM users u LEFT JOIN rift_profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1`,
        [normalizeUserId(userId)]
    );
    if (!rows.length) {
        const error = new Error('Compte introuvable.');
        error.statusCode = 404;
        throw error;
    }
    return {
        wins: Number(rows[0].wins) || 0,
        losses: Number(rows[0].losses) || 0,
        gamesStarted: Number(rows[0].games_started) || 0,
        coins: Number(rows[0].coins) || 0
    };
}

async function recordRunStarted(run) {
    const id = normalizeRunId(run?.id);
    const userIds = normalizeRoster(run?.players);
    const rosterHash = createHash('sha256').update(JSON.stringify(userIds)).digest('hex');
    return transact(async (connection) => {
        const [insert] = await connection.execute(
            'INSERT IGNORE INTO rift_runs (id, roster_hash, participant_count) VALUES (?, ?, ?)',
            [id, rosterHash, userIds.length]
        );
        const [[stored]] = await connection.execute('SELECT roster_hash FROM rift_runs WHERE id = ? FOR UPDATE', [id]);
        if (stored.roster_hash !== rosterHash) throw new Error('La composition de cette partie RiftMon est déjà enregistrée.');
        if (!insert.affectedRows) return { recorded: false, players: userIds.length };
        for (const userId of userIds) {
            await connection.execute(
                `INSERT INTO rift_profiles (user_id, games_started) VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE games_started = games_started + 1`, [userId]
            );
            await connection.execute('INSERT INTO rift_run_entries (run_id, user_id) VALUES (?, ?)', [id, userId]);
        }
        return { recorded: true, players: userIds.length };
    });
}

async function recordRunFinished(run) {
    const id = normalizeRunId(run?.id);
    const winnerId = run?.winnerId == null ? null : normalizeUserId(run.winnerId);
    const finishedAt = run?.finishedAt == null ? new Date() : new Date(run.finishedAt);
    if (!Number.isFinite(finishedAt.getTime())) throw new Error('Date de fin RiftMon invalide.');
    return transact(async (connection) => {
        const [[stored]] = await connection.execute(
            `SELECT finished_at, winner_id, participant_count, reward_exploration_ms, reward_version
             FROM rift_runs WHERE id = ? FOR UPDATE`, [id]
        );
        if (!stored) throw new Error('Cette partie RiftMon n’a pas été enregistrée au lancement.');
        // Read the immutable launch ledger, not the live roster: an early
        // quitter still receives their defeat when the expedition ends.
        const [entries] = await connection.execute(
            'SELECT user_id, coins_earned FROM rift_run_entries WHERE run_id = ? ORDER BY user_id FOR UPDATE', [id]
        );
        if (run.report) await connection.execute(
            'INSERT IGNORE INTO rift_reports (run_id,report_json) VALUES (?,?)',[id,JSON.stringify(run.report)]);
        if (stored.finished_at) {
            const storedWinnerId = stored.winner_id == null ? null : Number(stored.winner_id);
            const winnerEntry = entries.find((entry) => Number(entry.user_id) === storedWinnerId);
            const result = {
                recorded: false,
                winnerId: storedWinnerId,
                coinsAwarded: winnerEntry ? Number(winnerEntry.coins_earned) : 0
            };
            // Replay the stored award, never today's policy or the supplied clock.
            // NULL metadata identifies old fixed awards and must stay untouched.
            if (Number(stored.reward_version) === 1 && stored.reward_exploration_ms != null) {
                result.reward = {
                    version: 1,
                    participantCount: Number(stored.participant_count),
                    explorationMs: Number(stored.reward_exploration_ms),
                    coinsPerPlayerMinute: 2.5,
                    coinsAwarded: result.coinsAwarded
                };
            }
            return result;
        }
        if (winnerId != null && !entries.some((entry) => Number(entry.user_id) === winnerId)) {
            throw new Error('Le vainqueur ne fait pas partie de cette expédition RiftMon.');
        }
        const reward = calculateAccountReward(Number(stored.participant_count), run.explorationMs, winnerId != null);
        for (const entry of entries) {
            const won = Number(entry.user_id) === winnerId;
            await connection.execute(
                'UPDATE rift_profiles SET wins = wins + ?, losses = losses + ?, coins = coins + ? WHERE user_id = ?',
                [won ? 1 : 0, won ? 0 : 1, won ? reward.coinsAwarded : 0, entry.user_id]
            );
            await connection.execute(
                'UPDATE rift_run_entries SET outcome = ?, coins_earned = ? WHERE run_id = ? AND user_id = ?',
                [won ? 'win' : 'loss', won ? reward.coinsAwarded : 0, id, entry.user_id]
            );
        }
        await connection.execute(
            `UPDATE rift_runs SET finished_at = ?, winner_id = ?, reward_exploration_ms = ?, reward_version = ?
             WHERE id = ?`, [finishedAt, winnerId, reward.explorationMs, reward.version, id]
        );
        return { recorded: true, winnerId, coinsAwarded: reward.coinsAwarded, reward };
    });
}

// The SQL settlement is authoritative even if a crash preceded the next checkpoint.
async function getFinishedRuns(runIds) {
    const receipts = [];
    const ids = [...runIds];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const [rows] = await dbPool.execute(
            `SELECT r.*, a.report_json, COALESCE(e.coins_earned, 0) AS coins_earned
             FROM rift_runs r
             LEFT JOIN rift_reports a ON a.run_id = r.id
             LEFT JOIN rift_run_entries e ON e.run_id = r.id AND e.user_id = r.winner_id
             WHERE r.id IN (${batch.map(() => '?').join(',')}) AND r.finished_at IS NOT NULL`, batch
        );
        for (const row of rows) {
            if (!row.report_json) throw new Error('Rapport final manquant pour une expédition sauvegardée.');
            receipts.push({ id: row.id, winnerId: row.winner_id == null ? null : Number(row.winner_id),
                finishedAt: new Date(row.finished_at).getTime(), report: JSON.parse(row.report_json),
                coinsAwarded: Number(row.coins_earned), reward: {
                    version: Number(row.reward_version), participantCount: Number(row.participant_count),
                    explorationMs: Number(row.reward_exploration_ms), coinsPerPlayerMinute: 2.5,
                    coinsAwarded: Number(row.coins_earned)
                } });
        }
    }
    return receipts;
}

module.exports = { getProfile, recordRunStarted, recordRunFinished, getFinishedRuns };

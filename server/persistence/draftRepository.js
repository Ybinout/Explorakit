const { dbPool, withTransaction } = require('../config/database');
const codec = require('../game/drift/checkpointCodec');
const config = require('../../data/game/draft_mode.json');
async function loadActive() {
    const [rows] = await dbPool.execute(
        "SELECT snapshot FROM draft_tables WHERE phase NOT IN ('finished','cancelled')"
    );
    return rows.map((r) => codec.decode(r.snapshot));
}
async function save(run, expected = 0) {
    return withTransaction(async (c) => {
        const humans = run.seats
            .filter((s) => s.userId)
            .sort((a, b) => a.userId - b.userId);
        for (const s of humans) {
            const [[owner]] = await c.execute(
                'SELECT id FROM users WHERE id=? FOR UPDATE',
                [s.userId]
            );
            if (!owner) throw Error('Un participant n’existe plus.');
        }
        const [[old]] = await c.execute(
            'SELECT version FROM draft_tables WHERE id=? FOR UPDATE',
            [run.id]
        );
        if (Number(old?.version || 0) !== expected)
            throw Error(
                'Cette draft a été actualisée ailleurs. Reconnecte-toi.'
            );
        if (!old)
            await c.execute(
                'INSERT INTO draft_tables(id,phase,version,snapshot) VALUES(?,?,0,?)',
                [run.id, run.phase, codec.encode({})]
            );
        const payments = [];
        if (run.phase === 'finished')
            for (const s of humans) {
                const [[paid]] = await c.execute(
                    'SELECT amount,placement FROM draft_rewards WHERE table_id=? AND user_id=?',
                    [run.id, s.userId]
                );
                const [[owner]] = await c.execute(
                    'SELECT money FROM users WHERE id=?',
                    [s.userId]
                );
                const wanted = s.forfeited
                    ? 0
                    : s.rank === 1
                    ? config.rewards.winner
                    : s.rank === 2
                    ? config.rewards.finalist
                    : 0;
                const amount = paid
                    ? Number(paid.amount)
                    : Math.max(
                          0,
                          Math.min(
                              wanted,
                              Number.MAX_SAFE_INTEGER - Number(owner.money)
                          )
                      );
                if (!paid) {
                    await c.execute(
                        'UPDATE users SET money=money+? WHERE id=?',
                        [amount, s.userId]
                    );
                    await c.execute(
                        'INSERT INTO draft_rewards(table_id,user_id,amount,placement) VALUES(?,?,?,?)',
                        [run.id, s.userId, amount, s.rank || 3]
                    );
                }
                s.reward = amount;
                payments.push({
                    userId: s.userId,
                    amount,
                    balance: Number(owner.money) + (paid ? 0 : amount),
                });
            }
        await c.execute('DELETE FROM draft_members WHERE table_id=?', [run.id]);
        if (!['finished', 'cancelled'].includes(run.phase))
            for (const s of humans.filter((s) => !s.left && !s.eliminated)) {
                const [[other]] = await c.execute(
                    'SELECT table_id FROM draft_members WHERE user_id=? FOR UPDATE',
                    [s.userId]
                );
                if (other && other.table_id !== run.id)
                    throw Object.assign(
                        Error('Tu participes déjà à une autre draft.'),
                        { statusCode: 409 }
                    );
                await c.execute(
                    'INSERT INTO draft_members(user_id,table_id) VALUES(?,?)',
                    [s.userId, run.id]
                );
            }
        const version = expected + 1;
        run.version = version;
        await c.execute(
            'UPDATE draft_tables SET phase=?,version=?,snapshot=? WHERE id=?',
            [run.phase, version, await codec.encodeAsync(run), run.id]
        );
        return { version, payments };
    });
}
module.exports = { loadActive, save };

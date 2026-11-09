const { randomUUID } = require('node:crypto'),
    { dbPool, withTransaction } = require('../config/database'),
    rules = require('../game/casino/slots'),
    { assertUnlocked } = require('../game/social/tradeLocks');
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
async function locked(c, id) {
    const [[user]] = await c.execute(
        'SELECT id,money FROM users WHERE id=? FOR UPDATE',
        [id]
    );
    if (!user) rules.fail('Dresseur introuvable.');
    await c.execute(
        'INSERT IGNORE INTO casino_slot_sessions(user_id,next_id) VALUES(?,?)',
        [id, randomUUID()]
    );
    const [[row]] = await c.execute(
        'SELECT * FROM casino_slot_sessions WHERE user_id=? FOR UPDATE',
        [id]
    );
    return { user, row };
}
async function read(id) {
    const [[row]] = await dbPool.execute(
        'SELECT * FROM casino_slot_sessions WHERE user_id=?',
        [id]
    );
    return row;
}
async function open(id, now = Date.now()) {
    return withTransaction(async (c) => {
        const { row, user } = await locked(c, id);
        return { ...rules.publicView(row, now), balance: Number(user.money) };
    });
}
async function start(id, data, now = Date.now(), rng) {
    require('../game/whitepeak/rules').uuid(data?.id);
    rules.machine(data.machine);
    rules.amount(data.amount);
    return withTransaction(async (c) => {
        const { row, user } = await locked(c, id);
        assertUnlocked(id);
        const old = parse(row.snapshot);
        if (old?.id === data.id) {
            if (old.machine !== data.machine || old.amount !== data.amount)
                rules.fail('Cette confirmation a déjà été utilisée.');
            return {
                ...rules.publicView(row, now),
                balance: Number(user.money),
                duplicate: true,
            };
        }
        if (row.settle_at !== null)
            rules.fail('Attends la fin du tirage en cours.');
        if (row.next_id !== data.id)
            rules.fail('Cette confirmation a expiré. Actualise la machine.');
        if (Number(user.money) < data.amount)
            rules.fail('Tu n’as pas assez de Pokédollars.');
        const result = rules.draw(rng),
            snapshot = {
                id: data.id,
                machine: data.machine,
                amount: data.amount,
                startedAt: now,
                resultAt: now + rules.config.durationMs,
                ...result,
            };
        await c.execute('UPDATE users SET money=money-? WHERE id=?', [
            data.amount,
            id,
        ]);
        await c.execute(
            'UPDATE casino_slot_sessions SET snapshot=?,settle_at=?,next_id=?,version=version+1 WHERE user_id=?',
            [JSON.stringify(snapshot), snapshot.resultAt, randomUUID(), id]
        );
        const state = {
            ...row,
            snapshot,
            settle_at: snapshot.resultAt,
            version: Number(row.version) + 1,
        };
        return {
            ...rules.publicView(state, now),
            balance: Number(user.money) - data.amount,
        };
    });
}
async function settle(id, now = Date.now()) {
    return withTransaction(async (c) => {
        const { row, user } = await locked(c, id);
        if (row.settle_at === null || Number(row.settle_at) > now)
            return {
                ...rules.publicView(row, now),
                balance: Number(user.money),
                settled: false,
            };
        const s = parse(row.snapshot),
            requested = rules.reward(s.amount, s.kind),
            payout = Math.min(
                requested,
                Math.max(0, Number.MAX_SAFE_INTEGER - Number(user.money))
            );
        s.payout = payout;
        await c.execute('UPDATE users SET money=money+? WHERE id=?', [
            payout,
            id,
        ]);
        await c.execute(
            'UPDATE casino_slot_sessions SET snapshot=?,settle_at=NULL,version=version+1 WHERE user_id=? AND settle_at IS NOT NULL',
            [JSON.stringify(s), id]
        );
        return {
            ...rules.publicView(
                {
                    ...row,
                    snapshot: s,
                    settle_at: null,
                    version: Number(row.version) + 1,
                },
                now
            ),
            balance: Number(user.money) + payout,
            settled: true,
        };
    });
}
async function pending() {
    const [rows] = await dbPool.execute(
        'SELECT user_id,settle_at FROM casino_slot_sessions WHERE settle_at IS NOT NULL'
    );
    return rows.map((r) => ({
        userId: Number(r.user_id),
        resultAt: Number(r.settle_at),
    }));
}
module.exports = { read, open, start, settle, pending };

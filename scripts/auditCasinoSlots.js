// Real slot generator and SQL debit/credit path. Disposable test account only.
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    { randomUUID } = require('node:crypto');
assert.equal(
    process.env.DB_NAME,
    'explorakit_test',
    'Only explorakit_test is authorized.'
);
const rules = require('../server/game/casino/slots'),
    repo = require('../server/persistence/casinoSlotsRepository'),
    users = require('../server/persistence/userRepository'),
    { dbPool: db } = require('../server/config/database');
(async () => {
    let user;
    try {
        user = await users.createUserWithStarter(
            'SlotAudit_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        const initial = 100000000,
            stake = 10000,
            spins = 1000,
            counts = Object.fromEntries(
                rules.config.results.map((r) => [r.kind, 0])
            );
        await db.execute('UPDATE users SET money=? WHERE id=?', [
            initial,
            user.id,
        ]);
        let state = await repo.open(user.id),
            paid = 0,
            now = Date.now();
        for (let i = 0; i < spins; i++) {
            const before = state.balance;
            state = await repo.start(
                user.id,
                { id: state.nextId, machine: (i % 2) + 1, amount: stake },
                now
            );
            assert.equal(state.balance, before - stake);
            assert.equal(state.spin.phase, 'spinning');
            state = await repo.settle(user.id, now + rules.config.durationMs);
            assert.equal(state.spin.phase, 'result');
            counts[state.spin.kind]++;
            const payout = rules.reward(stake, state.spin.kind);
            assert.equal(state.spin.payout, payout);
            assert.equal(state.balance, before - stake + payout);
            paid += payout;
            if (i % 20 === 0) {
                const repeated = await repo.settle(
                    user.id,
                    now + rules.config.durationMs + 1
                );
                assert.equal(repeated.balance, state.balance);
                assert.equal(repeated.settled, false);
            }
            now += rules.config.durationMs + 10;
        }
        const [[wallet]] = await db.execute(
            'SELECT money FROM users WHERE id=?',
            [user.id]
        );
        assert.equal(Number(wallet.money), initial - stake * spins + paid);
        assert.equal(
            rules.config.results.reduce((n, r) => n + r.weight, 0),
            1000000
        );
        const theoretical = rules.config.results.reduce(
            (n, r) => n + ((r.weight / 1000000) * r.numerator) / r.denominator,
            0
        );
        assert(Math.abs(theoretical - 0.9) < 1e-12);
        const report = {
            at: new Date().toISOString(),
            spins,
            stake,
            totalWagered: stake * spins,
            totalRedistributed: paid,
            observedRTP: paid / (stake * spins),
            theoreticalRTP: theoretical,
            creditAndDebitVerified: true,
            duplicatePayoutsPrevented: true,
            entropy:
                'Production crypto.randomInt, unseeded, through casinoSlotsRepository.start',
            results: rules.config.results.map((r) => ({
                kind: r.kind,
                label: r.label,
                count: counts[r.kind],
                observed: counts[r.kind] / spins,
                expected: r.weight / 1000000,
                expectedCount: r.weight / 1000,
                payoutMultiplier: r.numerator / r.denominator,
            })),
            note: 'Random finite sample: observed RTP and frequencies need not equal theoretical values. No probabilities changed.',
        };
        fs.writeFileSync(
            process.env.SLOTS_AUDIT_OUT ||
                '/tmp/housing-polish-slots-1000.json',
            JSON.stringify(report, null, 2) + '\n'
        );
        console.log(JSON.stringify(report));
    } finally {
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]);
        await db.end();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});

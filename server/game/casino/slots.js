const { randomInt } = require('node:crypto'),
    config = require('../../../data/game/casino_slots.json');
function fail(message) {
    throw Object.assign(Error(message), { statusCode: 409 });
}
function machine(id) {
    const m = config.machines.find((m) => m.id === id);
    if (!m) fail('Cette machine n’existe pas.');
    return m;
}
function near(p, id) {
    if (p?.currentmap !== config.map) return false;
    const m = machine(id),
        x = Math.floor(p.x / 32),
        y = Math.floor(p.y / 32);
    return (
        Math.max(m.x - x, 0, x - m.x - m.w + 1) +
            Math.max(m.y - y, 0, y - m.y - m.h + 1) ===
        1
    );
}
function at(p) {
    return config.machines.find((m) => near(p, m.id)) || null;
}
function blocked(map, x, y) {
    return (
        map === config.map &&
        config.machines.some(
            (m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h
        )
    );
}
function amount(n) {
    if (
        !Number.isSafeInteger(n) ||
        n < config.minimumBet ||
        n > config.maximumBet
    )
        fail('Choisis une mise entre 100 et 1 000 000 ₽.');
    return n;
}
function draw(rng = randomInt) {
    let roll = rng(1000000),
        result;
    if (!Number.isInteger(roll) || roll < 0 || roll >= 1000000)
        throw Error('Invalid slot entropy');
    for (const entry of config.results) {
        roll -= entry.weight;
        if (roll < 0) {
            result = entry;
            break;
        }
    }
    const symbols = [...config.symbols];
    function pick(list) {
        const i = rng(list.length);
        if (!Number.isInteger(i) || i < 0 || i >= list.length)
            throw Error('Invalid symbol entropy');
        return list[i];
    }
    function shuffle(values) {
        const a = [...values];
        for (let i = a.length - 1; i > 0; i--) {
            const j = rng(i + 1);
            if (!Number.isInteger(j) || j < 0 || j > i)
                throw Error('Invalid shuffle entropy');
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    const reels =
        result.kind === 'none'
            ? shuffle(symbols).slice(0, 3)
            : result.kind === 'pair'
            ? (() => {
                  const a = pick(symbols),
                      b = pick(symbols.filter((v) => v !== a));
                  return shuffle([a, a, b]);
              })()
            : [result.kind, result.kind, result.kind];
    return { kind: result.kind, symbols: reels };
}
function reward(n, kind) {
    const r = config.results.find((r) => r.kind === kind);
    if (!r) fail('Résultat inconnu.');
    return Math.floor((amount(n) * r.numerator) / r.denominator);
}
function publicView(row, now = Date.now()) {
    if (!row) return null;
    const s =
        typeof row.snapshot === 'string'
            ? JSON.parse(row.snapshot)
            : row.snapshot;
    return {
        nextId: row.settle_at === null ? row.next_id : null,
        serverNow: now,
        version: Number(row.version),
        minimumBet: config.minimumBet,
        maximumBet: config.maximumBet,
        spin: s
            ? {
                  id: s.id,
                  machine: s.machine,
                  amount: s.amount,
                  startedAt: s.startedAt,
                  resultAt: s.resultAt,
                  symbols: s.symbols,
                  phase: row.settle_at === null ? 'result' : 'spinning',
                  ...(row.settle_at === null
                      ? { kind: s.kind, symbols: s.symbols, payout: s.payout }
                      : {}),
              }
            : null,
    };
}
module.exports = {
    config,
    fail,
    machine,
    near,
    at,
    blocked,
    amount,
    draw,
    reward,
    publicView,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const latest = require('../data/game/latest_patch.json');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let db, server, base;
test.before(async () => {
    if (!enabled) return;
    if (process.env.DB_NAME !== 'explorakit_test') throw Error('Dedicated test database required');
    db = require('../server/config/database').dbPool;
    const app = require('express')();
    app.use(require('express').json());
    app.use('/api', require('../server/http/routes'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/patch-notes`;
});
test.after(async () => { if (server) await new Promise(r => server.close(r)); if (db) await db.end(); });
async function fixture(t) {
    const [row] = await db.execute('INSERT INTO users(username,password_hash) VALUES(?,?)', ['patch_' + randomUUID(), 'private-fixture']);
    const user = { id: row.insertId, username: 'Patch reader' };
    t.after(() => db.execute('DELETE FROM users WHERE id=?', [user.id]));
    return { ...user, token: require('../server/config/auth').signAccessToken(user) };
}
async function request(user, method = 'GET', body) {
    const response = await fetch(base + (method === 'POST' ? '/seen' : ''), {
        method, headers: { 'Content-Type':'application/json', ...(user ? { Authorization:'Bearer ' + user.token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status:response.status, cache:response.headers.get('cache-control'), data:await response.json() };
}
test('patch access and acknowledgement require a valid authenticated account', {skip:!enabled}, async () => {
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(null, 'POST', {version:latest.version})).status, 401);
    assert.equal((await request({token:'invalid'})).status, 401);
});
test('reading the latest patch never marks it seen, including repeated GETs', {skip:!enabled}, async t => {
    const user = await fixture(t);
    for (let i = 0; i < 2; i++) {
        const r = await request(user);
        assert.equal(r.status, 200); assert.equal(r.cache, 'no-store'); assert.deepEqual(r.data.patch, latest);
    }
    const [[r]] = await db.execute('SELECT COUNT(*) n FROM player_story_flags WHERE user_id=?', [user.id]);
    assert.equal(Number(r.n), 0);
});
test('acknowledgement persists across a new login token and stays private to the account', {skip:!enabled}, async t => {
    const a = await fixture(t), b = await fixture(t);
    // Supplying someone else's ID must never change the authenticated owner.
    assert.equal((await request(a, 'POST', {version:latest.version, userId:b.id})).status, 200);
    a.token = require('../server/config/auth').signAccessToken({...a,username:'Another device'});
    assert.equal((await request(a)).data.patch, null);
    assert.deepEqual((await request(b)).data.patch, latest);
});
test('old receipts do not hide the current patch and survive its acknowledgement', {skip:!enabled}, async t => {
    const user = await fixture(t);
    await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'patch_seen:old-patch','true')", [user.id]);
    assert.deepEqual((await request(user)).data.patch, latest);
    assert.equal((await request(user, 'POST', {version:latest.version})).status, 200);
    const [rows] = await db.execute("SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'patch_seen:%'", [user.id]);
    assert.equal(rows.length, 2);
});
test('unknown, missing, or stale patch versions cannot dismiss the latest announcement', {skip:!enabled}, async t => {
    const user = await fixture(t);
    for (const version of [undefined, 'future-patch', 'old-patch', {}, latest.version + "' OR 1=1"]) {
        assert.equal((await request(user, 'POST', {version})).status, 409);
    }
    assert.deepEqual((await request(user)).data.patch, latest);
});
test('concurrent dismissals are idempotent and touch no story progress', {skip:!enabled}, async t => {
    const user = await fixture(t);
    await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')", [user.id]);
    const results = await Promise.all(Array.from({length:6}, () => request(user, 'POST', {version:latest.version})));
    assert(results.every(r => r.status === 200 && r.cache === 'no-store'));
    const [flags] = await db.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?', [user.id]);
    assert.equal(flags.length, 2); assert.equal(flags.find(r => r.flag_key === 'hoze_defeated').flag_value, 'true');
    assert.equal((await request(user)).data.patch, null);
});
test('a failed database write leaves the patch unread and can be retried safely', {skip:!enabled}, async t => {
    const user = await fixture(t), execute = db.execute, log = console.error;
    try {
        db.execute = async function(sql, ...args) {
            if (sql.startsWith('INSERT IGNORE INTO player_story_flags')) throw Error('injected receipt failure');
            return execute.call(this, sql, ...args);
        };
        console.error = () => {};
        assert.equal((await request(user, 'POST', {version:latest.version})).status, 503);
    } finally { db.execute = execute; console.error = log; }
    assert.deepEqual((await request(user)).data.patch, latest);
    assert.equal((await request(user, 'POST', {version:latest.version})).status, 200);
    assert.equal((await request(user)).data.patch, null);
});

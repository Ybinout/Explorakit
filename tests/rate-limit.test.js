const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../server/http/rateLimit');
const { createSocketRateLimit } = require('../server/realtime/socketRateLimit');
test('HTTP limit is account-scoped and expires with a Retry-After', () => {
    let now = 1000,
        passed = 0,
        status,
        retry;
    const limit = rateLimit({ limit: 2, windowMs: 10000, now: () => now });
    const response = {
        status(value) {
            status = value;
            return this;
        },
        set(key, value) {
            retry = value;
        },
        send() {},
    };
    const attempt = (id) => limit({ user: { id } }, response, () => passed++);
    attempt(1);
    attempt(1);
    attempt(1);
    attempt(2);
    assert.equal(passed, 3);
    assert.equal(status, 429);
    assert.equal(retry, '10');
    now += 10001;
    attempt(1);
    assert.equal(passed, 4);
});
test('socket burst limit spans sockets for an account and recovers', () => {
    let time = 1000,
        accepted = 0,
        denied;
    const install = createSocketRateLimit({ limit: 2, now: () => time });
    const make = (id) => {
        const s = {
            data: { user: { id } },
            use(fn) {
                this.middleware = fn;
            },
        };
        install(s);
        return s;
    };
    const a = make(1),
        b = make(1),
        other = make(2);
    const send = (s) =>
        s.middleware(
            [
                'actionResponse',
                {},
                (value) => {
                    denied = value;
                },
            ],
            () => accepted++
        );
    send(a);
    send(b);
    send(a);
    send(other);
    assert.equal(accepted, 3);
    assert.equal(denied.code, 'rate_limit');
    time += 10001;
    send(b);
    assert.equal(accepted, 4);
});

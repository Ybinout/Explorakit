const test = require('node:test');
const assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/battleEntrance.js');
class ImageFixture extends EventTarget {
    constructor(src, complete = false) { super(); this.src = src; this.currentSrc = src; this.complete = complete; this.naturalWidth = complete ? 96 : 0; }
    decode() { return Promise.resolve(); }
    load() { this.complete = true; this.naturalWidth = 96; this.dispatchEvent(new Event('load')); }
}

test('battle entrance waits for both fetched images and decoding, including cached images', async () => {
    const { waitForBattleAssets } = await service();
    const image = new ImageFixture('sprite'), cached = new ImageFixture('background', true);
    let decoded, ready = false;
    cached.decode = () => new Promise(resolve => { decoded = resolve; });
    const pending = waitForBattleAssets(() => [image, cached]).then(() => { ready = true; });
    await Promise.resolve(); image.load(); await Promise.resolve();
    assert.equal(ready, false); decoded(); await pending; assert.equal(ready, true);
});

test('rotation selecting another picture must wait for the new source too', async () => {
    const { waitForBattleAssets } = await service();
    const old = new ImageFixture('portrait', true), next = new ImageFixture('landscape');
    let selected = old;
    old.decode = async () => { selected = next; };
    let ready = false;
    const pending = waitForBattleAssets(() => [selected]).then(() => { ready = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(ready, false); next.load(); await pending;
});

test('a pending replacement on the same picture cannot reveal its old decoded source', async () => {
    const { waitForBattleAssets } = await service();
    const image = new ImageFixture('portrait', true);
    let first = true, ready = false;
    image.decode = async () => {
        if (first) { first = false; image.complete = false; }
    };
    const pending = waitForBattleAssets(() => [image]).then(() => { ready = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(ready, false);
    image.currentSrc = 'landscape'; image.load(); await pending;
});

test('broken and rejected decodes settle, stuck downloads have a bounded wait', async () => {
    const { waitForBattleAssets } = await service();
    const broken = new ImageFixture('missing', true); broken.naturalWidth = 0;
    const rejected = new ImageFixture('undecodable', true); rejected.decode = () => Promise.reject(Error('decode failed'));
    assert.deepEqual(await waitForBattleAssets(() => [broken, rejected]), { timedOut: false, cancelled: false });
    const pending = new ImageFixture('stalled');
    assert.deepEqual(await waitForBattleAssets(() => [pending], { timeoutMs: 15 }), { timedOut: true, cancelled: false });
});

test('reset/disconnect releases loading and animation waits without stale listeners', async () => {
    const { waitForBattleAssets, entranceDelay } = await service();
    const abort = new AbortController(), image = new ImageFixture('pending');
    let adds = 0, removes = 0;
    const add = image.addEventListener.bind(image), remove = image.removeEventListener.bind(image);
    image.addEventListener = (...args) => { adds++; add(...args); };
    image.removeEventListener = (...args) => { removes++; remove(...args); };
    const pending = waitForBattleAssets(() => [image], { signal: abort.signal });
    const animation = entranceDelay(10000, abort.signal);
    abort.abort();
    assert.deepEqual(await pending, { timedOut: false, cancelled: true }); await animation;
    assert.equal(adds, removes); image.load();
    assert.deepEqual(await waitForBattleAssets(() => [image], { signal: abort.signal }), { timedOut: false, cancelled: true });
});

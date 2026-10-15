const test = require('node:test');
const assert = require('node:assert/strict');

test('touch movement: dead zone, four directions, reversal and diagonal stability', async () => {
    const { touchDirection: direction } = await import('../vue-explorakit/src/services/touchMovement.js');
    assert.equal(direction(6, -5), null);
    assert.equal(direction(0, -40), 'z'); assert.equal(direction(0, 40), 's');
    assert.equal(direction(-40, 0), 'q'); assert.equal(direction(40, 0), 'd');
    assert.equal(direction(40, 44, 'd'), 'd');
    assert.equal(direction(40, 55, 'd'), 's');
    assert.equal(direction(-40, 5, 'd'), 'q');
    assert.equal(direction(1, 2, 's'), null);
});

test('map loading: both layers decode before publication; absent foreground and failed requests are retryable', async () => {
    const { createMapSceneLoader } = await import('../vue-explorakit/src/services/mapScene.js');
    const images = [];
    const loader = createMapSceneLoader((map, front) => {
        if (map === 'inside' && front) throw Error('No foreground');
        return map + (front ? '-front' : '-base');
    }, () => { const image = { naturalWidth: 896, decode: async () => {} }; images.push(image); return image; });
    const pending = loader.load('outside'); let done = false;
    pending.then(() => { done = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(images.length, 2);
    await images[0].onload(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false, 'Foreground must also be ready');
    await images[1].onload(); const scene = await pending;
    assert.equal(scene.background.src, 'outside-base'); assert.equal(scene.foreground.src, 'outside-front');
    assert.equal(await loader.load('outside'), scene, 'A decoded map is reused');
    const failed = loader.load('inside'); const rejected = assert.rejects(failed, /indisponible/);
    await new Promise(resolve => setImmediate(resolve)); images[2].onerror(); await rejected;
    const retry = loader.load('inside'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(images.length, 4); await images[3].onload();
    assert.equal((await retry).foreground, null);
});

test('battle sounds: trusted unlock, distinct attacks, mute, suspended context and cleanup', async () => {
    const { BattleAudio } = await import('../vue-explorakit/src/services/battleAudio.js');
    const sources = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param() });
    const source = kind => { const n = { ...node(), kind, starts: 0, stops: 0, start() { this.starts++; }, stop() { this.stops++; } }; sources.push(n); return n; };
    const context = { state: 'suspended', currentTime: 0, sampleRate: 100,
        createGain: node, createOscillator: () => source('tone'), createBufferSource: () => source('noise'), createBiquadFilter: node,
        createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
        async resume() { this.state = 'running'; }, async close() { this.state = 'closed'; } };
    const audio = new BattleAudio(() => context); audio.setVolume(.35);
    audio.move(); assert.equal(sources.length, 0, 'Never queue attacks before a gesture');
    await audio.unlock(); audio.move({ damageClass: 'physical' });
    assert.deepEqual(sources.map(s => s.kind), ['noise', 'tone']);
    audio.move({ moveType: 'Water', damageClass: 'special' }); assert.equal(sources.length, 6);
    audio.move({ damageClass: 'status' }); assert.equal(sources.length, 9);
    audio.setVolume(0); assert(sources.every(s => s.stops === 2));
    audio.move(); assert.equal(sources.length, 9);
    audio.setVolume(.5); context.state = 'suspended'; audio.move(); assert.equal(sources.length, 9);
    await audio.unlock(); audio.move(); assert.equal(sources.length, 11);
    audio.dispose(); assert.equal(context.state, 'closed');
    await audio.unlock(); audio.move(); assert.equal(sources.length, 11);
});

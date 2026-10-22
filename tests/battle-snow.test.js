const test = require('node:test'), assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/battleSnow.js');
function surface() {
    const calls = [], c = {};
    for (const key of ['setTransform','clearRect','beginPath','arc','fill','moveTo','lineTo','stroke','ellipse']) c[key] = (...args) => {
        assert(args.every(v => typeof v !== 'number' || Number.isFinite(v)), key);
        calls.push([key, ...args]);
    };
    return { c, calls };
}
test('snow flakes have independent depths and bounded ground landings at every battle layout, even after long sessions', async () => {
    const { BattleSnowRenderer, snowParticleCount } = await service();
    for (const environment of ['grass','cave','colosseum','lake-gym']) for (const [width,height] of [[320,300],[393,590],[844,220],[1105,900]]) {
        const r = new BattleSnowRenderer(), { c, calls } = surface();
        let landings = 0;
        for (const t of [0,500,1200,3000,9000,30000,1e12]) {
            r.draw(c, t, { width, height, environment }); landings += r.stats.landings;
            assert.equal(r.stats.count, snowParticleCount(width,height));
            assert.equal(r.stats.flakes + r.stats.landings, r.stats.count);
            assert(r.stats.count <= 220);
        }
        assert(landings > 0);
        const flakes = calls.filter(call => call[0] === 'arc');
        assert(new Set(flakes.map(call => call[3].toFixed(2))).size > 20, 'Different depths, not identical discs');
        for (const arc of flakes) { assert(arc[3] <= 3.25); assert(arc[1] >= -6 && arc[1] <= width + 6); assert(arc[2] >= -8 && arc[2] <= height); }
        for (const ellipse of calls.filter(call => call[0] === 'ellipse')) {
            assert(ellipse[2] >= r.stats.groundTop && ellipse[2] < height);
            assert(ellipse[3] < 4.3 && ellipse[4] <= .45, 'Small flat marks on ground');
        }
        r.destroy();
    }
});
test('snow respects 30 Hz, resize, disabled motion, invalid sizes and destruction without repaint loops', async () => {
    const { BattleSnowRenderer } = await service(), r = new BattleSnowRenderer(), { c, calls } = surface();
    const options = { width: 393, height: 590, pixelRatio: 1.5 };
    for (const t of [0,1,16,32,34]) r.draw(c, t, options);
    assert.equal(r.frames, 2);
    r.draw(c, 35, { ...options, width: 844 }); assert.equal(r.frames, 3);
    r.draw(c, 40, { ...options, motion: false }); assert.equal(r.frames, 4); assert.equal(r.stats.landings, 0);
    const before = calls.length;
    for (const t of [80,150,1e9]) r.draw(c, t, { ...options, motion: false });
    assert.equal(calls.length, before);
    for (const [width,height] of [[0,10],[-1,20],[NaN,20],[20,Infinity]]) assert.equal(r.draw(c, 100, {width,height}), false);
    r.reset(); r.draw(c, 200, options); assert.equal(r.frames, 5);
    r.destroy(); assert.equal(r.particles.length, 0); assert.equal(r.draw(c, 300, options), false);
});

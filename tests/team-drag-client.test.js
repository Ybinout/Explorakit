const test = require('node:test'), assert = require('node:assert/strict');

async function fixture() {
    const { createTeamDrag } = await import('../vue-explorakit/src/services/teamDrag.js');
    const saved = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const frames = new Map(), listeners = new Set(); let serial = 0;
    function target() {
        const object = new EventTarget(), add = object.addEventListener.bind(object), remove = object.removeEventListener.bind(object);
        object.addEventListener = (name, fn, options) => { listeners.add(fn); add(name, fn, options); };
        object.removeEventListener = (name, fn) => { listeners.delete(fn); remove(name, fn); };
        return object;
    }
    const window = target(), document = target(), root = target(), changes = [], drops = [];
    const state = { allowed: true, roster: ['a', 'b', 'c'], target: 'b', ended: 0, captures: 0 };
    const list = { scrollTop: 0, getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 200 }) };
    Object.assign(root, { isConnected: true, contains: node => node.inside, querySelector: () => list,
        setPointerCapture: () => state.captures++, releasePointerCapture: () => state.captures-- });
    document.elementFromPoint = () => state.target ? { closest: () => ({ dataset: { teamUuid: state.target }, inside: state.target !== 'outside' }) } : null;
    document.hidden = false;
    Object.assign(globalThis, { window, document, requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id) });
    const drag = createTeamDrag({ root, roster: () => state.roster, allowed: () => state.allowed, changed: value => changes.push(value), drop: (...ids) => drops.push(ids), ended: () => state.ended++ });
    const pointer = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, isPrimary: true, clientX: 50, clientY: 50 }, props);
    const send = (type, props) => window.dispatchEvent(pointer(type, props));
    return { root, state, list, drag, changes, drops, frames, listeners, pointer, send, window, document,
        tick() { const current = [...frames]; frames.clear(); for (const [, fn] of current) fn(); },
        close() { drag.cancel(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
    };
}
test('team drag: a deliberate gesture drops UUIDs once, coalesces frames, and releases capture/listeners', async () => {
    const f = await fixture(); try {
        f.drag.start(f.pointer('pointerdown'), 'a');
        f.send('pointermove', { clientX: 100 }); f.send('pointermove', { clientX: 120 }); assert.equal(f.frames.size, 1);
        f.tick(); assert.equal(f.changes.at(-1).to, 'b'); assert.equal(f.changes.at(-1).x, 120);
        f.send('pointerup', { clientX: 120 }); f.send('pointerup', { clientX: 120 });
        assert.deepEqual(f.drops, [['a', 'b']]); assert.equal(f.state.ended, 1); assert.equal(f.state.captures, 0);
        assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.changes.at(-1), null);
    } finally { f.close(); }
});
test('team drag: click-sized motion, same slot and outside/empty drops never reorder', async () => {
    for (const kind of ['click', 'same', 'outside', 'empty']) {
        const f = await fixture(); try {
            f.drag.start(f.pointer('pointerdown'), 'a');
            if (kind !== 'click') f.send('pointermove', { clientX: 100 });
            f.state.target = kind === 'same' ? 'a' : kind === 'outside' ? 'outside' : kind === 'empty' ? null : 'b';
            f.send('pointerup', { clientX: kind === 'click' ? 53 : 100 });
            assert.deepEqual(f.drops, [], kind); assert.equal(f.listeners.size, 0);
        } finally { f.close(); }
    }
});
test('team drag: server roster changes, disconnect/battle restrictions and unmounted panels cancel safely', async () => {
    for (const change of [f => f.state.roster.reverse(), f => f.state.allowed = false, f => f.root.isConnected = false]) {
        const f = await fixture(); try {
            f.drag.start(f.pointer('pointerdown'), 'a'); f.send('pointermove', { clientX: 100 }); change(f);
            f.send('pointerup', { clientX: 100 }); assert.deepEqual(f.drops, []); assert.equal(f.listeners.size, 0);
        } finally { f.close(); }
    }
});
test('team drag: Escape, blur, lost capture, pointer cancel and hidden page release the gesture', async () => {
    for (const kind of ['escape', 'blur', 'capture', 'cancel', 'hidden']) {
        const f = await fixture(); try {
            f.drag.start(f.pointer('pointerdown'), 'a'); f.send('pointermove', { clientX: 100 });
            if (kind === 'escape') f.window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
            if (kind === 'blur') f.window.dispatchEvent(new Event('blur'));
            if (kind === 'capture') f.root.dispatchEvent(f.pointer('lostpointercapture'));
            if (kind === 'cancel') f.send('pointercancel');
            if (kind === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
            f.send('pointerup'); assert.deepEqual(f.drops, []); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0);
        } finally { f.close(); }
    }
});
test('team drag: unrelated pointers and invalid starts cannot steal the gesture; edge scrolling stops on release', async () => {
    const f = await fixture(); try {
        for (const props of [{ button: 2 }, { isPrimary: false }]) f.drag.start(f.pointer('pointerdown', props), 'a');
        f.state.allowed = false; f.drag.start(f.pointer('pointerdown'), 'a'); f.state.allowed = true;
        f.drag.start(f.pointer('pointerdown'), 'foreign'); assert.equal(f.listeners.size, 0);
        f.drag.start(f.pointer('pointerdown'), 'a'); f.send('pointerup', { pointerId: 2 });
        f.send('pointermove', { clientY: 195 }); f.tick(); assert.equal(f.list.scrollTop, 8); assert.equal(f.frames.size, 1);
        f.send('pointerup', { clientY: 195 }); assert.deepEqual(f.drops, [['a', 'b']]); assert.equal(f.frames.size, 0);
    } finally { f.close(); }
});

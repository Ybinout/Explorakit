const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto'),
    fs = require('node:fs'),
    vm = require('node:vm');
const rules = require('../server/game/housing/rules');
function client() {
    const ctx = {
        module: { exports: {} },
        berryRules:require('../data/game/berryMutation.json'),
        config: require('../vue-explorakit/src/data/housing.json'),
        metrics: require('../vue-explorakit/src/data/housingArt.json'),
        drawPokemonTerminal() {},
        require: () => '',
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('vue-explorakit/src/services/housingAppliances.js','utf8').replace(/export /g,''),ctx);
    let s = fs
        .readFileSync('vue-explorakit/src/services/housingArt.js', 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/export /g, '');
    vm.runInContext(
        s +
            '\nmodule.exports={furnitureSize,furnitureBounds,housingRenderPlan,housingModel,artItem};',
        ctx
    );
    const art = ctx.module.exports;
    const c = { module: { exports: {} }, ...art };
    vm.createContext(c);
    s = fs
        .readFileSync('vue-explorakit/src/services/housingPlacement.js', 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/export /g, '');
    vm.runInContext(s + '\nmodule.exports={layoutError,projected};', c);
    return { ...art, ...c.module.exports };
}
test('all 31 furniture types and four orientations validate and collide identically on server/client in all six rooms', () => {
    const ui = client();
    assert.deepEqual(
        require('../data/game/housing.json'),
        require('../vue-explorakit/src/data/housing.json')
    );
    assert.equal(rules.items.size, 31);
    for (const m of rules.models.values())
        for (const item of rules.items.values())
            for (const rotation of [0, 90, 180, 270]) {
                const placement = {
                    id: randomUUID(),
                    key: item.key,
                    x: m.x + 7,
                    y: m.y + 2,
                    rotation,
                };
                const floor = {
                        model: m.key,
                        placements: [placement],
                        stairs: { up: null, down: null },
                    },
                    h = { floors: [floor], inventory: { [item.key]: 1 } };
                // The widest objects need another valid point in the narrow Nid.
                if (placement.x + rules.dimensions(placement).w > m.x + m.w)
                    placement.x = m.x + 2;
                const saved = rules.validateFloor(h, 0, floor);
                assert.equal(saved.placements[0].rotation, rotation);
                assert.equal(ui.layoutError(floor), '');
                const d = rules.dimensions(placement);
                assert.deepEqual(
                    JSON.parse(JSON.stringify(ui.furnitureSize(placement))),
                    d
                );
                for (let y = placement.y - 1; y <= placement.y + d.h; y++)
                    for (let x = placement.x - 1; x <= placement.x + d.w; x++)
                        assert.equal(
                            rules.blocked(h, 0, x, y),
                            item.solid &&
                                x >= placement.x &&
                                x < placement.x + d.w &&
                                y >= placement.y &&
                                y < placement.y + d.h
                        );
            }
});
test('rotations reject forged angles, wall overlaps and invalid access; legacy placements retain orientation zero', () => {
    const p = { id: randomUUID(), key: 'bed', x: 9, y: 10 },
        f = { model: 'nid', placements: [p], stairs: { up: null, down: null } },
        h = { floors: [f], inventory: { bed: 1 } };
    for (const rotation of [-90, 360, 45, '90', null, {}, 1.5]) {
        if (rotation === null) continue;
        assert.throws(
            () =>
                rules.validateFloor(h, 0, {
                    ...f,
                    placements: [{ ...p, rotation }],
                }),
            /Orientation/
        );
    }
    assert.equal(rules.validateFloor(h, 0, f).placements[0].rotation, 0);
    assert.throws(
        () =>
            rules.validateFloor(h, 0, {
                ...f,
                placements: [{ ...p, x: 17, rotation: 90 }],
            }),
        /mur/
    );
    const d = {
        id: randomUUID(),
        key: 'healing_station',
        x: 12,
        y: 10,
        rotation: 90,
    };
    h.floors[0].placements = [d];
    assert.equal(
        rules.deviceAt(
            h,
            0,
            { currentmap: 'housing_nid', x: 11 * 32 + 16, y: 11 * 32 + 16 },
            'heal'
        ).id,
        d.id
    );
    assert.equal(
        rules.deviceAt(h, 0, {
            currentmap: 'centre',
            x: 11 * 32 + 16,
            y: 11 * 32 + 16,
        }),
        null
    );
    assert.equal(
        rules.deviceAt(
            h,
            0,
            { currentmap: 'housing_nid', x: 11 * 32 + 16, y: 11 * 32 + 16 },
            'pc'
        ),
        null
    );
});
test('rotating a draft placement preserves its ID and stock; back-wall overhang stays within room wall margin', () => {
    const ui = client(),
        p = { id: randomUUID(), key: 'bed', x: 10, y: 10, rotation: 0 },
        f = { model: 'nid', placements: [p], stairs: { up: null, down: null } };
    const next = ui.projected(
        f,
        { kind: 'furniture', ...p, rotation: 90 },
        10,
        10
    );
    assert.equal(next.placements.length, 1);
    assert.equal(next.placements[0].id, p.id);
    assert.equal(f.placements[0].rotation, 0);
    assert.equal(next.placements[0].rotation, 90);
    const plan = ui.housingRenderPlan(f),
        b = ui.furnitureBounds(plan.objects[0]);
    assert.equal(plan.objects[0].backWallLift, 16);
    assert.equal(b.bottom, (p.y + 3) * 32);
    assert(b.y >= rules.model('nid').y * 32 - 32);
    const metrics = require('../vue-explorakit/src/data/housingArt.json');
    assert.equal(metrics.orientations.length, 25);
    for (const views of metrics.orientations) {
        assert.equal(views.length, 4);
        for (const a of views)
            assert(a.w > 0 && a.h > 0 && a.w <= 64 && a.h <= 64);
    }
});
test('sale quote uses the recorded purchase price of the house and every floor, with legacy fallback', () => {
    const { saleQuote } = rules;
    assert.equal(
        saleQuote({
            entryKey: 'any',
            floors: [
                { model: 'nid', purchasePrice: 1234567 },
                { model: 'pavillon', purchasePrice: 2000000 },
            ],
        }),
        2587653
    );
    assert.equal(
        saleQuote({ entryKey: 'any', floors: [{ model: 'nid' }] }),
        800000
    );
    assert.equal(saleQuote({ entryKey: null, floors: [] }), 0);
});
test('own-house flight ignores forged coordinates, requires module and current ownership, and respects Dark Continent exit', async () => {
    const callbacks = {},
        p = { currentmap: 'start' },
        targets = [];
    let clock = 0,
        state = {
            unlocked: true,
            owned: true,
            visited: [],
            house: { map: 'route3', x: 144, y: 368 },
        };
    require('../server/realtime/handlers/flightHandlers').registerFlightHandlers(
        {
            socket: { connected: true, on: (n, h) => (callbacks[n] = h) },
            userId: 1,
            getPlayer: () => p,
            canUse: () => true,
            setBusy() {},
            loadState: async () => state,
            now: () => clock,
            travel: async (t) => targets.push(t),
        }
    );
    async function go() {
        let r;
        await callbacks.flyToHouse(
            { map: 'jungle9', x: -999, y: 999999 },
            (v) => (r = v)
        );
        return r;
    }
    assert((await go()).success);
    assert.deepEqual(targets, [{ map: 'route3', x: 144, y: 368 }]);
    clock = 4000;
    state.house = null;
    assert.equal((await go()).success, false);
    assert.equal(targets.length, 1);
    state.house = { map: 'ville1', x: 240, y: 112 };
    state.owned = false;
    assert.equal((await go()).success, false);
    state.owned = true;
    p.currentmap = 'jungle1';
    assert.equal((await go()).success, false);
    assert.equal(targets.length, 1);
});

test('legacy client omission preserves an already saved rotation and its collision footprint', () => {
    const p = { id: randomUUID(), key: 'bed', x: 10, y: 10, rotation: 90 },
        floor = {
            model: 'nid',
            placements: [p],
            stairs: { up: null, down: null },
        },
        h = { floors: [floor], inventory: { bed: 1 } };
    const legacy = { ...p, x: 11 };
    delete legacy.rotation;
    const saved = rules.validateFloor(h, 0, { ...floor, placements: [legacy] });
    assert.equal(saved.placements[0].rotation, 90);
    assert.equal(rules.dimensions(saved.placements[0]).w, 3);
});

test('Maria keeps her actual size when the build inlines the sprite as a data URL, before and after her battle', () => {
    const context = { atlas: {}, classic: {}, module: { exports: {} } };
    vm.createContext(context);
    const s = fs
        .readFileSync('vue-explorakit/src/services/npcFrames.js', 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/export /g, '');
    vm.runInContext(
        s + '\nmodule.exports={npcWorldSize,npcAppearance};',
        context
    );
    const api = context.module.exports;
    for (const name of ['town_lina', 'town_lina_after']) {
        const actor = api.npcAppearance({ name });
        assert.equal(
            api.npcWorldSize({ src: 'data:image/png;base64,inline' }, actor),
            64
        );
        assert.equal(actor.sprite, 'maria-blue-v1.png');
    }
    assert.equal(
        api.npcWorldSize(
            { src: 'data:image/png;base64,inline' },
            { name: 'other' }
        ),
        48
    );
});
test('a replayed purchase for a sold address cannot enter a different newly owned home', async () => {
    const entries = require('../server/game/housing/entries'),
        a = entries.entries[0],
        b = entries.entries[1];
    let travel = 0;
    const store = {
            purchase: async () => ({
                duplicate: true,
                home: { entryKey: b.key },
            }),
        },
        m = require('../server/realtime/housing').createHousingManager({
            store,
            tickMs: 0,
        });
    const p = { currentmap: a.map, x: a.x * 32 + 16, y: (a.y + 1) * 32 + 16 };
    await m.attach(
        {
            id: 1,
            supported: true,
            socket: { connected: true, emit() {} },
            getPlayer: () => p,
            canUse: () => true,
            travel: async () => travel++,
        },
        null
    );
    await assert.rejects(
        m.command(1, 'purchase', { entryKey: a.key }),
        /ancienne adresse/
    );
    assert.equal(travel, 0);
    assert.equal(p.inventoryBusy, undefined);
    m.stop();
});

test('left-stair access is protected consistently by the editor and server', () => {
    const ui = client();
    for (const m of rules.models.values()) {
        const base = {model:m.key, placements:[], stairs:{up:null,down:null}};
        const f = rules.fixedFloor(base,0,2), upper = rules.fixedFloor(base,1,2);
        const h = {floors:[f,upper],inventory:{chair:1}};
        assert.equal(ui.layoutError(f),'');
        for (const p of rules.stairAccess(f.stairs.up)) {
            const candidate={...f,placements:[{id:randomUUID(),key:'chair',...p}]};
            assert.match(ui.layoutError(candidate), /escalier/);
            assert.throws(()=>rules.validateFloor(h,0,candidate),/escalier/);
        }
        assert.throws(()=>rules.validateFloor(h,0,{...f,stairs:{...f.stairs,up:{x:m.x,y:m.y+2}}}),/fixes/);
    }
});

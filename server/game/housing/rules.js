const config = require('../../../data/game/housing.json');
const models = new Map(config.models.map((m) => [m.key, m])),
    items = new Map(config.furniture.map((i) => [i.key, i]));
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isMap = (m) =>
    typeof m === 'string' && m.startsWith('housing_') && models.has(m.slice(8));
const model = (k) => {
    const m = models.get(k);
    if (!m) throw Error('Choisis un intérieur disponible.');
    return m;
};
function inside(m, x, y) {
    const c = m.cutout;
    return (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= m.x &&
        x < m.x + m.w &&
        y >= m.y &&
        y < m.y + m.h &&
        !(c && x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h)
    );
}
const door = (m) => ({ x: m.x + Math.floor(m.w / 2), y: m.y + m.h });
const arrival = (m) => ({
    x: door(m).x * 32 + 16,
    y: (door(m).y - 1) * 32 + 16,
});
const rect = (p, w, h) =>
    Array.from({ length: w * h }, (_, i) => [
        p.x + (i % w),
        p.y + Math.floor(i / w),
    ]);
function dimensions(p) {
    const item = items.get(p?.key);
    const rotation = p?.rotation ?? 0;
    if (!item || ![0, 90, 180, 270].includes(rotation))
        throw Error('Orientation de meuble invalide.');
    return rotation % 180 ? { w: item.h, h: item.w } : { w: item.w, h: item.h };
}
function saleQuote(home) {
    if (!home?.entryKey || !home.floors.length) return 0;
    const paid = home.floors.reduce(
        (sum, floor) => sum + (floor.purchasePrice ?? model(floor.model).price),
        0
    );
    return Math.floor((paid * 80) / 100);
}
function deviceAt(home, index, player, kind) {
    const floor = home?.floors?.[index];
    if (!floor || player?.currentmap !== 'housing_' + floor.model) return null;
    const x = Math.floor(player.x / 32),
        y = Math.floor(player.y / 32);
    return (
        floor.placements.find((p) => {
            const item = items.get(p.key);
            if (!item?.device || (kind && item.device !== kind)) return false;
            const d = dimensions(p);
            return (
                Math.max(p.x - x, 0, x - p.x - d.w + 1) +
                    Math.max(p.y - y, 0, y - p.y - d.h + 1) ===
                1
            );
        }) || null
    );
}
function reserved(m, x, y) {
    const d = door(m);
    return y >= d.y - 2 && x >= d.x - 1 && x <= d.x;
}
function used(home) {
    const out = {};
    for (const f of home.floors)
        for (const p of f.placements) out[p.key] = (out[p.key] || 0) + 1;
    return out;
}
function validateFloor(home, index, floor) {
    if (!floor || !Number.isInteger(index) || index < 0 || !home.floors[index])
        throw Error('Étage invalide.');
    const m = model(floor.model);
    if (
        index < 0 ||
        index >= home.floors.length ||
        floor.model !== home.floors[index].model
    )
        throw Error('Étage invalide.');
    if (
        !Array.isArray(floor.placements) ||
        floor.placements.length > config.maxFurniture
    )
        throw Error('Dix meubles maximum par pièce.');
    const previous = new Map(
        home.floors[index].placements.map((p) => [p.id, p.rotation ?? 0])
    );
    // Old clients omit the field when moving furniture: do not erase its saved view.
    floor = {
        ...floor,
        placements: floor.placements.map((p) => ({
            ...p,
            rotation: p.rotation ?? previous.get(p.id) ?? 0,
        })),
    };
    const occupied = new Set(),
        solid = new Set(),
        ids = new Set(
            home.floors.flatMap((f, i) =>
                i === index ? [] : f.placements.map((p) => p.id)
            )
        ),
        targets = [];
    function claim(p, w, h, isSolid) {
        if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y))
            throw Error('Place les éléments sur la grille.');
        for (const [x, y] of rect(p, w, h)) {
            const k = x + ',' + y;
            if (!inside(m, x, y) || reserved(m, x, y) || occupied.has(k))
                throw Error(
                    'Cet emplacement empiète sur un mur, une porte ou un autre élément.'
                );
            occupied.add(k);
            if (isSolid) solid.add(k);
        }
    }
    for (const key of ['up', 'down']) {
        const required =
            key === 'up' ? index < home.floors.length - 1 : index > 0;
        const s = floor.stairs?.[key];
        if (Boolean(s) !== required)
            throw Error('Chaque étage doit rester relié par ses escaliers.');
        if (s) {
            claim(s, 2, 2, false, 'stair');
            const landing = { x: s.x, y: s.y + 2 };
            if (!inside(m, landing.x, landing.y))
                throw Error('Laisse une case libre au pied de l’escalier.');
            targets.push(landing);
        }
    }
    for (const p of floor.placements) {
        const item = items.get(p.key);
        if (!item || !UUID.test(p.id || '') || ids.has(p.id))
            throw Error('Meuble invalide ou dupliqué.');
        ids.add(p.id);
        const d = dimensions(p);
        claim(p, d.w, d.h, item.solid);
    }
    // Keep both stair landings free, even if a non-solid carpet would fit there.
    for (const p of targets)
        if (occupied.has(p.x + ',' + p.y))
            throw Error('Le pied de l’escalier doit rester dégagé.');
    const a = arrival(m),
        start = { x: Math.floor(a.x / 32), y: Math.floor(a.y / 32) },
        seen = new Set(),
        queue = [start];
    while (queue.length) {
        const p = queue.pop(),
            k = p.x + ',' + p.y;
        if (seen.has(k) || !inside(m, p.x, p.y) || solid.has(k)) continue;
        seen.add(k);
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ])
            queue.push({ x: p.x + dx, y: p.y + dy });
    }
    for (const p of targets)
        if (!seen.has(p.x + ',' + p.y))
            throw Error('Un escalier n’est plus accessible depuis l’entrée.');
    // No sealed pocket: every free cell remains reachable, including behind furniture.
    for (let y = m.y; y < m.y + m.h; y++)
        for (let x = m.x; x < m.x + m.w; x++)
            if (
                inside(m, x, y) &&
                !solid.has(x + ',' + y) &&
                !seen.has(x + ',' + y)
            )
                throw Error('Cet aménagement ferme un passage.');
    const candidate = {
            ...home,
            floors: home.floors.map((f, i) => (i === index ? floor : f)),
        },
        counts = used(candidate);
    for (const [key, n] of Object.entries(counts))
        if (n > (home.inventory[key] || 0))
            throw Error('Tu ne possèdes pas assez d’exemplaires de ce meuble.');
    return {
        model: floor.model,
        ...(Object.hasOwn(home.floors[index], 'purchasePrice')
            ? { purchasePrice: home.floors[index].purchasePrice }
            : {}),
        placements: floor.placements.map((p) => ({
            id: p.id,
            key: p.key,
            x: p.x,
            y: p.y,
            rotation: p.rotation ?? 0,
        })),
        stairs: {
            up: floor.stairs?.up
                ? { x: floor.stairs.up.x, y: floor.stairs.up.y }
                : null,
            down: floor.stairs?.down
                ? { x: floor.stairs.down.x, y: floor.stairs.down.y }
                : null,
        },
    };
}
function defaultStair(floor) {
    const m = model(floor.model);
    for (let y = m.y + 1; y < m.y + m.h - 3; y++)
        for (let x = m.x + 1; x < m.x + m.w - 2; x++) {
            const p = { x, y };
            if (
                rect(p, 2, 3).every(
                    ([xx, yy]) =>
                        inside(m, xx, yy) &&
                        !reserved(m, xx, yy) &&
                        !floor.placements.some((v) =>
                            rect(v, dimensions(v).w, dimensions(v).h).some(
                                ([a, b]) => a === xx && b === yy
                            )
                        ) &&
                        !Object.values(floor.stairs || {})
                            .filter(Boolean)
                            .some((s) =>
                                rect(s, 2, 3).some(
                                    ([a, b]) => a === xx && b === yy
                                )
                            )
                )
            )
                return p;
        }
    throw Error('Libère un emplacement pour l’escalier.');
}
function blocked(home, floor, x, y) {
    const f = home?.floors?.[floor];
    if (!f) return false;
    const m = model(f.model);
    if (floor > 0 && y === door(m).y) return true;
    return f.placements.some((p) => {
        const i = items.get(p.key);
        const d = dimensions(p);
        return (
            i.solid && x >= p.x && x < p.x + d.w && y >= p.y && y < p.y + d.h
        );
    });
}
module.exports = {
    config,
    items,
    models,
    model,
    UUID,
    isMap,
    inside,
    door,
    arrival,
    rect,
    dimensions,
    deviceAt,
    saleQuote,
    reserved,
    used,
    validateFloor,
    defaultStair,
    blocked,
};

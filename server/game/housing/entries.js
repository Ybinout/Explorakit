const entries = require('../../../data/game/housing_entries.json');
const byKey = new Map(entries.map((e) => [e.key, e]));
function get(key) {
    const e = byKey.get(key);
    if (!e) throw Error('Cette maison n’est pas proposée à la vente.');
    return e;
}
function near(p) {
    if (!p) return null;
    const x = Math.floor(p.x / 32),
        y = Math.floor(p.y / 32);
    return (
        entries.find(
            (e) =>
                e.map === p.currentmap &&
                Math.abs(e.x - x) + Math.abs(e.y - y) <= 1
        ) || null
    );
}
function outside(e) {
    return { map: e.map, x: e.x * 32 + 16, y: (e.y + 1) * 32 + 16 };
}
module.exports = { entries, get, near, outside };

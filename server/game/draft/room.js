const MAP = 'draft_house';
const tableCells = [];
for (let y = 7; y <= 12; y++)
    for (let x = 10; x <= 17; x++)
        if (((x - 13.5) / 4) ** 2 + ((y - 9.5) / 3) ** 2 <= 1)
            tableCells.push([x, y]);
for (const p of [
    [9, 9],
    [9, 10],
    [18, 9],
    [18, 10],
    [13, 6],
    [14, 6],
    [13, 13],
    [14, 13],
])
    tableCells.push(p);
function target(p) {
    if (p?.currentmap !== MAP) return null;
    const x = Math.floor(p.x / 32),
        y = Math.floor(p.y / 32);
    return tableCells.some(
        ([xx, yy]) => Math.abs(xx - x) + Math.abs(yy - y) <= 1
    )
        ? 'table'
        : null;
}
module.exports = { MAP, tableCells, target };

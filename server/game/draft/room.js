const MAP = 'draft_house';
const tableCells = [
    [13, 8],
    [14, 8],
    [12, 9],
    [13, 9],
    [14, 9],
    [15, 9],
    [12, 10],
    [13, 10],
    [14, 10],
    [15, 10],
    [13, 11],
    [14, 11],
    [11, 10],
    [16, 10],
    [13, 7],
    [14, 7],
    [13, 12],
    [14, 12],
];
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

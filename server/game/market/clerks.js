const terrain = require("../world/mapRepository");
const { getRegionMap } = require("../world/regionMap");
const cache = new Map();
function actor(map, base) {
  if (cache.has(map)) return cache.get(map);
  if (!getRegionMap().nodes.some((n) => n.id === map && n.kind === "town")) {
    cache.set(map, null);
    return null;
  }
  const grid = terrain.loadCollisionData(map),
    doors = terrain.changeMapData(map),
    grass = terrain.battleMapData(map),
    spots = [];
  const changed = [];
  doors.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v) changed.push({ x, y });
    })
  );
  // Some authored roofs contain empty collision cells in isolated islands.
  // Only use the outdoor walkable component reached from the normal landing.
  const landing = require("../world/flightTravel").flightDestination(map);
  if (!landing) throw Error("Aucune arrivée sûre pour " + map);
  const reachable = new Set(),
    queue = [[Math.floor(landing.x / 32), Math.floor(landing.y / 32)]];
  for (let at = 0; at < queue.length; at++) {
    const [x, y] = queue[at],
      key = x + "," + y;
    if (
      reachable.has(key) ||
      grid[y]?.[x] !== 0 ||
      doors[y]?.[x] ||
      base.isPnjBlockingTile(map, x, y)
    )
      continue;
    reachable.add(key);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      queue.push([x + dx, y + dy]);
  }
  for (let y = 3; y < grid.length - 2; y++)
    for (let x = 2; x < grid[y].length - 2; x++) {
      if (changed.some((d) => Math.abs(d.x - x) + Math.abs(d.y - y) < 4))
        continue;
      let clear = true;
      for (let dy = -2; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (
            !reachable.has(x + dx + "," + (y + dy)) ||
            grass[y + dy]?.[x + dx]
          )
            clear = false;
      if (clear)
        spots.push({
          x,
          y,
          score: changed.length
            ? Math.min(
                ...changed.map((d) => Math.abs(d.x - x) + Math.abs(d.y - y))
              )
            : x + y,
        });
    }
  spots.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  if (!spots.length)
    throw Error("Aucun emplacement dégagé pour le comptoir de " + map);
  const at = spots[0],
    result = {
      name: "market_clerk_" + map,
      interactionName: "market_clerk",
      map,
      x: at.x,
      y: at.y,
      sprite: "6931.png",
      spriteFrame: { columns: 8, rows: 4, index: 21 },
      block: true,
      roamRadius: 0,
    };
  cache.set(map, result);
  return result;
}
function nearby(p, base = require("../world/pnjStore")) {
  if (!p) return null;
  const a = actor(p.currentmap, base);
  return a &&
    Math.abs(Math.floor(p.x / 32) - a.x) +
      Math.min(
        Math.abs(Math.floor(p.y / 32) - a.y),
        Math.abs(Math.floor(p.y / 32) - a.y + 1)
      ) <=
      1
    ? a
    : null;
}
function scopedStore(base) {
  const own = (map, x, y) => {
    const a = actor(map, base);
    return a && a.x === x && (a.y === y || a.y - 1 === y) ? a : null;
  };
  return {
    getPnjsForMap: (map) => {
      const a = actor(map, base);
      return [...base.getPnjsForMap(map), ...(a ? [a] : [])];
    },
    getPnjAtTile: (map, x, y) => own(map, x, y) || base.getPnjAtTile(map, x, y),
    isPnjBlockingTile: (map, x, y) =>
      !!own(map, x, y) || base.isPnjBlockingTile(map, x, y),
  };
}
module.exports = { actor, nearby, scopedStore };

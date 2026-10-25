const { readMap, changeMapData } = require('./mapRepository');
const { isPnjBlockingTile } = require('./pnjStore');
const routes = require('../../../data/game/nextMap.json').maps;
const SIZE = 32, OFFSET = 16;
const DIRECTIONS = [[0,1],[1,0],[-1,0],[0,-1]];

// Only terrain connected to a real entrance is suitable for recovery. Empty
// collision cells behind roofs/cliffs are not necessarily playable terrain.
const recoveryCache = new WeakMap();
function recoveryTerrain(collision, mapName) {
    // Mutable synthetic grids retain the uncached path; live map grids are frozen.
    const cached = Object.isFrozen(collision) && recoveryCache.get(collision)?.get(mapName);
    if (cached) return cached;
    let data, changes = [];
    try { data = readMap(mapName); changes = changeMapData(mapName); } catch (_) { /* Synthetic test maps. */ }
    const floorLayers = (data?.layers || []).filter(l => l.type === 'tilelayer' && l.visible !== false
        && !['coll','battle','change','int','leaf','for2'].includes(l.name)
        && !/foreground/i.test(l.name));
    const painted = (x,y) => !floorLayers.length || floorLayers.some(l => l.data?.[y*l.width+x]);
    const open = (x,y) => collision[y]?.[x] === 0 && painted(x,y);
    const ids = new Map(), components = [];
    for (let y=0;y<collision.length;y++) for (let x=0;x<collision[y].length;x++) {
        if (!open(x,y) || ids.has(`${x},${y}`)) continue;
        const queue = [[x,y]], id = components.length;
        ids.set(`${x},${y}`,id);
        for (let i=0;i<queue.length;i++) for (const [dx,dy] of DIRECTIONS) {
            const nx=queue[i][0]+dx, ny=queue[i][1]+dy, key=`${nx},${ny}`;
            if (open(nx,ny) && !ids.has(key)) { ids.set(key,id); queue.push([nx,ny]); }
        }
        components.push(queue);
    }
    const anchors = routes.flatMap(r => r.mapchange.filter(c => c.goto === mapName
        && Number.isFinite(c.nexX) && Number.isFinite(c.nexY)).map(c => [Math.floor((c.nexX+16)/32),Math.floor((c.nexY-16)/32)]));
    if (mapName === 'start') anchors.push([2,6]);
    const allowed = new Set(anchors.map(([x,y]) => ids.get(`${x},${y}`)).filter(id => id !== undefined));
    if (!allowed.size && components.length) allowed.add(components.reduce((best,c,i) => c.length>components[best].length?i:best,0));
    const result = {data, changes, open, ids, components, allowed};
    if (Object.isFrozen(collision)) {
        if (!recoveryCache.has(collision)) recoveryCache.set(collision, new Map());
        recoveryCache.get(collision).set(mapName, result);
    }
    return result;
}

function nearestSafePosition(rawX, rawY, collision, mapName, {manual=false, allowTransition=true, blocked=isPnjBlockingTile}={}) {
    const terrain = recoveryTerrain(collision,mapName);
    const finite = v => v !== null && v !== '' && Number.isFinite(Number(v));
    const x = finite(rawX) ? Number(rawX) : 80, y = finite(rawY) ? Number(rawY) : 208;
    const tx = Math.round((x-OFFSET)/SIZE), ty = Math.round((y-OFFSET)/SIZE);
    const sourceId = terrain.ids.get(`${tx},${ty}`);
    const eligible = (cx,cy) => terrain.allowed.has(terrain.ids.get(`${cx},${cy}`))
        && !terrain.changes[cy]?.[cx] && !blocked(mapName,cx,cy);
    const occupied = (name,cx,cy) => (terrain.data?.layers || []).find(l=>l.name===name)?.data?.[cy*collision[0].length+cx];
    const neighbours = (cx,cy) => DIRECTIONS.some(([dx,dy]) => terrain.open(cx+dx,cy+dy) && !blocked(mapName,cx+dx,cy+dy));
    if (!manual && terrain.allowed.has(sourceId) && !blocked(mapName,tx,ty)
        && (allowTransition || !terrain.changes[ty]?.[tx]) && neighbours(tx,ty)) return {x:tx*SIZE+OFFSET,y:ty*SIZE+OFFSET};
    const candidates=[];
    for (const id of terrain.allowed) {
        // Manual recovery from a valid tile stays on the same connected area.
        if (manual && terrain.allowed.has(sourceId) && id!==sourceId) continue;
        for (const [cx,cy] of terrain.components[id]) {
            if (!eligible(cx,cy) || !neighbours(cx,cy)) continue;
            candidates.push({x:cx*SIZE+OFFSET,y:cy*SIZE+OFFSET,
                distance:(cx*SIZE+OFFSET-x)**2+(cy*SIZE+OFFSET-y)**2,
                quiet:!occupied('battle',cx,cy)&&!occupied('int',cx,cy)});
        }
    }
    // Do not move far away just to avoid grass: choose a quiet nearby tile only.
    const nearby = manual ? candidates.filter(p=>p.quiet && p.distance<= (3*SIZE)**2 && (p.x!==x||p.y!==y)) : [];
    const pool = nearby.length ? nearby : candidates;
    pool.sort((a,b)=>a.distance-b.distance || a.y-b.y || a.x-b.x);
    if (pool[0]) return {x:pool[0].x,y:pool[0].y};
    // Tiny synthetic maps can have a single walkable cell; never invent a point.
    for (const id of terrain.allowed) for (const [cx,cy] of terrain.components[id]) {
        if (eligible(cx,cy)) return {x:cx*SIZE+OFFSET,y:cy*SIZE+OFFSET};
    }
    throw new Error('Aucune case de retour accessible dans ce lieu.');
}
module.exports = { nearestSafePosition, recoveryTerrain };

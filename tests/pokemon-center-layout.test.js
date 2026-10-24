const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCollisionData, changeMapData, InteractMapData, getNextMap } = require('../server/game/world/mapRepository');
const { isPnjBlockingTile, getPnjsForMap } = require('../server/game/world/pnjStore');
const { maps } = require('../data/game/nextMap.json');
const { isNearComputer } = require('../server/game/world/pokemonComputer');
const { sanitizeSpawnPosition } = require('../server/realtime/playerState');

test('Center: all entrances, recovery, nurse and PC connect to the exit without crossing furniture or void', () => {
  const coll = loadCollisionData('centre'), change = changeMapData('centre');
  const queue = [[13, 14]], seen = new Set(['13,14']);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || coll[ny]?.[nx] !== 0 || isPnjBlockingTile('centre', nx, ny)) continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  for (const key of ['9,13', '10,9', '17,9', '13,15', '14,15']) assert(seen.has(key), key);
  const entries = maps.flatMap(m => m.mapchange.filter(c => c.goto === 'centre').map(c => getNextMap(m.mapName, c.valX, c.valY)));
  assert.equal(entries.length, 7);
  for (const e of entries) {
    assert.equal(e.nextMap, 'centre');
    const x = Math.floor(e.nextX / 32), y = Math.floor(e.nextY / 32);
    assert(seen.has(`${x},${y}`)); assert.equal(change[y][x], 0, 'spawn must be inside, before the exit trigger');
  }
  for (let y = 0; y < 20; y++) for (let x = 0; x < 28; x++) {
    if (x < 7 || x > 20 || y < 6 || y > 15) assert(coll[y][x], `void ${x},${y}`);
  }
  for (const [x, y] of [[8,8],[12,8],[17,8],[19,8],[7,12],[20,12],[10,7]]) assert(coll[y][x], `furniture ${x},${y}`);
  assert.equal(getPnjsForMap('centre').length, 1);
  const nurse = getPnjsForMap('centre')[0];
  assert.equal(nurse.interactionName, 'centre'); assert.equal(nurse.roamRadius, 0);
  assert.equal(require('../data/game/interact.json').find(i => i.name === 'centre').end, 'heal');
  assert.equal(InteractMapData('centre').flat().filter(Boolean).length, 1, 'no invisible old nurse triggers');
  assert(isNearComputer({currentmap:'centre', x:560, y:304}));
  for (const [x,y] of [[432,528],[16,16],[880,624]]) {
    const safe = sanitizeSpawnPosition(x,y,coll,'centre');
    assert(seen.has(`${Math.floor(safe.x/32)},${Math.floor(safe.y/32)}`), 'old outside saves recover inside');
  }
});

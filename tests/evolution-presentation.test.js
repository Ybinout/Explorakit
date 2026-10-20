const test = require('node:test'), assert = require('node:assert/strict');
const graph = require('../vue-explorakit/src/data/evolutionGraph.json');
const mon = (uuid, id) => ({ uuid, data: { id }, name: 'Compagnon' });
test('presentation graph covers exactly every authoritative permanent evolution, including stones', () => {
 const rules = [...require('../data/game/evolutions.json').rules, ...require('../data/game/stone_evolutions.json').rules];
 assert.deepEqual(graph.edges, [...new Set(rules.map(r => JSON.stringify([r.from,r.to])))].map(JSON.parse).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
 for (const edge of graph.edges) for (const id of edge) assert.equal(typeof graph.names[id], 'string');
});
test('active and reserve changes queue in team order, with all intermediate evolutions and no replay', async () => {
 const {createEvolutionTracker} = await import('../vue-explorakit/src/services/evolutionPresentation.js');
 const tracker = createEvolutionTracker(graph);
 assert.deepEqual(tracker.observe([mon('a',4),mon('b',1)]), []);
 const events = tracker.observe([mon('a',6),mon('b',2)]);
 assert.deepEqual(events.map(e=>[e.uuid,e.from,e.to]), [['a',4,5],['a',5,6],['b',1,2]]);
 assert.equal(events[1].toName, 'Dracaufeu');
 assert.deepEqual(tracker.observe([mon('a',6),mon('b',2)]), []);
 assert.deepEqual(tracker.observe([mon('b',1),mon('a',4)]), []);
 assert.deepEqual(tracker.observe([mon('a',6),mon('b',2)]), []);
});
test('SQL, stones and branching species are supported, not initial loads, captures or temporary forms', async () => {
 const {createEvolutionTracker} = await import('../vue-explorakit/src/services/evolutionPresentation.js');
 const tracker = createEvolutionTracker(graph);
 assert.deepEqual(tracker.observe([{uuid:'a',pokemon_id:25},mon('b',133)]), []);
 assert.deepEqual(tracker.observe([{uuid:'a',spriteId:26},mon('b',197)]).map(e=>e.to), [26,197]);
 assert.deepEqual(tracker.observe([mon('c',6),mon('b',196),mon('a',10026)]), []);
 assert.deepEqual(tracker.observe([mon('a',26)]), []);
 // A companion temporarily absent from the team keeps its baseline.
 tracker.observe([]);assert.deepEqual(tracker.observe([mon('c',6)]), []);
 assert.deepEqual(createEvolutionTracker(graph).observe([mon('a',26),mon('b',197)]), []);
});

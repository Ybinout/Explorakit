// Rebuild after changing authoritative species/stone evolution rules.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const rules = [...require('../data/game/evolutions.json').rules, ...require('../data/game/stone_evolutions.json').rules];
const edges = [...new Set(rules.map(r => JSON.stringify([r.from, r.to])))].map(JSON.parse).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
const ids = new Set(edges.flat());
const names = Object.fromEntries(require('../data/game/pokedex.json').filter(p => ids.has(p.id)).map(p => [p.id, p.name.french]));
fs.writeFileSync(path.join(root, 'vue-explorakit/src/data/evolutionGraph.json'), JSON.stringify({edges,names}, null, 2)+'\n');
console.log(`${edges.length} transitions permanentes pour la présentation.`);

// Regenerate links only from the delivered authored transition cells.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const edges=require('../server/game/world/darkContinentEdges'),dc=require('../server/game/world/darkContinent');
const file=path.join(root,'data/game/nextMap.json'),config=JSON.parse(fs.readFileSync(file)),read=name=>JSON.parse(fs.readFileSync(path.join(root,'data/maps',name+'.json')));
for(const map of config.maps.filter(m=>dc.isMap(m.mapName)))map.mapchange=edges.linksFor(map.mapName,read);
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');console.log(JSON.stringify({maps:9,links:config.maps.filter(m=>dc.isMap(m.mapName)).reduce((n,m)=>n+m.mapchange.length,0)}));

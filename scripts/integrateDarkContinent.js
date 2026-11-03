// Import creator artwork/collisions byte-for-byte; derive links only from authored objects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=path.join(root,'darkcontinen'),dc=require('../server/game/world/darkContinent');
const config=JSON.parse(fs.readFileSync(path.join(root,'data/game/nextMap.json'))),maps={};
for(let n=1;n<=9;n++){const name='jungle'+n;maps[name]=JSON.parse(fs.readFileSync(path.join(source,name+'.json')));fs.copyFileSync(path.join(source,name+'.json'),path.join(root,'data/maps',name+'.json'));for(const suffix of['','_f'])fs.copyFileSync(path.join(source,name+suffix+'.png'),path.join(root,'vue-explorakit/src/assets',name+suffix+'.png'));}
for(const[name,map]of Object.entries(maps)){
 const links=require('../server/game/world/darkContinentEdges').linksFor(name,n=>maps[n]);
 const column=dc.column(name),[min,max]=dc.levels(name);
 // Reimporting creator maps must not overwrite the current encounter balance.
 const existing=config.maps.find(m=>m.mapName===name);
 const next={mapName:name,canCapture:false,mapchange:links,wildpokemon:require('../server/game/world/darkHabitats').landPool(name),level:{min,max},actionLinks:name==='jungle1'?[dc.LOBBY.map]:[]};
 const i=config.maps.findIndex(m=>m.mapName===name);if(i<0)config.maps.push(next);else config.maps[i]=next;
}
const lobby=config.maps.find(m=>m.mapName===dc.LOBBY.map);lobby.actionLinks=[...new Set([...(lobby.actionLinks||[]),'jungle1'])];
fs.writeFileSync(path.join(root,'data/game/nextMap.json'),JSON.stringify(config,null,2)+'\n');
for(const[src,dst]of Object.entries({'sound.mp3':'dark-continent.mp3','battle.mp3':'dark-battle.mp3','casino.mp3':'casino.mp3','maison_des_combat.mp3':'battle-house.mp3','legendaire.mp3':'legendary-battle.mp3'}))fs.copyFileSync(path.join(source,src),path.join(root,'vue-explorakit/src/assets/msc',dst));
console.log(JSON.stringify({maps:9,links:config.maps.filter(m=>dc.isMap(m.mapName)).map(m=>[m.mapName,m.mapchange.length])}));

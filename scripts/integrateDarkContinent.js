// Import creator artwork/collisions byte-for-byte; derive links only from authored objects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=path.join(root,'darkcontinen'),dc=require('../server/game/world/darkContinent');
const config=JSON.parse(fs.readFileSync(path.join(root,'data/game/nextMap.json'))),maps={};
for(let n=1;n<=9;n++){const name='jungle'+n;maps[name]=JSON.parse(fs.readFileSync(path.join(source,name+'.json')));fs.copyFileSync(path.join(source,name+'.json'),path.join(root,'data/maps',name+'.json'));for(const suffix of['','_f'])fs.copyFileSync(path.join(source,name+suffix+'.png'),path.join(root,'vue-explorakit/src/assets',name+suffix+'.png'));}
const coll=m=>maps[m].layers.find(l=>l.name==='coll').data,change=m=>maps[m].layers.find(l=>l.name==='change').data;
const relocated=[];
for(const[name,map]of Object.entries(maps)){
 const links=[];
 for(const obj of map.layers.find(l=>l.name==='liaisons').objects){const p=Object.fromEntries((obj.properties||[]).map(p=>[p.name,p.value]));if(!p.destination)continue;const x=obj.x/16,y=obj.y/16;if(coll(name)[y*28+x]||!change(name)[y*28+x])continue;assert(maps[p.destination]);let tx=p.destination_x,ty=p.destination_y;
  // Land one cell inside: holding a direction cannot bounce back at a shared edge.
  if(tx===0)tx=1;else if(tx===27)tx=26;if(ty===0)ty=1;else if(ty===19)ty=18;
  if(coll(p.destination)[ty*28+tx]||change(p.destination)[ty*28+tx]){
   const queue=[{x:p.destination_x,y:p.destination_y}],seen=new Set();let found;
   for(const at of queue){const k=at.x+':'+at.y;if(seen.has(k)||at.x<0||at.y<0||at.x>=28||at.y>=20||coll(p.destination)[at.y*28+at.x])continue;seen.add(k);
    if(!change(p.destination)[at.y*28+at.x]){found=at;break;}
    if(seen.size<80)for(const[dx,dy]of[[0,-1],[1,0],[0,1],[-1,0]])queue.push({x:at.x+dx,y:at.y+dy});
   }
   assert(found,`No safe arrival ${name} ${x},${y} -> ${p.destination}`);relocated.push({from:name,x,y,to:p.destination,original:{tx,ty},landing:found});tx=found.x;ty=found.y;
  }
  if(links.some(l=>l.valX===x&&l.valY===y))continue;
  links.push({valX:x,valY:y,goto:p.destination,nexX:tx*32,nexY:ty*32+32});
 }
 const column=dc.column(name),[min,max]=dc.levels(name);
 const next={mapName:name,canCapture:false,mapchange:links,wildpokemon:dc.COLUMNS[column],level:{min,max},actionLinks:name==='jungle1'?[dc.LOBBY.map]:[]};
 const i=config.maps.findIndex(m=>m.mapName===name);if(i<0)config.maps.push(next);else config.maps[i]=next;
}
const lobby=config.maps.find(m=>m.mapName===dc.LOBBY.map);lobby.actionLinks=[...new Set([...(lobby.actionLinks||[]),'jungle1'])];
fs.writeFileSync(path.join(root,'data/game/nextMap.json'),JSON.stringify(config,null,2)+'\n');
for(const[src,dst]of Object.entries({'sound.mp3':'dark-continent.mp3','battle.mp3':'dark-battle.mp3','casino.mp3':'casino.mp3','maison_des_combat.mp3':'battle-house.mp3','legendaire.mp3':'legendary-battle.mp3'}))fs.copyFileSync(path.join(source,src),path.join(root,'vue-explorakit/src/assets/msc',dst));
console.log(JSON.stringify({maps:9,links:config.maps.filter(m=>dc.isMap(m.mapName)).map(m=>[m.mapName,m.mapchange.length]),relocatedBlockedCornerLandings:relocated}));

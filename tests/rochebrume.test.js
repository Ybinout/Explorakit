const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore');
function reachable(map,start){const c=maps.loadCollisionData(map),t=maps.changeMapData(map),seen=new Set(),q=[start];while(q.length){const [x,y]=q.shift(),k=`${x}:${y}`;if(seen.has(k)||c[y]?.[x]!==0||pnjs.isPnjBlockingTile(map,x,y))continue;seen.add(k);if(t[y]?.[x])continue;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
test('Routes 11/12 and Rochebrume preserve nine author files and every TMX layer',()=>{
 for(const [file,hash]of Object.entries(require('../docs/rochebrume-author-assets.json')))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 for(const name of ['route11','route12','ville4']){const m=require('../data/maps/'+name+'.json'),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8');assert.equal(m.layers.length,12);for(const l of m.layers){const csv=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,l.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),l.data);}}
});
test('all route lanes, city doors and inhabitants are reachable; arrivals are safe and non-portal',()=>{
 for(const [map,start]of [['route11',[26,16]],['route12',[26,6]],['ville4',[26,14]]]){const seen=reachable(map,start),t=maps.changeMapData(map);t.forEach((r,y)=>r.forEach((v,x)=>{if(v)assert(seen.has(`${x}:${y}`),`${map}: ${x}:${y}`);}));for(const p of pnjs.getPnjsForMap(map)){assert.equal(maps.loadCollisionData(map)[p.y][p.x],0);assert.equal(maps.loadCollisionData(map)[p.y-1][p.x],0);assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has(`${p.x+dx}:${p.y+dy}`)));}}
 for(const [map,x,y,target,xy]of [['ville3',0,16,'route11',[26,16]],['route11',27,16,'ville3',[1,16]],['route11',0,6,'route12',[26,6]],['route12',27,6,'route11',[1,6]],['route12',0,14,'ville4',[26,14]],['ville4',27,14,'route12',[1,14]],['ville4',4,8,'centre',[13,14]],['ville4',22,8,'ville4_shop',[13,16]],['ville4',14,11,'ville4_arene',[13,16]],['ville4',5,16,'ville4_maison1',[13,16]],['ville4',22,16,'ville4_maison2',[13,16]]]){const n=maps.getNextMap(map,x,y);assert.equal(n.nextMap,target);assert.deepEqual([Math.floor(n.nextX/32),Math.floor(n.nextY/32)],xy);assert.equal(maps.loadCollisionData(target)[xy[1]][xy[0]],0);assert.equal(maps.changeMapData(target)[xy[1]][xy[0]],0);assert(!pnjs.isPnjBlockingTile(target,...xy));if(target.startsWith('ville4_')){assert(reachable(target,xy).has('13:17'));const back=maps.getNextMap(target,13,17);assert.equal(back.nextMap,'ville4');assert.deepEqual([Math.floor(back.nextX/32),Math.floor(back.nextY/32)],[x,y+1]);}}
});
test('new Center has persistent origin and PC, shop is shared and mountain opens into the first new cave',()=>{
 const center=require('../server/game/world/pokemonCenterTravel'),origin={map:'ville4',x:144,y:304};assert.deepEqual(center.getPokemonCenterEntryReturn('ville4',4,8,origin),origin);assert.deepEqual(center.getPokemonCenterExit(origin),origin);assert(require('../server/game/world/shopCatalog').isShopMap('ville4_shop'));assert.equal(require('../server/game/world/pokemonComputer').devicesForMap('centre').devices[0].kind,'pc');assert.equal(maps.getNextMap('ville4',13,3).nextMap,'cave_rochebrume1');
});
test('updated Rochebrume gym uses its authored new door and returns onto the clear forecourt',()=>{
 const collision=maps.loadCollisionData('ville4'),changes=maps.changeMapData('ville4');
 assert(changes[11][14]);assert.equal(collision[11][14],0);
 assert.equal(changes[12][14],0);assert.equal(collision[12][14],0);
 assert.equal(maps.getNextMap('ville4',14,12),null);
 const back=maps.getNextMap('ville4_arene',13,17);
 assert.deepEqual([back.nextMap,Math.floor(back.nextX/32),Math.floor(back.nextY/32)],['ville4',14,12]);
 assert(reachable('ville4',[14,12]).has('26:14'));
 assert.equal(collision[10][14],21001,'the author’s new building wall must remain solid');
});
test('Ana then Wanda extend the existing story without repeating old rewards or enabling the archives',()=>{
 const {getSentenceForName}=require('../server/game/world/interactionRepository'),{deriveStoryQuest,hasCompletedBattle}=require('../server/game/world/storyProgression'),catalog=require('../data/game/progression.json');
 assert.equal(pnjs.getPnjsForMap('ville3_arene').filter(p=>p.name==='ana').length,1);assert.equal(pnjs.getPnjsForMap('ville4_arene').filter(p=>p.name==='wanda').length,1);assert(!pnjs.getPnjsForMap('gen_arene3').some(p=>p.name==='ana'));assert(!pnjs.getPnjsForMap('gen_arene2').some(p=>p.name==='wanda'));
 const s={flags:{hoze_defeated:'true',raphael_defeated:'true'},completedNpcBattles:[]};assert.equal(deriveStoryQuest(s).progress,5);assert.equal(deriveStoryQuest(s).map,'ville3_arene');assert.equal(getSentenceForName('champion_ana',s)[1],'champion_ana');assert.equal(getSentenceForName('champion_wanda',s)[1],'champion_wanda_locked');
 s.flags.ana_defeated='true';assert.equal(deriveStoryQuest(s).map,'ville4_arene');assert.equal(getSentenceForName('champion_wanda',s)[1],'champion_wanda');s.flags.wanda_defeated='true';assert.equal(deriveStoryQuest(s).progress,7);assert.equal(deriveStoryQuest(s).status,'active');assert.equal(deriveStoryQuest(s).map,'ville5_arene');assert.equal(getSentenceForName('clara_letter',s)[1],'clara_letter_locked');
 for(const [name,money]of [['champion_ana',3000],['champion_wanda',3600]]){assert.equal(catalog.npcBattles[name].battleKey,'story_'+name);assert.equal(catalog.npcBattles[name].reward.money,money);s.completedNpcBattles.push({battleKey:catalog.npcBattles[name].battleKey});assert(hasCompletedBattle(catalog.npcBattles[name],s));assert.equal(getSentenceForName(name,s)[1],name+'_after');}
 assert.equal(catalog.storyEvents.clara_letter.enabled,false);assert.equal(catalog.quests.find(q=>q.key==='clara_chapter2').enabled,false);
});

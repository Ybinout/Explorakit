const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore'),shops=require('../server/game/world/shopCatalog'),items=require('../data/game/items.json').items;
const floors=['tour_rdc','tour_etage1','tour_etage2','tour_etage3'],names=['ville_commerciale',...floors];
test('every staircase has a straight clear approach down to the cross aisle',()=>{
 floors.forEach((name,i)=>{
  const c=maps.loadCollisionData(name),changes=maps.changeMapData(name);
  for(const x of [...(i>0?[3]:[]),...(i<3?[24]:[])]){
   assert(changes[4][x]);
   for(let y=5;y<=10;y++){
    assert.equal(c[y][x],0,`${name}: clear staircase approach ${x},${y}`);
    assert(!changes[y][x]);assert(!pnjs.isPnjBlockingTile(name,x,y));
   }
  }
 });
});
function reachable(name,start){const c=maps.loadCollisionData(name),t=maps.changeMapData(name),seen=new Set(),q=[start];while(q.length){const[x,y]=q.shift(),k=x+':'+y;if(seen.has(k)||c[y]?.[x]!==0||pnjs.isPnjBlockingTile(name,x,y))continue;seen.add(k);if(t[y]?.[x])continue;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
test('old tower saves recover onto connected aisles and artwork stays aligned with the map grid',()=>{
 const {sanitizeSpawnPosition}=require('../server/realtime/playerState');
 for(const name of floors){
  const c=maps.loadCollisionData(name),seen=reachable(name,name==='tour_rdc'?[13,16]:[3,5]);
  for(const [x,y] of [[9,7],[13,18],[13,19],[0,0],[27,19]]){
   const safe=sanitizeSpawnPosition(x*32+16,y*32+16,c,name);
   const tx=Math.floor(safe.x/32),ty=Math.floor(safe.y/32);
   assert(seen.has(`${tx}:${ty}`),`${name} old position ${x},${y} recovers into reachable space`);
   assert(!maps.changeMapData(name)[ty]?.[tx]);
   assert(!pnjs.isPnjBlockingTile(name,tx,ty));
  }
  const map=require('../data/maps/'+name+'.json');
  const art=map.layers.find(l=>l.type==='imagelayer');assert(art);
  const png=fs.readFileSync(path.resolve(__dirname,'../data/maps',art.image));
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[map.width*16,map.height*16]);
  assert.equal(pnjs.getPnjsForMap(name)[0].x,11);assert.equal(pnjs.getPnjsForMap(name)[0].y,8);
 }
});
test('commercial city stays unchanged and redesigned floors retain mirrored layers and reachable stairs',()=>{
 const manifest=require('../docs/commercial-author-assets.json');assert.equal(Object.keys(manifest).length,15);
 for(const[file,hash]of Object.entries(manifest).filter(([file])=>file.includes("ville_commerciale")))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 for(const name of names){const m=require('../data/maps/'+name+'.json'),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8'),start=name==='ville_commerciale'?[26,17]:name==='tour_rdc'?[13,16]:[3,5],seen=reachable(name,start),changes=maps.changeMapData(name);assert.equal(m.width,28);assert.equal(m.height,20);
  for(const l of m.layers){if(l.type==='tilelayer'){const csv=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,l.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),l.data);}else if(l.type==='objectgroup')for(const o of l.objects){const p=Object.fromEntries(o.properties.map(p=>[p.name,p.value])),link=maps.getNextMap(name,o.x/16,o.y/16);assert.equal(link.nextMap,p.destination);assert.deepEqual([link.nextX,link.nextY],[p.destination_x*32+16,p.destination_y*32+16]);assert(xml.includes(`name="${o.name}"`));}}
  changes.forEach((row,y)=>row.forEach((v,x)=>{if(!v)return;assert(seen.has(x+':'+y),name+' unreachable door '+x+','+y);const link=maps.getNextMap(name,x,y);assert(link);assert(!link.blockedMessage);const tx=Math.floor(link.nextX/32),ty=Math.floor(link.nextY/32);assert.equal(maps.loadCollisionData(link.nextMap)[ty]?.[tx],0);assert(!maps.changeMapData(link.nextMap)[ty]?.[tx]);assert(!pnjs.isPnjBlockingTile(link.nextMap,tx,ty));}));
  assert(!maps.battleMapData(name).flat().some(Boolean));
 }
 for(const y of[16,17,18]){assert.equal(maps.getNextMap('route6',0,y).nextMap,'ville_commerciale');assert.equal(maps.getNextMap('ville_commerciale',27,y).nextMap,'route6');}
 assert.equal(maps.getNextMap('ville_commerciale',4,8).nextMap,'centre');
});
test('each saleswoman is reachable, opens her own department, and every floor has an unambiguous village label and music',async()=>{
 const {getSentenceForName,getEndSentenceInformation}=require('../server/game/world/interactionRepository'),{worldMusicTrack}=await import('../vue-explorakit/src/services/worldMusic.js'),{getMapLocationLabel}=await import('../vue-explorakit/src/services/mapLocations.js');
 for(const[name,index]of floors.map((n,i)=>[n,i])){const sellers=pnjs.getPnjsForMap(name);assert.equal(sellers.length,1);const seller=sellers[0];assert(reachable(name,name==='tour_rdc'?[13,16]:[3,5]).has('11:9'));assert.equal(seller.interactionName,'commercial_keeper_'+(index+1));assert(getSentenceForName(seller.interactionName));assert.equal(getEndSentenceInformation(seller.interactionName),'shop');assert.match(getMapLocationLabel(name),new RegExp(String(index+1)));assert.equal(worldMusicTrack(name),'village');assert.equal(shops.getShopMeta({mapName:name}).department,index+1);}
 assert.equal(worldMusicTrack('ville_commerciale'),'village');
});
test('four server-authoritative departments provide distinct legal stock without unlocking other shops or special keys',()=>{
 const stock=floors.map(mapName=>shops.getShopCatalog({mapName}));assert.deepEqual(stock.map(s=>s.length),[28,283,11,39]);
 for(let i=0;i<stock.length;i++)for(const item of stock[i]){assert(Number.isSafeInteger(item.price)&&item.price>0);assert(items.some(i=>i.key===item.key));for(let j=0;j<stock.length;j++)if(j!==i)assert(!stock[j].some(i=>i.key===item.key));}
 for(const key of['pokeball','hyperball','repel','super_repel','max_repel','thunder_stone'])assert(stock[0].some(i=>i.key===key));
 assert.equal(stock[1].filter(i=>i.fieldUse?.ivReroll).length,6);assert.equal(stock[1].filter(i=>i.fieldUse?.effortReset).length,7);assert.equal(stock[1].filter(i=>i.fieldUse?.effort?.amount>0).length,6);
 for(const expedition of [false,true])for(const mapName of shops.SHOP_MAPS)for(const item of shops.getShopCatalog({mapName,expedition,flags:{wanda_defeated:'true'}}).filter(i=>i.category==='held'&&!i.key.endsWith('_berry')))assert(item.price>=10000,`${mapName} ${item.key}`);
 for(const key of['leftovers','life_orb','choice_specs','choice_scarf','choice_band'])assert(stock[2].some(i=>i.key===key));assert(stock[3].every(i=>i.key.endsWith('_berry')));
 for(const key of['leftovers','choice_scarf','liechi_berry','zinc'])assert(!shops.getShopCatalog({mapName:'ville1_shop',flags:{wanda_defeated:'true'}}).some(i=>i.key===key));
 for(const list of stock)assert(!list.some(i=>['exp_share','route2_house_key','rift_talisman'].includes(i.key)));
 for(const name of['ville_commerciale','__proto__','tour_etage4']){assert(!shops.isShopMap(name));assert.deepEqual(shops.getShopCatalog({mapName:name}),[]);}
});
for(const mode of['rift','colosseum'])test(mode+': departments enforce stock, charge purchases once, survive checkpoints and keep expedition inventory separate',()=>{
 const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');const p={alive:true,currentmap:'tour_etage2',money:20000,run:{mode,phase:'exploration'},equipe:{pokemons:[]},items:{},drifts:[],equipped:[]};
 assert.equal(economy.shop(p).merchant,null);assert(!economy.shop(p).catalog.some(i=>i.key==='drift_potion'));assert.throws(()=>economy.buy(p,'iv_randomizer_attack',1),/invalide/);const money=p.money;economy.buy(p,'choice_scarf',1);assert.equal(p.money,money-10000);assert.equal(p.items.choice_scarf,1);
 p.currentmap='tour_etage1';economy.buy(p,'iv_randomizer_attack',2);p.currentmap='tour_etage3';economy.buy(p,'leppa_berry',5);const copy=codec.decode(codec.encode(p));assert.equal(copy.items.leppa_berry,5);assert.equal(copy.items.iv_randomizer_attack,2);assert.equal(copy.items.choice_scarf,1);assert(!economy.shop(copy).catalog.some(i=>i.key==='revive'));p.inbattle=true;assert.throws(()=>economy.buy(p,'leppa_berry',1),/indisponible/);
});
for(const mode of['rift','colosseum'])test(mode+': new city and stairs move in both directions and Center returns to its actual town',async()=>{
 const{createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');let now=1000;const store=createLobbyStore({now:()=>now}),runtime=createRunManager({starterChoiceMs:0,store,namespace:{to:()=>({emit(){}})},now:()=>now,random:()=>.99}),host={id:1,username:'store'},guest={id:2,username:'peer'};store.connect(host,'host');if(mode==='rift'){store.connect(guest,'guest');const{code}=store.create(host,{capacity:2,durationMinutes:30});store.join(guest,code);store.ready(host,true);store.ready(guest,true);await runtime.start(host);}else await runtime.startColosseum(host,{durationMinutes:30});runtime.enter(host,{id:'host'});const p=runtime.playerFor(host);
 function move(action,target,tx,ty){now+=200;runtime.move(p,action);assert.equal(p.currentmap,target);assert.deepEqual([p.x,p.y],[tx*32+16,ty*32+16]);}
 function from(map,x,y,action,target,tx,ty){require('../server/game/world/stairways').clear(p);Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,repelSteps:250});move(action,target,tx,ty);}
 from('route6',1,17,'move_q','ville_commerciale',26,17);from('ville_commerciale',26,17,'move_d','route6',1,17);from('ville_commerciale',13,12,'move_z','tour_rdc',13,16);
 for(let i=0;i<3;i++){
  from(floors[i],24,5,'move_z',floors[i],24,4);move('move_z',floors[i+1],3,5);
  for(let n=0;n<7;n++)move('move_z',floors[i+1],3,4);
  move('move_s',floors[i+1],3,5);move('move_z',floors[i+1],3,4);move('move_z',floors[i],24,5);
  for(let n=0;n<7;n++)move('move_z',floors[i],24,4);
  move('move_s',floors[i],24,5);
 }
 from('tour_rdc',13,16,'move_s','ville_commerciale',13,12);from('ville_commerciale',4,9,'move_z','centre',13,14);from('centre',13,14,'move_s','ville_commerciale',4,9);
});

test('Adventure department stock stays visible, fully unlocks after Hoze while ordinary shops retain their progression',()=>{
 const {tiers,offers}=require('../data/game/shop_offers.json');
 for(const mapName of floors){
  const initial=shops.getShopCatalog({mapName});
  for(let tier=0;tier<tiers.length;tier++){
   const flags=tier?{[tiers[tier].flag]:'true'}:{};
   const stock=shops.getShopCatalog({mapName,flags});
   assert.deepEqual(stock.map(i=>i.key),initial.map(i=>i.key));
   assert.equal(shops.getShopMeta({mapName,flags}).tier,tier);
   for(const item of stock){
    assert(Number.isInteger(item.requiredTier)&&item.requiredTier>=0&&item.requiredTier<tiers.length,item.key);
    assert.equal(item.locked,item.requiredTier>tier,item.key);
    if(tier>=2)assert.equal(item.locked,false,`${mapName} ${item.key} available after Hoze`);
    if(item.requiredTier){assert.match(item.unlockLabel,/Badge/);assert(item.unlockLabelEn);}
    if(mapName==='tour_rdc')assert.equal(item.requiredTier,Math.min(2,offers[item.key]?.tier||0),item.key);
   }
  }
  for(const item of shops.getShopCatalog({mapName,expedition:true}))assert.equal(item.locked,false,item.key);
  assert.equal(shops.getShopMeta({mapName,expedition:true}).badgeProgression,false);
 }
 for(const [mapName,key,tier]of [['tour_rdc','fishing_rod',0],['tour_rdc','fire_stone',2],['tour_etage1','protein',2],['tour_etage1','iv_randomizer_attack',2],['tour_etage2','leftovers',2],['tour_etage2','choice_scarf',2],['tour_etage2','focus_sash',2],['tour_etage3','leppa_berry',2]]){
  assert.equal(shops.getShopCatalog({mapName}).find(i=>i.key===key)?.requiredTier,tier,key);
 }
});

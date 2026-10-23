const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore'),shops=require('../server/game/world/shopCatalog'),items=require('../data/game/items.json').items;
const floors=['tour_rdc','tour_etage1','tour_etage2','tour_etage3'],names=['ville_commerciale',...floors];
function reachable(name,start){const c=maps.loadCollisionData(name),t=maps.changeMapData(name),seen=new Set(),q=[start];while(q.length){const[x,y]=q.shift(),k=x+':'+y;if(seen.has(k)||c[y]?.[x]!==0||pnjs.isPnjBlockingTile(name,x,y))continue;seen.add(k);if(t[y]?.[x])continue;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
test('commercial city and all four levels retain exact author resources, mirrored layers and authored stair destinations',()=>{
 const manifest=require('../docs/commercial-author-assets.json');assert.equal(Object.keys(manifest).length,15);
 for(const[file,hash]of Object.entries(manifest))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 for(const name of names){const m=require('../data/maps/'+name+'.json'),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8'),start=name==='ville_commerciale'?[26,17]:name==='tour_rdc'?[13,16]:[3,5],seen=reachable(name,start),changes=maps.changeMapData(name);assert.equal(m.width,28);assert.equal(m.height,20);
  for(const l of m.layers){if(l.type==='tilelayer'){const csv=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,l.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),l.data);}else for(const o of l.objects){const p=Object.fromEntries(o.properties.map(p=>[p.name,p.value])),link=maps.getNextMap(name,o.x/16,o.y/16);assert.equal(link.nextMap,p.destination);assert.deepEqual([link.nextX,link.nextY],[p.destination_x*32+16,p.destination_y*32+16]);assert(xml.includes(`name="${o.name}"`));}}
  changes.forEach((row,y)=>row.forEach((v,x)=>{if(!v)return;assert(seen.has(x+':'+y),name+' unreachable door '+x+','+y);const link=maps.getNextMap(name,x,y);assert(link);assert(!link.blockedMessage);const tx=Math.floor(link.nextX/32),ty=Math.floor(link.nextY/32);assert.equal(maps.loadCollisionData(link.nextMap)[ty]?.[tx],0);assert(!maps.changeMapData(link.nextMap)[ty]?.[tx]);assert(!pnjs.isPnjBlockingTile(link.nextMap,tx,ty));}));
  assert(!maps.battleMapData(name).flat().some(Boolean));
 }
 for(const y of[16,17,18]){assert.equal(maps.getNextMap('route6',0,y).nextMap,'ville_commerciale');assert.equal(maps.getNextMap('ville_commerciale',27,y).nextMap,'route6');}
 assert.equal(maps.getNextMap('ville_commerciale',4,8).nextMap,'centre');
});
test('each saleswoman is reachable, opens her own department, and every floor has an unambiguous village label and music',async()=>{
 const {getSentenceForName,getEndSentenceInformation}=require('../server/game/world/interactionRepository'),{worldMusicTrack}=await import('../vue-explorakit/src/services/worldMusic.js'),{getMapLocationLabel}=await import('../vue-explorakit/src/services/mapLocations.js');
 for(const[name,index]of floors.map((n,i)=>[n,i])){const sellers=pnjs.getPnjsForMap(name);assert.equal(sellers.length,1);const seller=sellers[0];assert(reachable(name,name==='tour_rdc'?[13,16]:[3,5]).has('10:7'));assert.equal(seller.interactionName,'commercial_keeper_'+(index+1));assert(getSentenceForName(seller.interactionName));assert.equal(getEndSentenceInformation(seller.interactionName),'shop');assert.match(getMapLocationLabel(name),new RegExp(String(index+1)));assert.equal(worldMusicTrack(name),'village');assert.equal(shops.getShopMeta({mapName:name}).department,index+1);}
 assert.equal(worldMusicTrack('ville_commerciale'),'village');
});
test('four server-authoritative departments provide distinct legal stock without unlocking other shops or special keys',()=>{
 const stock=floors.map(mapName=>shops.getShopCatalog({mapName}));assert.deepEqual(stock.map(s=>s.length),[27,19,11,39]);
 for(let i=0;i<stock.length;i++)for(const item of stock[i]){assert(Number.isSafeInteger(item.price)&&item.price>0);assert(items.some(i=>i.key===item.key));for(let j=0;j<stock.length;j++)if(j!==i)assert(!stock[j].some(i=>i.key===item.key));}
 for(const key of['pokeball','hyperball','repel','super_repel','max_repel','thunder_stone'])assert(stock[0].some(i=>i.key===key));
 assert.equal(stock[1].filter(i=>i.fieldUse?.ivReroll).length,6);assert.equal(stock[1].filter(i=>i.fieldUse?.effortReset).length,7);assert.equal(stock[1].filter(i=>i.fieldUse?.effort?.amount>0).length,6);
 for(const key of['leftovers','life_orb','choice_specs','choice_scarf','choice_band'])assert(stock[2].some(i=>i.key===key));assert(stock[3].every(i=>i.key.endsWith('_berry')));
 for(const key of['leftovers','choice_scarf','liechi_berry','zinc'])assert(!shops.getShopCatalog({mapName:'ville1_shop',flags:{wanda_defeated:'true'}}).some(i=>i.key===key));
 for(const list of stock)assert(!list.some(i=>['exp_share','route2_house_key','rift_talisman'].includes(i.key)));
 for(const name of['ville_commerciale','__proto__','tour_etage4']){assert(!shops.isShopMap(name));assert.deepEqual(shops.getShopCatalog({mapName:name}),[]);}
});
for(const mode of['rift','colosseum'])test(mode+': departments enforce stock, charge purchases once, survive checkpoints and keep expedition inventory separate',()=>{
 const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');const p={alive:true,currentmap:'tour_etage2',money:20000,run:{mode,phase:'exploration'},equipe:{pokemons:[]},items:{},drifts:[],equipped:[]};
 assert.equal(economy.shop(p).merchant,null);assert(!economy.shop(p).catalog.some(i=>i.key==='drift_potion'));assert.throws(()=>economy.buy(p,'iv_randomizer_attack',1),/invalide/);const money=p.money;economy.buy(p,'choice_scarf',1);assert.equal(p.money,money-2200);assert.equal(p.items.choice_scarf,1);
 p.currentmap='tour_etage1';economy.buy(p,'iv_randomizer_attack',2);p.currentmap='tour_etage3';economy.buy(p,'leppa_berry',5);const copy=codec.decode(codec.encode(p));assert.equal(copy.items.leppa_berry,5);assert.equal(copy.items.iv_randomizer_attack,2);assert.equal(copy.items.choice_scarf,1);assert(!economy.shop(copy).catalog.some(i=>i.key==='revive'));p.inbattle=true;assert.throws(()=>economy.buy(p,'leppa_berry',1),/indisponible/);
});
for(const mode of['rift','colosseum'])test(mode+': new city and stairs move in both directions and Center returns to its actual town',async()=>{
 const{createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');let now=1000;const store=createLobbyStore({now:()=>now}),runtime=createRunManager({starterChoiceMs:0,store,namespace:{to:()=>({emit(){}})},now:()=>now,random:()=>.99}),host={id:1,username:'store'},guest={id:2,username:'peer'};store.connect(host,'host');if(mode==='rift'){store.connect(guest,'guest');const{code}=store.create(host,{capacity:2,durationMinutes:30});store.join(guest,code);store.ready(host,true);store.ready(guest,true);await runtime.start(host);}else await runtime.startColosseum(host,{durationMinutes:30});runtime.enter(host,{id:'host'});const p=runtime.playerFor(host);
 function from(map,x,y,action,target,tx,ty){Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,repelSteps:250});now+=200;runtime.move(p,action);assert.equal(p.currentmap,target);assert.deepEqual([p.x,p.y],[tx*32+16,ty*32+16]);}
 from('route6',1,17,'move_q','ville_commerciale',26,17);from('ville_commerciale',26,17,'move_d','route6',1,17);from('ville_commerciale',13,12,'move_z','tour_rdc',13,16);
 for(let i=0;i<3;i++){from(floors[i],24,5,'move_z',floors[i+1],3,5);from(floors[i+1],3,5,'move_z',floors[i],24,5);}
 from('tour_rdc',13,18,'move_s','ville_commerciale',13,12);from('ville_commerciale',4,9,'move_z','centre',13,14);from('centre',13,14,'move_s','ville_commerciale',4,9);
});

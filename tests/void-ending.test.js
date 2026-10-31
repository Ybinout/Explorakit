const test=require('node:test'),assert=require('node:assert/strict');
const ending=require('../server/game/world/voidEnding'),maps=require('../server/game/world/mapRepository');
const rescued={flags:{lucie_rescued:'true'}},found={flags:{lucie_rescued:'true',void_found:'true',void_charge:'5'}};
test('hidden finale only follows Lucie rescue; clue contains the counter without explaining the solution',()=>{
 assert.equal(ending.state({flags:{professor_defeated:'true'}}).available,false);
 assert.equal(ending.state(rescued).available,true);assert.equal(ending.state(rescued).found,false);
 const zero=ending.itemView(ending.state(rescued)),ready=ending.itemView(ending.state(found));
 assert.equal(zero.name,'Téléporteur déchargé');assert.match(zero.description,/0\/5/);assert.equal(zero.usable,false);
 assert.equal(ready.name,'Téléporteur chargé');assert.equal(ready.usable,true);assert(!/attaque|combat|utilis/i.test(ready.description));
 assert.equal(ending.state({flags:{...found.flags,void_charge:'999'}}).charge,5);
});
test('professor standing and KO actors are personal, retain the dais and block its footprint',()=>{
 const empty={getPnjsForMap:()=>[],getPnjAtTile:()=>null,isPnjBlockingTile:()=>false};
 let progress=found;const store=ending.scopedStore(empty,()=>progress);
 assert.equal(store.getPnjsForMap('professor_lab').length,0);assert.equal(store.getPnjsForMap('void_arena')[0].sprite,'professor-pixel-v1.png');
 assert(store.isPnjBlockingTile('void_arena',13,4));assert(!store.isPnjBlockingTile('void_arena',13,5));
 progress={flags:{...found.flags,void_defeated:'true'}};assert.equal(store.getPnjsForMap('void_arena')[0].sprite,'professor-ko-pixel-v1.png');assert.equal(ending.actors('void_arena',rescued).length,0);
});
test('the arrival speech is personal, read once and rearmed independently for admin replay',()=>{
 const entry=ending.entryDialogue(found);assert(entry);assert.equal(entry.name,'professor_void_entry');
 assert(entry.sentences.some(s=>s.text.includes('suivi jusqu’ici')));
 assert(entry.sentences.some(s=>s.text.includes('tu ferais comme moi')));
 for(const extra of [{void_intro:'true'},{void_defeated:'true'},{void_charge:'4'},{lucie_rescued:'false'},{void_found:'false'}])assert.equal(ending.entryDialogue({flags:{...found.flags,...extra}}),null);
 const replay={flags:{...found.flags,void_intro:'true',admin_void_replay:'true',admin_void_found:'true',admin_void_charge:'5',admin_void_intro:'false',admin_professor_departure:'seen',admin_lab_rescued:'true'}};
 assert(ending.entryDialogue(replay));replay.flags.admin_void_intro='true';assert.equal(ending.entryDialogue(replay),null);assert.equal(replay.flags.void_intro,'true');
 const fs=require('node:fs'),path=require('node:path');
 assert.equal(ending.dialogues.challenge.sentences.length,4);
 for(const speech of [ending.dialogues.entry,ending.dialogues.challenge])for(const s of speech.sentences){assert(s.text.startsWith('Le Professeur : '));assert.equal(s.imageName,'prof.png');assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',s.imageName)));assert.equal(s.typewriterMs,40);}
});
test('the physical teleporter is on a reachable floor tile, including before replay rescue',()=>{
 const s=ending.state({flags:{lucie_rescued:'true',admin_professor_departure:'armed',admin_void_replay:'true'}});
 assert.equal(s.available,false);assert.equal(s.found,false);
 assert.deepEqual(s.pickup,{map:'professor_lab',x:16,y:9});
 const c=maps.loadCollisionData(s.pickup.map);
 assert.equal(c[s.pickup.y][s.pickup.x],0,'the prop must not be drawn inside the wall');
 assert.equal(c[s.pickup.y][s.pickup.x+1],0,'the player can approach from the side without covering it');
 assert.equal(maps.changeMapData(s.pickup.map)[s.pickup.y][s.pickup.x],0);
});
test('ruined arena central approach and return to the laboratory are connected and safe',()=>{
 const c=maps.loadCollisionData('void_arena');for(let y=4;y<=19;y++)assert.equal(c[y][13],0);
 for(const x of [13,14]){const link=maps.getNextMap('void_arena',x,19);assert.equal(link.nextMap,'professor_lab');assert.deepEqual([link.nextX,link.nextY],[432,496]);assert.equal(maps.loadCollisionData(link.nextMap)[15][13],0);assert.equal(maps.changeMapData(link.nextMap)[15][13],0);}
 assert(!maps.battleMapData('void_arena').flat().some(Boolean));
});
test('secret badge remains out of ordinary capture progression and the object is not sold or dropped',()=>{
 const catalog=require('../data/game/progression.json'),badge=catalog.badges.find(b=>b.key==='violence_badge');assert(!badge.hidden);assert.equal(badge.countsForCapture,false);
 const item=require('../data/game/items.json').items.find(i=>i.key==='void_teleporter');assert(item.unique);assert.equal(item.category,'key');assert(!item.wildLoot);assert(!item.buy_price);
});
test('charge observer ignores prevented, non-electric and PP-free actions, caps at five and updates only its owner',async()=>{
 const repo=require('../server/persistence/voidEndingRepository'),items=require('../server/persistence/itemRepository'),oldCharge=repo.charge,oldItems=items.loadUserItems,calls=[],events=[];
 try{repo.charge=async(id,receipt)=>{calls.push({id,receipt});return{available:true,found:true,charge:calls.length,changed:true};};items.loadUserItems=async()=>[];
 const {recorder}=require('../server/game/battle/voidCharge'),record=recorder(11,{id:'owner'},{to:id=>({emit:(event,data)=>events.push({id,event,data})})}),p={movePp:[5]};
 await record({move:{type:'Normal'}},6,p);await record({move:{type:'Electric'},actionPrevented:true},6,p);await record({move:{type:'Electric'}},5,p);assert.equal(calls.length,0);
 for(let i=0;i<8;i++)await record({move:{type:'Electric'}},6,p);assert.equal(calls.length,5);assert.equal(new Set(calls.map(c=>c.receipt)).size,5);assert(events.every(e=>e.id==='owner'));assert.equal(events.filter(e=>e.event==='bagUpdated').length,5);assert.deepEqual(events.filter(e=>e.event==='progressionNotice').map(e=>e.data),[1,2,3,4,5].map(charge=>({type:'teleporter_charge',charge,message:`Téléporteur chargé à ${charge}/5`})));
 }finally{repo.charge=oldCharge;items.loadUserItems=oldItems;}
});

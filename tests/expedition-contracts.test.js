const test=require('node:test'),assert=require('node:assert/strict');
const {createLobbyStore}=require('../server/game/drift/lobbyStore');
const {createRunManager}=require('../server/game/drift/runManager');
const contracts=require('../server/game/drift/contracts'),economy=require('../server/game/drift/economy');
const factory=require('../server/game/drift/pokemonFactory'),trainers=require('../server/game/drift/trainers');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
function setup(mode='colosseum'){
 let time=10000;const user={id:1,username:'Contrats'},other={id:2,username:'Autre'},store=createLobbyStore({now:()=>time}),events=[];
 const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,data)=>events.push({id,name,data})})},now:()=>time,random:()=>.1,starterChoiceMs:0,paceMs:0});
 store.connect(user,'a');if(mode==='rift'){store.connect(other,'b');store.create(user,{capacity:2,durationMinutes:30});store.join(other,store.snapshot(user).code);store.ready(user,true);store.ready(other,true);runtime.start(user);}else runtime.startColosseum(user,{durationMinutes:30});
 const p=runtime.playerFor(user);runtime.enter(user,{id:'a'});return {p,runtime,user,other,events,store,now:()=>time};
}
function win(f,attackerId=7,type='wild',npcKey=null){
 const p=f.p,attacker=p.equipe.pokemons.find(v=>v.data.id===attackerId);p.equipe.pokemons=[attacker,...p.equipe.pokemons.filter(v=>v!==attacker)];
 attacker.abilities=['Tackle'];attacker.movePp=[35];attacker.passiveAbility=null;attacker.currentHp=attacker.maxHp;
 const target=factory.create(19,1,true);target.currentHp=1;target.passiveAbility=null;target.abilities=['Growl'];target.movePp=[40];
 const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},type,npcKey);
 assert(b.action(p,{action:'attack',number:0,turnId:b.token}));assert(b.finished);return b;
}
for(const mode of ['rift','colosseum'])test(`${mode}: real victories credit distinct contributors, choices persist and cannot be replayed`,()=>{
 const f=setup(mode),p=f.p;p.equipe.pokemons=[factory.create(7,10,true),factory.create(4,10,true),factory.create(25,5,true)];p.equipe.pokemons[2].currentHp=0;p.equipe.pokemons[2].riftFainted=true;
 const originalRandom=Math.random;Math.random=()=>.5;try{
 const first=win(f);assert.equal(p.contracts[0].progress.length,1);first.finish(p,'finished');assert.equal(p.contracts[0].progress.length,1);
 win(f);assert.equal(p.contracts[0].progress.length,1);win(f,4);assert.equal(p.contracts[0].progress.length,2);
 const active=p.equipe.pokemons[0],reserve=p.equipe.pokemons[1],dead=p.equipe.pokemons[2];const previous=[active.level,reserve.level,dead.experience];
 const c=p.contracts[0];contracts.claim(p,{contractId:c.id,reward:'training'},f.now());
 assert.equal(active.level,previous[0]);assert.equal(reserve.level,previous[1]+1);assert.equal(dead.experience,previous[2]);
 assert.throws(()=>contracts.claim(p,{contractId:c.id,reward:'supplies'},f.now()),/récupéré/);
 const restored=decode(encode(p));assert.equal(restored.contracts[0].claimed,'training');assert.equal(restored.equipe.pokemons[1].level,reserve.level);
 assert.throws(()=>contracts.claim(restored,{contractId:c.id,reward:'item'},f.now()),/récupéré/);
 }finally{Math.random=originalRandom;}
});
test('capture species are distinct; flee, defeat, timer and arena-phase wins do not advance exploration contracts',()=>{
 const f=setup(),p=f.p,b={type:'wild',capturedPokemon:factory.create(19,5),contractContributors:new Set(['a'])};
 for(const reason of ['fled','timer','forfeit'])contracts.record(p,b,p,reason);contracts.record(p,b,null,'finished');assert.equal(p.contracts[0].progress.length,0);
 contracts.record(p,b,p,'captured');contracts.record(p,b,p,'captured');assert.equal(p.contracts[1].progress.length,1);
 b.capturedPokemon=factory.create(16,5);contracts.record(p,b,p,'captured');assert.equal(p.contracts[1].progress.length,2);
 p.run.phase='colosseum_battle';contracts.record(p,{type:'arena',npcKey:'colosseum_1'},p,'finished');assert.equal(p.contracts[2].progress.length,0);
});
test('claims validate ownership, completion, phase, deadline, living reserves and reward; no forged amounts',()=>{
 const f=setup('rift'),p=f.p,q=f.runtime.playerFor(f.other),c=p.contracts[2];
 assert.throws(()=>contracts.claim(p,{contractId:c.id,reward:'supplies'},f.now()));c.progress=['trainer'];
 for(const payload of [{contractId:q.contracts[2].id,reward:'item'},{contractId:c.id,reward:'coins'},{contractId:c.id,reward:'training'}])assert.throws(()=>contracts.claim(p,payload,f.now()));
 assert.equal(c.claimed,null);p.inbattle=true;assert.throws(()=>contracts.claim(p,{contractId:c.id,reward:'supplies'},f.now()));p.inbattle=false;
 assert.throws(()=>contracts.claim(p,{contractId:c.id,reward:'supplies'},p.run.endsAt));
 const before=p.items.pokeball;contracts.claim(p,{contractId:c.id,reward:'supplies',quantity:999999},f.now());assert.equal(p.items.pokeball,before+3);assert.equal(p.items.drift_potion,5);
 assert.equal(q.contracts[2].claimed,null);
});
test('Drift replacements are atomic, owned and keep five unique families; upgrading one family needs no empty slot',()=>{
 const f=setup(),p=f.p;p.drifts=Array.from({length:6},(_,i)=>({uuid:'d'+i,definitionId:'DRF-00'+(i+1),rarity:'rare'}));p.drifts.push({uuid:'upgrade',definitionId:'DRF-001',rarity:'epic'});p.equipped=p.drifts.slice(0,5).map(d=>d.uuid);p.ready=true;
 const before=[...p.equipped];assert.throws(()=>economy.replace(p,'upgrade','d1'));assert.deepEqual(p.equipped,before);
 assert.throws(()=>economy.replace(p,'unknown','d0'));assert.throws(()=>economy.replace(p,'d5','unknown'));assert.deepEqual(p.equipped,before);
 economy.replace(p,'upgrade','d0');assert.deepEqual(p.equipped,['upgrade','d1','d2','d3','d4']);assert.equal(p.ready,false);
 economy.replace(p,'d5','d1');assert.equal(p.equipped.length,5);assert(p.drifts.some(d=>d.uuid==='d1'));
 const saved=decode(encode(p));assert.deepEqual(saved.equipped,p.equipped);
 p.inbattle=true;assert.throws(()=>economy.replace(p,'d1','d5'));
});
test('new trainers require a nearby interaction and explicit confirmation, only reward a first victory',()=>{
 const f=setup(),p=f.p,t=trainers.find('expedition_lina');assert.throws(()=>f.runtime.endDialogue(p,t.id),/expiré/);
 p.currentmap=t.map;p.x=(t.x+1)*32+16;p.y=t.y*32+16;f.runtime.interact(p);
 const offer=f.events.find(e=>e.name==='expedition:trainerOffer').data;assert.equal(offer.level,5);assert.equal(p.inbattle,false);assert.equal(offer.team.length,1);
 f.runtime.endDialogue(p,t.id);assert(p.inbattle);assert.equal(p.battle.npcKey,t.id);const b=p.battle;b.active(1).currentHp=0;b.prune();b.checkEnd();assert(p.defeated.has(t.id));assert.equal(p.contracts[2].progress.length,1);
 f.runtime.interact(p);assert.throws(()=>f.runtime.endDialogue(p,t.id),/déjà/);
 const restored=decode(encode(p));assert(restored.defeated.has(t.id));assert.equal(restored.contracts[2].progress.length,1);
});
test('trainer spawns use walkable non-transition tiles and preserve access to every other walkable tile',()=>{
 const maps=require('../server/game/world/mapRepository'),{createPnjStore}=require('../server/game/world/pnjStore'),ordinary=createPnjStore(),extra=createPnjStore(trainers.entries);
 function components(map,store){const c=maps.loadCollisionData(map),seen=new Set(),sizes=[];for(let y=0;y<c.length;y++)for(let x=0;x<c[y].length;x++){
  if(c[y][x]!==0||store.isPnjBlockingTile(map,x,y)||seen.has(x+':'+y))continue;const queue=[[x,y]];seen.add(x+':'+y);let size=0;
  while(queue.length){const [a,b]=queue.pop();size++;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=a+dx,ny=b+dy,key=nx+':'+ny;if(c[ny]?.[nx]===0&&!store.isPnjBlockingTile(map,nx,ny)&&!seen.has(key)){seen.add(key);queue.push([nx,ny]);}}}sizes.push(size);
 }return sizes.sort((a,b)=>b-a);}
 for(const t of trainers.entries){const col=maps.loadCollisionData(t.map),changes=maps.changeMapData(t.map);for(const dy of [0,-1]){assert.equal(col[t.y+dy][t.x],0);assert(!changes[t.y+dy][t.x]);assert(!ordinary.isPnjBlockingTile(t.map,t.x,t.y+dy));}assert.equal(components(t.map,extra).length,components(t.map,ordinary).length,t.name+' must not split a path');}
});
test('opening encounters remove early multi-hit bursts and substantially reduce first-hit KOs without changing the arena factory',()=>{
 const {tuneWildMoves}=require('../server/game/drift/openingBalance'),traits=require('../data/game/ability_move_traits.gen7.json').moves;
 for(const id of factory.STARTERS)for(const level of [3,5,9,14]){const p=tuneWildMoves(factory.create(id,level));assert(p.abilities.some(name=>require('../server/game/battle/battleEngine').getMoveByName(name)?.power>0));assert(p.abilities.every(name=>!traits[name]?.multihit));assert.equal(p.abilities.length,p.movePp.length);}
 const high=factory.create(1,20),old=[...high.abilities];tuneWildMoves(high);assert.deepEqual(high.abilities,old);
 assert(factory.create(1,5).abilities.includes('Bullet Seed'),'Starter/arena generation must remain unchanged');
 const sample=require('../scripts/auditExpeditionOpening').measureOpening();assert(sample.after.oneHitKOs<sample.before.oneHitKOs/4);assert(sample.after.averageWorstHitPercent<sample.before.averageWorstHitPercent);
});

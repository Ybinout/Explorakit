const test=require('node:test'),assert=require('node:assert/strict');
const {createLobbyStore}=require('../server/game/drift/lobbyStore');
const {createRunManager}=require('../server/game/drift/runManager');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
const factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const economy=require('../server/game/drift/economy'),merchant=require('../server/game/drift/merchant');
const engine=require('../server/game/battle/battleEngine'),items=require('../server/game/items/heldItems');
const stones=require('../server/game/items/stoneEvolution');
const {healTeam}=require('../server/game/world/playerRecovery');
const {getUsableMoveIndexes}=require('../server/game/battle/battleResources');
function setup(mode='colosseum',durationMinutes=30){
 let time=10000;const user={id:1,username:'Choix'},other={id:2,username:'Autre'},store=createLobbyStore({now:()=>time});
 const events=[];const runtime=createRunManager({store,namespace:{to:id=>({emit:(event,data)=>events.push({id,event,data})})},now:()=>time,random:()=>.4,paceMs:0});
 store.connect(user,'a');store.connect(other,'b');
 if(mode==='rift'){store.create(user,{capacity:2,durationMinutes});store.join(other,store.snapshot(user).code);store.ready(other,true);store.ready(user,true);runtime.start(user);}else runtime.startColosseum(user,{durationMinutes});
 const p=runtime.playerFor(user);runtime.enter(user,{id:'a'});if(mode==='rift')runtime.enter(other,{id:'b'});
 return {runtime,store,user,other,p,events,now:()=>time,advance(ms){time+=ms;runtime.tick();},choose(){for(const player of p.run.players.values())runtime.chooseStarter(player,player.starterChoices[1].uuid);return p;}};
}
function fighter(id=19,level=30){const p=factory.create(id,level,true);p.passiveAbility=null;p.abilities=['Tackle','Growl','Water Gun','Thunder Wave'];p.movePp=[35,40,25,20];return p;}
for(const [mode,minutes] of [['rift',30],['colosseum',30],['colosseum',60]])test(`${mode} ${minutes}: private three-choice starter, authoritative lock and full exploration clock`,()=>{
 const f=setup(mode,minutes),p=f.p;assert.equal(p.run.phase,'selection');assert.equal(p.equipe.pokemons.length,0);
 assert.equal(new Set(p.starterChoices.map(x=>x.data.id)).size,3);assert(p.starterChoices.every(x=>factory.STARTERS.includes(x.data.id)&&x.level===5));
 const before=f.runtime.state(p).starterChoices.map(x=>x.uuid);f.runtime.enter(f.user,{id:'a2'});assert.deepEqual(f.runtime.state(p).starterChoices.map(x=>x.uuid),before);
 assert.throws(()=>f.runtime.chooseStarter(p,'forged'),/trois/);assert.throws(()=>economy.usePotion(p,'drift_potion','forged'),/indisponible/);
 f.advance(12000);const chosen=p.starterChoices[1];f.choose();assert.equal(p.equipe.pokemons[0],chosen);assert.equal(p.run.phase,'exploration');assert.equal(p.run.endsAt-f.now(),minutes*60000);assert.equal(p.runReport.starter.uuid,chosen.uuid);
 assert.throws(()=>f.runtime.chooseStarter(p,before[0]),/terminé/);
});
test('selection timeout and restart retain the same offer and do not spend exploration time',()=>{
 const f=setup(),p=f.p,ids=p.starterChoices.map(x=>x.uuid);const saved=decode(encode({runs:f.runtime.runs,lobbies:f.store.exportLobbies(),savedAt:f.now()}));
 assert.deepEqual(saved.runs.get(p.run.id).players.get(1).starterChoices.map(x=>x.uuid),ids);
 f.advance(45000);assert.equal(p.run.phase,'exploration');assert.equal(p.equipe.pokemons[0].uuid,ids[0]);assert.equal(p.run.endsAt-f.now(),1800000);
});
for(const [mode,minutes] of [['rift',30],['colosseum',30],['colosseum',60]])test(`${mode} ${minutes}: discounted Balls charge the displayed price and persist inventory`,()=>{
 const f=setup(mode,minutes),p=f.choose();p.currentmap='ville1_shop';p.money=4500;
 for(const [key,price] of [['pokeball',150],['superball',450],['hyperball',900]]){
  assert.equal(economy.shop(p).catalog.find(i=>i.key===key).price,price);
  const beforeMoney=p.money,beforeCount=p.items[key]||0;
  const purchased=economy.buy(p,key,2);
  assert.equal(purchased.money,beforeMoney-price*2);assert.equal(p.items[key],beforeCount+2);
 }
 const restored=decode(encode(p));assert.equal(restored.money,1500);assert.deepEqual(restored.items,p.items);
 const before={money:p.money,items:{...p.items}};
 assert.throws(()=>economy.buy(p,'hyperball',2),/Monnaie insuffisante/);
 assert.equal(p.money,before.money);assert.deepEqual(p.items,before.items);
});
test('merchant has stable finite per-player stock, cannot buy twice or forge price; trades consume exactly three',()=>{
 const f=setup('rift'),p=f.choose(),q=f.runtime.playerFor(f.other);p.currentmap=q.currentmap='ville1_shop';p.money=q.money=10000;
 const stock=merchant.view(p);assert.equal(stock.offers.length,6);assert.deepEqual(merchant.view(q),stock);
 const offer=stock.offers[0];merchant.buy(p,offer.id);assert.equal(p.money,10000-offer.price);assert.equal(merchant.view(p).offers[0].stock,0);assert.equal(merchant.view(q).offers[0].stock,1);
 assert.throws(()=>merchant.buy(p,offer.id),/plus disponible/);assert.throws(()=>merchant.buy(p,'forged'),/plus disponible/);
 p.drifts.push(merchant.rollDrift('rare',()=>.1),merchant.rollDrift('epic',()=>.2));const ids=p.drifts.map(d=>d.uuid),before=p.drifts.length;
 p.equipped=[ids[0]];assert.throws(()=>merchant.exchange(p,ids),/non équipés/);assert.equal(p.drifts.length,before);p.equipped=[];
 assert.throws(()=>merchant.exchange(p,[ids[0],ids[0],ids[1]]),/trois/);merchant.exchange(p,ids,()=>.1);assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'rare');
 assert.throws(()=>merchant.exchange(p,ids),/non équipés/);const oldMoney=p.money;economy.remove(p,p.drifts[0].uuid,true);assert(p.money>oldMoney);assert.equal(p.drifts.length,0);
 const saved=decode(encode(p));assert.equal(merchant.view(saved).offers[0].stock,0);p.currentmap='start';assert.throws(()=>merchant.buy(p,stock.offers[1].id),/boutique/);
});
test('strategic drops occur only on wild victories and survive a checkpoint; no capture or defeat farming',()=>{
 const f=setup(),p=f.choose();const roll=()=>0;
 const loot=economy.drop(p,'wild',roll);assert(loot.includes('Baie Oran'));assert.equal(p.items.oran_berry,1);
 const before=p.items.oran_berry;economy.drop(p,'capture',roll);assert.equal(p.items.oran_berry,before);
 const saved=decode(encode(p));assert.equal(saved.items.oran_berry,1);
 const enemy={npc:true,equipe:{pokemons:[fighter()]},drifts:[],equipped:[]};
 const b=f.runtime.battle(p,enemy,'wild');p.equipe.pokemons[0].currentHp=0;b.prune();b.checkEnd();assert.equal(p.alive,false);
});
for(const source of ['direct','residual'])test(`talisman ${source}: consumes once, auto-switches, excludes XP and heals only out of battle`,()=>{
 const f=setup(),p=f.choose(),a=fighter(),reserve=fighter(7);a.heldItem='rift_talisman';p.equipe.pokemons=[a,reserve];
 const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[fighter()]},drifts:[],equipped:[]},'wild');
 if(source==='direct')engine.useattack('Explosion',b.active(1),a,{battleState:b.state,attackerSide:b.sides[1],defenderSide:b.sides[0]});
 a.currentHp=0;b.prune();assert.equal(a.heldItem,null);assert.equal(a.riftFainted,true);assert.equal(b.active(0),reserve);assert.equal(p.equipe.pokemons.length,2);
 b.prune();assert.equal(p.runReport.stats.pokemonLost,0);const before=a.experience;b.reward(fighter(19,5));assert.equal(a.experience,before);
 assert(!b.action(p,{action:'change',number:1,turnId:b.token}));assert.throws(()=>economy.usePotion(p,'drift_potion',a.uuid),/indisponible/);
 b.finish(null,'fled');const restored=decode(encode(p));assert.equal(restored.equipe.pokemons[1].riftFainted,true);
 economy.usePotion(p,'drift_potion',a.uuid,()=>.99);assert.equal(a.currentHp,20);assert.equal(a.riftFainted,undefined);
 const second=f.runtime.battle(p,{npc:true,equipe:{pokemons:[fighter()]},drifts:[],equipped:[]},'wild');a.currentHp=0;second.prune();assert(!p.equipe.pokemons.includes(a));
});
test('last protected Pokémon survives exploration defeat but not a lost Colosseum challenge',()=>{
 const f=setup(),p=f.choose(),a=p.equipe.pokemons[0];a.heldItem='rift_talisman';const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[fighter()]},drifts:[],equipped:[]},'wild');a.currentHp=0;b.prune();b.checkEnd();
 assert.equal(p.alive,true);assert.equal(a.currentHp,0);assert.throws(()=>f.runtime.battle(p,{npc:true,equipe:{pokemons:[fighter()]}},'wild'),/Soigne/);
 healTeam(p.equipe);assert.equal(a.riftFainted,undefined);assert.equal(a.currentHp,a.maxHp);f.advance(1800000);f.runtime.ready(p);a.heldItem='rift_talisman';a.currentHp=0;p.battle.prune();p.battle.checkEnd();assert.equal(p.run.phase,'results');
});
test('stone evolution is compatible, atomic, gender-aware and preserves identity, XP, moves, item and wounds',()=>{
 const f=setup(),p=f.choose(),eevee=factory.create(133,12,true);p.equipe.pokemons=[eevee];eevee.heldItem='leftovers';eevee.currentHp-=5;
 p.items.thunder_stone=2;const before={uuid:eevee.uuid,xp:eevee.experience,level:eevee.level,moves:[...eevee.abilities],pp:[...eevee.movePp],iv:eevee.iv};
 assert.equal(stones.target(eevee,'thunder_stone').id,135);assert.equal(stones.target(eevee,'water_stone').id,134);assert.equal(stones.target(eevee,'ice_stone').id,471);
 assert.throws(()=>economy.evolve(p,'moon_stone',eevee.uuid),/convient/);economy.evolve(p,'thunder_stone',eevee.uuid);
 assert.equal(eevee.data.id,135);assert.equal(eevee.uuid,before.uuid);assert.equal(eevee.experience,before.xp);assert.equal(eevee.level,before.level);assert.deepEqual(eevee.abilities,before.moves);assert.deepEqual(eevee.movePp,before.pp);assert.deepEqual(eevee.iv,before.iv);assert.equal(eevee.heldItem,'leftovers');assert.equal(eevee.maxHp-eevee.currentHp,5);assert.equal(p.items.thunder_stone,1);
 assert.throws(()=>economy.evolve(p,'thunder_stone',eevee.uuid),/convient/);assert.equal(p.items.thunder_stone,1);
 const kirlia=factory.create(281,25);kirlia.gender='female';assert.equal(stones.target(kirlia,'dawn_stone'),null);kirlia.gender='male';assert.equal(stones.target(kirlia,'dawn_stone').id,475);
 const pika=factory.create(25,5);assert.equal(stones.target(pika,'thunder_stone').id,26);pika.currentHp=0;assert.equal(stones.target(pika,'thunder_stone'),null);
});
test('all stone targets have game data and sprites; shop does not leak expedition-only items to Adventure',()=>{
 const fs=require('node:fs'),path=require('node:path'),rules=require('../data/game/stone_evolutions.json').rules;
 for(const rule of rules){assert(fs.existsSync(path.join(__dirname,`../vue-explorakit/src/assets/dp2/${rule.to}.png`)));assert(fs.existsSync(path.join(__dirname,`../vue-explorakit/src/assets/back/${rule.to}.png`)));}
 const shop=require('../server/game/world/shopCatalog');assert(!shop.getShopCatalog().some(i=>i.key==='rift_talisman'));assert(shop.getShopCatalog({expedition:true}).some(i=>i.key==='rift_talisman'));
});
test('held items: Choice stats/lock/reset, Assault Vest restriction, Eviolite eligibility, suppression',()=>{
 const p=fighter(25),state=engine.createBattleState();engine.ensureBattleData(p);
 for(const [key,stat]of [['choice_band','attack'],['choice_specs','specialAttack'],['choice_scarf','speed']]){p.heldItem=key;assert.equal(items.statMultiplier(p,stat,state),1.5);}
 p.heldItem='choice_band';items.lockMove(p,'Tackle',state);assert.deepEqual(getUsableMoveIndexes(p,state),[0]);p.movePp[0]=0;assert.deepEqual(getUsableMoveIndexes(p,state),[]);
 state.field.magicRoomTurns=2;assert.equal(items.statMultiplier(p,'attack',state),1);assert(getUsableMoveIndexes(p,state).includes(1));state.field.magicRoomTurns=0;
 require('../server/game/battle/battleTeam').clearSwitchOutState(p);engine.ensureBattleData(p);p.movePp[0]=35;assert.equal(getUsableMoveIndexes(p).length,4);
 p.heldItem='assault_vest';assert.deepEqual(getUsableMoveIndexes(p),[0,2]);assert.equal(items.statMultiplier(p,'specialDefense',state),1.5);
 p.heldItem='eviolite';assert.equal(items.statMultiplier(p,'defense',state),1.5);p.data.id=26;assert.equal(items.statMultiplier(p,'defense',state),1);
});
test('Life Orb, Expert Belt, Shell Bell, Helmet, Sash and Restes execute actual combat effects',()=>{
 const old=Math.random;Math.random=()=>.5;
 try{
 const a=fighter(19),b=fighter(7);a.maxHp=a.currentHp=500;b.maxHp=b.currentHp=500;const state=engine.createBattleState();
 const normal=engine.estimateDamage(a,b,engine.getMoveByName('Tackle'),{battleState:state});
 a.heldItem='life_orb';assert(engine.estimateDamage(a,b,engine.getMoveByName('Tackle'),{battleState:state})>normal);
 engine.useattack('Tackle',a,b,{battleState:state});assert.equal(a.currentHp,450);
 a.heldItem='expert_belt';assert.equal(items.damageMultiplier(a,2,state),1.2);assert.equal(items.damageMultiplier(a,1,state),1);
 a.heldItem='shell_bell';const hp=a.currentHp,hit=engine.useattack('Tackle',a,b,{battleState:state});assert.equal(a.currentHp-hp,Math.max(1,Math.floor(hit.damage/8)));
 a.heldItem=null;b.heldItem='rocky_helmet';const hp2=a.currentHp;engine.useattack('Tackle',a,b,{battleState:state});assert.equal(hp2-a.currentHp,Math.floor(a.maxHp/6));
 b.heldItem='focus_sash';b.maxHp=b.currentHp=1;engine.useattack('Tackle',a,b,{battleState:state});assert.equal(b.currentHp,1);assert.equal(b.heldItem,null);engine.useattack('Tackle',a,b,{battleState:state});assert.equal(b.currentHp,0);
 a.heldItem='leftovers';a.currentHp=100;engine.processEndOfRound(a,fighter(),state.sides.player,state.sides.enemy,state);assert.equal(a.currentHp,100+Math.floor(a.maxHp/16));
 }finally{Math.random=old;}
});
test('Socket strategy commands are owner-checked and checkpointed; stale choices/trades cannot reroll', {timeout:15000},async()=>{
 const http=require('node:http'),{once}=require('node:events'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {signAccessToken}=require('../server/config/auth'),{registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
 const server=http.createServer(),io=new Server(server);let checkpoint;
 const cleanup=registerDriftLobbies(io,{checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const sockets=[];
 const command=(s,n,p={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(n,p,(e,r)=>e?reject(e):resolve(r)));
 try{
 for(const id of [801,802]){const socket=client(`http://127.0.0.1:${server.address().port}/drift`,{autoConnect:false,auth:{token:signAccessToken({id,username:'Strategy'+id})},transports:['websocket']});sockets.push(socket);const ready=once(socket,'drift:bootstrap');socket.connect();await ready;await command(socket,'colosseum:start',{durationMinutes:30});await command(socket,'drift:enter');}
 const [a,b]=sockets,p=cleanup.runtime.playerFor({id:801}),q=cleanup.runtime.playerFor({id:802});const chosen=p.starterChoices[2].uuid;
 assert.equal((await command(b,'drift:chooseStarter',{userId:801,pokemonUuid:chosen})).success,false);assert.equal(q.starterChoices.length,3);
 assert.equal((await command(a,'drift:chooseStarter',{pokemonUuid:chosen})).success,true);assert.equal(decode(checkpoint).runs.get(p.run.id).players.get(801).equipe.pokemons[0].uuid,chosen);
 assert.equal((await command(a,'drift:chooseStarter',{pokemonUuid:chosen})).success,false);
 p.currentmap='ville1_shop';p.money=10000;const offer=p.run.merchant.offers[0];
 assert.equal((await command(a,'drift:merchantBuy',{offerId:offer.id,price:0})).success,true);assert.equal(p.money,10000-offer.price);
 assert.equal((await command(a,'drift:merchantBuy',{offerId:offer.id})).success,false);assert.equal(decode(checkpoint).runs.get(p.run.id).players.get(801).merchantBought.length,1);
 p.drifts.push(merchant.rollDrift('common'),merchant.rollDrift('common'));const uuids=p.drifts.map(d=>d.uuid);
 assert.equal((await command(a,'drift:exchange',{uuids})).success,true);assert.equal((await command(a,'drift:exchange',{uuids})).success,false);assert.equal(p.drifts.length,1);
 }finally{sockets.forEach(s=>s.disconnect());cleanup();await new Promise(resolve=>io.close(resolve));}
});
test('consuming an exchanged Sash cannot duplicate it on cleanup; Recycle restores its actual owner',()=>{
 const old=Math.random;Math.random=()=>.5;
 try{for(const recycle of [false,true]){
  let a=fighter(),b=fighter();a.heldItem='focus_sash';b.abilities.push('Trick','Recycle');b.movePp.push(10,10);
  const state=engine.createBattleState();engine.useattack('Trick',b,a,{battleState:state});assert.equal(b.heldItem,'focus_sash');assert.doesNotThrow(()=>JSON.stringify([a,b]));
  [a,b]=decode(encode([a,b]));b.maxHp=b.currentHp=1;engine.useattack('Tackle',a,b,{battleState:state});assert.equal(b.currentHp,1);assert.equal(b.heldItem,null);
  if(recycle)engine.useattack('Recycle',b,a,{battleState:state});
  require('../server/game/battle/battleOutcome').clearBattleTransientState([a,b]);assert.equal(a.heldItem,recycle?'focus_sash':null);assert.equal(b.heldItem,null);
 }}finally{Math.random=old;}
});

test('leaving during starter selection grants no exploration time or coins',()=>{
 const f=setup('rift');f.advance(10000);f.runtime.abandon(f.p);assert.equal(f.p.run.phase,'results');assert.equal(f.p.run.explorationMs,0);assert.equal(f.p.run.accountReward.coinsAwarded,0);
});
test('client held item labels match the authoritative catalogue',()=>{
 const client=require('../vue-explorakit/src/data/heldItems.json');
 for(const item of require('../data/game/items.json').items.filter(i=>i.category==='held'))assert.deepEqual(client[item.key],{name:item.name,description:item.description});
});

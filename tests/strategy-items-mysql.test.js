const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,items,pc,factory;const keys=require('../data/game/items.json').items.filter(i=>!i.abilityPlate&&['type_power','black_sludge','light_clay','big_root','shed_shell','white_herb','mental_herb','power_herb','air_balloon','weakness_policy','protective_pads','weather_rock'].includes(i.battle_effect)).map(i=>i.key);
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');items=require('../server/persistence/itemRepository');pc=require('../server/persistence/pokemonStorageRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
class Socket extends EventEmitter{constructor(){super();this.steps=[{action:'attack',number:0},{action:'disconnect'}];this.connected=true;}emit(name,data){if(name!=='requestAction')return super.emit(name,data);const step=this.steps.shift()||{action:'disconnect'};setImmediate(()=>step.action==='disconnect'?(this.connected=false,super.emit('disconnect')):super.emit('actionResponse',{...step,turnId:data.turnId,replacementId:data.replacementId}));return true;}}
function mon(id,move,item=null){const p=factory.create(id,50,true);Object.assign(p,{currentHp:400,maxHp:400,attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,passiveAbility:null,heldItem:item,status:'normal',abilities:[move],movePp:[require('../server/game/battle/battleResources').getMaxMovePp(move)]});return p;}
async function fixture(p){const u=await users.createUserWithStarter('strategy_'+randomUUID(),randomUUID(),{starterId:7}),player={id:'strategy-'+u.id,userId:u.id,username:u.username,currentmap:'ville1_shop',equipe:{pokemons:[p]}},socket=new Socket();await teams.editEquipe(u.id,player.equipe);return{u,player,socket,cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};}
test('SQL all 32: server badge/price checks, purchase, equip, PC and take without duplication',{skip:!enabled,timeout:15000},async()=>{
 const f=await fixture(mon(151,'Splash'));try{
  await db.execute('UPDATE users SET money=400000 WHERE id=?',[f.u.id]);const team=await teams.getTeamRecord(f.u.id),uuid=f.player.equipe.pokemons[0].uuid;
  for(const key of keys){const denied=await items.purchaseUserItem(f.u.id,key,1,{mapName:'tour_etage2',flags:{hoze_defeated:'true'},price:1});assert.equal(denied.reason,'badge_required');}
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'hoze_defeated','true')",[f.u.id]);
  for(const [i,key]of keys.entries()){const purchase=await items.purchaseUserItem(f.u.id,key,1,{mapName:'tour_etage2',price:1});assert(purchase.success);assert.equal(purchase.money,400000-10000*(i+1));await items.equipHeldItem(f.u.id,team.id,uuid,key);assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].heldItem,key);}
  const p=(await teams.loadEquipe(f.u.id)).pokemons[0];await teams.editEquipe(f.u.id,{pokemons:[]});await pc.storeCapturedPokemon(f.u.id,p);
  const result=await pc.mutateStorage(f.u.id,{action:'takeItem',source:'box',pokemonUuid:uuid,expectedItem:'icy_rock'});assert.equal(result.takenItem,'icy_rock');assert(!result.state.entries.find(e=>e.pokemon.uuid===uuid).pokemon.heldItem);await assert.rejects(()=>pc.mutateStorage(f.u.id,{action:'takeItem',source:'box',pokemonUuid:uuid,expectedItem:'icy_rock'}));
  const bag=await items.loadUserItems(f.u.id);for(const key of keys)assert.equal(bag.find(i=>i.key===key).quantity,1,key);
 }finally{await f.cleanup();}
});
for(const mode of ['wild','trainer','pvp'])for(const [key,id,move,enemyId,enemyMove,enemyItem,needle]of [
 ['white_herb',68,'Close Combat',143,'Splash',null,'Herbe Blanche'],
 ['mental_herb',151,'Splash',143,'Taunt',null,'Herbe Mental'],
 ['power_herb',151,'Solar Beam',143,'Splash',null,'Herbe Pouvoir'],
 ['air_balloon',151,'Splash',143,'Pound',null,'éclate'],
 ['weakness_policy',6,'Splash',143,'Surf',null,'Vulné-Assurance'],
 ['black_sludge',31,'Splash',143,'Splash',null,'Vase Noire'],
 ['protective_pads',68,'Pound',143,'Splash','rocky_helmet',null]
])test(`SQL ${mode} actual battle: ${key}, item restored after disconnect and SQL reload`,{skip:!enabled,timeout:15000},async()=>{
 let f,rival;const old=Math.random;Math.random=()=>.5;try{
  const a=mon(id,move,key),b=mon(enemyId,enemyMove,enemyItem);a.currentSpeed=999;if(key==='black_sludge')a.currentHp=200;f=await fixture(a);
  const events=[],io={sockets:{sockets:new Map([[f.player.id,f.socket]])},to:id=>({emit:(name,data)=>events.push({id,name,data:structuredClone(data)})})};
  if(mode==='pvp'){rival=await fixture(b);io.sockets.sockets.set(rival.player.id,rival.socket);await require('../server/game/battle/pvpBattle').startPvpBattle(f.player,rival.player,io);}
  else if(mode==='wild')await require('../server/game/battle/wildBattle')(f.player,b,io,f.u.id);
  else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[b]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});
  const texts=events.filter(e=>e.id===f.player.id&&e.name==='battleText').map(e=>e.data.message),saved=(await teams.loadEquipe(f.u.id)).pokemons[0];
  if(needle)assert(texts.some(t=>t.includes(needle)),key+': '+texts.join(' / '));assert.equal(saved.heldItem,key);assert.equal(saved.uuid,a.uuid);if(key==='protective_pads')assert.equal(saved.currentHp,400);if(key==='black_sludge')assert(saved.currentHp>200);assert(events.some(e=>e.id===f.player.id&&e.name==='endbattle'));
 }finally{Math.random=old;await rival?.cleanup();await f?.cleanup();}
});

 test('SQL Multitype plates: real badge gating, authoritative price, equipment ownership and reload',{skip:!enabled,timeout:15000},async()=>{
 const f=await fixture(mon(493,'Judgment'));try{const plates=require('../data/game/items.json').items.filter(i=>i.abilityPlate);await db.execute('UPDATE users SET money=200000 WHERE id=?',[f.u.id]);const team=await teams.getTeamRecord(f.u.id),uuid=f.player.equipe.pokemons[0].uuid;
 for(const i of plates){const denied=await items.purchaseUserItem(f.u.id,i.key,1,{mapName:'tour_etage2',flags:{hoze_defeated:'true'},price:1});assert.equal(denied.reason,'badge_required');}
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'hoze_defeated','true')",[f.u.id]);
 for(const [index,i]of plates.entries()){const bought=await items.purchaseUserItem(f.u.id,i.key,1,{mapName:'tour_etage2',price:1});assert.equal(bought.success,true,i.key);assert.equal(bought.money,200000-10000*(index+1));await items.equipHeldItem(f.u.id,team.id,uuid,i.key);assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].heldItem,i.key);}
 const bag=await items.loadUserItems(f.u.id);for(const i of plates.slice(0,-1))assert.equal(bag.find(e=>e.key===i.key)?.quantity,1);assert.equal(bag.find(e=>e.key===plates.at(-1).key)?.quantity||0,0);
 }finally{await f.cleanup();}
 });

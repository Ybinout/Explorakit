const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1',keys=['macho_brace','muscle_band','wise_glasses','wide_lens','scope_lens','flame_orb'];
let db,users,teams,items,pc,factory,engine,owner,party;
test.before(async()=>{
 if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');items=require('../server/persistence/itemRepository');pc=require('../server/persistence/pokemonStorageRepository');factory=require('../server/game/drift/pokemonFactory');engine=require('../server/game/battle/battleEngine');
 owner=await users.createUserWithStarter('held_six_'+randomUUID(),randomUUID(),{starterId:7});party=[68,65,94,143,214,214].map(id=>factory.create(id,50,true));party[5].passiveAbility='Guts';await teams.editEquipe(owner.id,{pokemons:party});await db.execute('UPDATE users SET money=100000 WHERE id=?',[owner.id]);
});
test.after(async()=>{if(owner)await db.execute('DELETE FROM users WHERE id=?',[owner.id]);await db?.end();});
test('SQL six items: badge checks, authoritative prices, purchases/equipment and reload', {skip:!enabled},async()=>{
 for(const key of keys){const denied=await items.purchaseUserItem(owner.id,key,1,{mapName:'tour_etage2',flags:{hoze_defeated:'true'},price:1});assert.equal(denied.reason,'badge_required');}
 assert.equal(Number((await db.execute('SELECT money FROM users WHERE id=?',[owner.id]))[0][0].money),100000);
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'hoze_defeated','true')",[owner.id]);
 const team=await teams.getTeamRecord(owner.id);
 for(const[i,key]of keys.entries()){const purchase=await items.purchaseUserItem(owner.id,key,1,{mapName:'tour_etage2',price:1});assert(purchase.success,JSON.stringify(purchase));assert.equal(purchase.money,100000-10000*(i+1));await items.equipHeldItem(owner.id,team.id,party[i].uuid,key);}
 const loaded=(await teams.loadEquipe(owner.id)).pokemons;assert.deepEqual(loaded.map(p=>p.heldItem),keys);assert.deepEqual(loaded.map(p=>p.uuid),party.map(p=>p.uuid));for(const key of keys)assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key===key)?.quantity||0,0);
});
test('SQL Macho EVs and Flame Orb survive battle cleanup, persistent save and reconnect without XP or free healing',{skip:!enabled},async()=>{
 const equipe=await teams.loadEquipe(owner.id),[a,b]=equipe.pokemons,orb=equipe.pokemons[5],foe=factory.create(19,50,true),tracker=new(require('../server/game/battle/adventureExperience').AdventureExperience)(),xp=equipe.pokemons.map(p=>p.experience);
 tracker.enter(a,foe);tracker.enter(b,foe);b.currentHp=0;foe.currentHp=0;tracker.reward({id:'private',equipe},foe,1,{to:()=>({emit(){}})},{grantExperience:false});tracker.reward({id:'private',equipe},foe,1,{to:()=>({emit(){}})},{grantExperience:false});assert.equal(a.ev.speed,2);assert.equal(b.ev.speed,1);assert.equal(b.currentHp,0);assert(equipe.pokemons.slice(2).every(p=>p.ev.speed===0));assert.deepEqual(equipe.pokemons.map(p=>p.experience),xp);
 const s=engine.createBattleState(),hp=orb.currentHp,enemy=factory.create(143,50,true);enemy.heldItem=null;engine.processEndOfRound(orb,enemy,s.sides.player,s.sides.enemy,s);assert.equal(orb.status,'burn');assert.equal(orb.currentHp,hp);assert.equal(orb.heldItem,'flame_orb');
 require('../server/game/battle/battleOutcome').clearBattleTransientState(equipe.pokemons);await teams.editEquipe(owner.id,equipe);
 const saved=(await teams.loadEquipe(owner.id)).pokemons;assert.deepEqual(saved.map(p=>p.heldItem),keys);assert.equal(saved[0].ev.speed,2);assert.equal(saved[1].ev.speed,1);assert.equal(saved[1].currentHp,0);assert.equal(saved[5].status,'burn');assert.equal(saved[5].currentHp,hp);assert.deepEqual(saved.map(p=>p.experience),xp);
});
test('SQL the new item remains attached in PC storage and can be taken once without losing the Pokémon or its training',{skip:!enabled},async()=>{
 const equipe=await teams.loadEquipe(owner.id),p=equipe.pokemons.pop(),ev={...p.ev};await teams.editEquipe(owner.id,equipe);await pc.storeCapturedPokemon(owner.id,p);
 const result=await pc.mutateStorage(owner.id,{action:'takeItem',source:'box',pokemonUuid:p.uuid,expectedItem:'flame_orb'});assert.equal(result.takenItem,'flame_orb');const stored=result.state.entries.find(e=>e.pokemon.uuid===p.uuid).pokemon;assert.equal(stored.heldItem,null);assert.deepEqual(stored.ev,ev);assert.equal(stored.status,p.status);assert.equal(stored.currentHp,p.currentHp);assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key==='flame_orb').quantity,1);
 await assert.rejects(()=>pc.mutateStorage(owner.id,{action:'takeItem',source:'box',pokemonUuid:p.uuid,expectedItem:'flame_orb'}));assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key==='flame_orb').quantity,1);
});

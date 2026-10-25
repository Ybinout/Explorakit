const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let db, progress, collection, users, medicine, teams;
test.before(() => {
    if (!enabled) return;
    if (!/test/i.test(process.env.DB_NAME || '')) throw Error('Base de test requise.');
    db = require('../server/config/database').dbPool;
    progress = require('../server/persistence/progressionRepository');
    collection = require('../server/persistence/riftCollectionRepository');
    users = require('../server/persistence/userRepository');
    medicine = require('../server/persistence/medicineRepository');
    teams = require('../server/persistence/teamRepository');
});
test.after(async () => {
    if (db) await db.end();
});
async function fixture() {
    return users.createUserWithStarter('release_' + randomUUID(), 'Release-test-password-2026', {
        starterId: 7,
        sprite: 'sprite.png',
    });
}
test(
    'opening prerequisites, archived continuation and concurrent rewards remain safe for legacy saves',
    { skip: !enabled },
    async () => {
        const u = await fixture(), legacy = await fixture();
        try {
            assert.equal((await progress.completeNpcBattle(u.id,'aspha_route2')).reason,'requirements_not_met');
            await progress.completeNpcBattle(u.id,'dia1');
            const before=await progress.loadProgressState(u.id);
            const results=await Promise.all([progress.completeNpcBattle(u.id,'aspha_route2'),progress.completeNpcBattle(u.id,'aspha_route2')]);
            assert.equal(results.filter(r=>r.granted).length,1);
            const done=await progress.loadProgressState(u.id);assert.equal(done.money,before.money+1200);
            assert.equal(done.quests.find(q=>q.key==='main_sister_search').progress,2);
            await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES (?,'chapter1_complete','true')",[u.id]);
            for(const name of ['ch2_iris','ch2_nora','ch2_clara','refuge_lyse','refuge_abel']) assert.equal((await progress.completeStoryEvent(u.id,name)).granted,false);
            assert.equal((await progress.loadProgressState(u.id)).quests.some(q=>q.key==='clara_chapter2'),false);
            // Old Mounir wins imply the missing early encounter, with no new reward/receipt or loss of badges.
            await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES (?,'moonpunch_defeated','true')",[legacy.id]);
            await db.execute("INSERT INTO player_badges(user_id,badge_key) VALUES (?,'crystal_badge')",[legacy.id]);
            const old=await progress.loadProgressState(legacy.id);
            assert.equal(old.quests.find(q=>q.key==='main_sister_search').progress,3);
            assert.equal(old.quests.find(q=>q.key==='first_challenge').status,'completed');
            assert.equal(await progress.isNpcBattleCompleted(legacy.id,'aspha_route2'),true);
            assert.equal((await progress.completeNpcBattle(legacy.id,'aspha_route2')).reason,'already_completed');
            const retained=await progress.loadProgressState(legacy.id);assert.equal(retained.money,old.money);assert(!retained.badges.some(b=>b.key==='crystal_badge'));assert.equal((await db.execute("SELECT COUNT(*) AS n FROM player_badges WHERE user_id=? AND badge_key='crystal_badge'",[legacy.id]))[0][0].n,1);
            assert.equal(retained.completedNpcBattles.length,0);assert.equal(retained.flags.aspha_route2_defeated,undefined);
        } finally {
            for(const u_ of [u,legacy]) await db.execute('DELETE FROM users WHERE id=?',[u_.id]);
        }
    }
);
test(
    'cosmetics double click charges once, ownership enforced, balance never negative',
    { skip: !enabled },
    async () => {
        const u = await fixture();
        try {
            await db.execute('INSERT INTO rift_profiles(user_id,coins) VALUES (?,100)', [u.id]);
            await Promise.all([
                collection.purchase(u.id, 'frame_forest'),
                collection.purchase(u.id, 'frame_forest'),
            ]);
            const [[p]] = await db.execute('SELECT coins FROM rift_profiles WHERE user_id=?', [u.id]);
            assert.equal(Number(p.coins), 0);
            await assert.rejects(() => collection.purchase(u.id, 'title_scout'), /Pas assez/);
            await assert.rejects(() => collection.equip(u.id, 'title', 'title_star'), /appartient/);
            await collection.equip(u.id, 'frame', 'frame_forest');
            assert.equal((await collection.collection(u.id)).appearance.frame_key, 'frame_forest');
            await collection.equip(u.id, 'frame', null);
            assert.equal((await collection.collection(u.id)).appearance.frame_key, null);
        } finally {
            await db.execute('DELETE FROM users WHERE id=?', [u.id]);
        }
    }
);
test('medicine no-effect and ownership failures do not consume inventory', { skip: !enabled }, async () => {
    const u = await fixture(),
        v = await fixture();
    try {
        const team = await teams.loadEquipe(u.id),
            p = team.pokemons[0];
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,'potion',1)", [u.id]);
        await assert.rejects(() => medicine.useMedicine(u.id, p, 'potion'), /aucun effet/);
        p.currentHp = 1;
        await teams.editEquipe(u.id, team);
        await assert.rejects(() => medicine.useMedicine(v.id, p, 'potion'), /appartient/);
        const healed = await medicine.useMedicine(u.id, p, 'potion');
        assert(healed.currentHp > 1);
        await assert.rejects(() => medicine.useMedicine(u.id, p, 'potion'), /plus dans/);
        const stored = await teams.loadEquipe(u.id);
        assert.equal(stored.pokemons[0].currentHp, healed.currentHp);
        const { loadUserItems } = require('../server/persistence/itemRepository');
        const berry = (await loadUserItems(u.id)).find(i => i.key === 'oran_berry');
        assert.equal(berry.fieldUse.heal, 10);
        p.currentHp = 1;await teams.editEquipe(u.id, team);
        const berryResult = await medicine.useMedicine(u.id, p, 'oran_berry');
        assert.equal(berryResult.currentHp, 11);
        assert.equal((await loadUserItems(u.id)).find(i=>i.key==='oran_berry').quantity, berry.quantity - 1);
        assert.equal((await teams.loadEquipe(u.id)).pokemons[0].currentHp, 11);
    } finally {
        await db.execute('DELETE FROM users WHERE id IN (?,?)', [u.id, v.id]);
    }
});

test('level-up choices persist and are owned, atomic, replay-safe and blocked during battle', { skip: !enabled }, async () => {
    const { learnMove } = require('../server/persistence/moveLearningRepository');
    const { registerMoveLearningHandlers } = require('../server/realtime/handlers/moveLearningHandlers');
    const factory = require('../server/game/drift/pokemonFactory');
    const u = await fixture(), v = await fixture();
    try {
        const pokemon = factory.create(1,5);
        pokemon.gainExperience(pokemon.getNextLevelExpForLevel(14)-pokemon.experience);
        pokemon.movePp=[1,2,3,4];await teams.editEquipe(u.id,{pokemons:[pokemon]});
        const loaded=(await teams.loadEquipe(u.id)).pokemons[0];assert.deepEqual(loaded.pendingMoves,pokemon.pendingMoves);
        const choice={pokemonUuid:loaded.uuid,choiceId:loaded.pendingMoves[0].id,slot:0};
        await assert.rejects(()=>learnMove(v.id,loaded.uuid,choice),/appartient/);
        const p={equipe:{pokemons:[loaded]},inbattle:true}, handlers={};
        registerMoveLearningHandlers({socket:{on:(name,fn)=>handlers[name]=fn,emit(){}},userId:u.id,getPlayer:()=>p});
        const command=data=>new Promise(resolve=>handlers.learnMove(data,resolve));
        assert.equal((await command(choice)).success,false);p.inbattle=false;
        const answers=await Promise.all([command(choice),command(choice)]);assert.equal(answers.filter(a=>a.success).length,1);
        const fresh=(await teams.loadEquipe(u.id)).pokemons[0];
        assert.equal(fresh.abilities[0],'Leech Seed');assert.deepEqual(fresh.movePp.slice(1),[2,3,4]);assert.equal(fresh.pendingMoves.length,2);
        await assert.rejects(()=>learnMove(u.id,loaded.uuid,choice),/plus disponible/);
        const next={choiceId:fresh.pendingMoves[0].id,slot:null};
        const concurrent=await Promise.allSettled([learnMove(u.id,loaded.uuid,next),learnMove(u.id,loaded.uuid,next)]);
        assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
        assert.equal((await teams.loadEquipe(u.id)).pokemons[0].pendingMoves[0].move,'Sleep Powder');
    } finally { await db.execute('DELETE FROM users WHERE id IN (?,?)',[u.id,v.id]); }
});


test('evolution choices are owned, atomic and persistent, including legacy XP curves and Pokedex', {skip:!enabled}, async()=>{
    const a=await fixture(),b=await fixture();
    const factory=require('../server/game/drift/pokemonFactory');
    const {evolvePokemon}=require('../server/persistence/evolutionRepository');
    try {
        const eevee=factory.create(133,30);eevee.name='Compagnon';eevee.currentHp-=8;eevee.heldItem='leftovers';eevee.movePp[0]=1;
        await teams.editEquipe(a.id,{pokemons:[eevee]});const choice={fromSpeciesId:133,targetId:196};
        await assert.rejects(()=>evolvePokemon(b.id,eevee.uuid,choice),/appartient/);
        await assert.rejects(()=>evolvePokemon(a.id,eevee.uuid,{...choice,targetId:150}),/conditions/);
        const outcomes=await Promise.allSettled([evolvePokemon(a.id,eevee.uuid,choice),evolvePokemon(a.id,eevee.uuid,{...choice,targetId:197})]);
        assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
        const restored=(await teams.loadEquipe(a.id)).pokemons[0];assert([196,197].includes(restored.data.id));assert.equal(restored.uuid,eevee.uuid);assert.equal(restored.experience,eevee.experience);assert.equal(restored.level,30);assert.equal(restored.maxHp-restored.currentHp,8);assert.equal(restored.name,'Compagnon');assert.equal(restored.heldItem,'leftovers');assert.equal(restored.movePp[0],1);
        await assert.rejects(()=>evolvePokemon(a.id,eevee.uuid,choice),/plus disponible/);
        assert((await progress.loadPokedex(a.id)).entries.find(p=>p.id===restored.data.id).caught);
        for(const [id,to,level] of [[183,184,18],[316,317,26],[318,319,30]]) {
            const p=factory.create(id,level);await teams.editEquipe(a.id,{pokemons:[p]});
            // A pre-patch row has no curve override; migration leaves its old level intact.
            await db.execute('UPDATE pokemons SET experience_rate=NULL WHERE uuid=?',[p.uuid]);
            const legacy=(await teams.loadEquipe(a.id)).pokemons[0];assert.equal(legacy.level,level);
            await evolvePokemon(a.id,p.uuid,{fromSpeciesId:id,targetId:to});
            const saved=(await teams.loadEquipe(a.id)).pokemons[0];assert.equal(saved.level,level);assert.equal(saved.experience,p.experience);assert.equal(saved.experienceRate,p.experienceRate);
        }
        const salamander=factory.create(4,15);salamander.gainExperience(salamander.getNextLevelExpForLevel(36)-salamander.experience);assert.equal(salamander.data.id,6);
        await teams.editEquipe(a.id,{pokemons:[salamander]});assert.equal((await teams.loadEquipe(a.id)).pokemons[0].data.id,6);
        salamander.currentHp=0;salamander.updatePokemon(4);await teams.editEquipe(a.id,{pokemons:[salamander]});
        await assert.rejects(()=>evolvePokemon(a.id,salamander.uuid,{fromSpeciesId:4,targetId:5}),/conditions/);
        assert.equal((await teams.loadEquipe(b.id)).pokemons[0].data.id,7);
    } finally {await db.execute('DELETE FROM users WHERE id IN (?,?)',[a.id,b.id]);}
});

test('automatic team order persists the live roster, resources and following save', {skip:!enabled}, async()=>{
    const u=await fixture();
    try {
        const team=await teams.loadEquipe(u.id);
        const second=require('../server/game/drift/pokemonFactory').create(19,5);
        team.pokemons.push(second);await teams.editEquipe(u.id,team);
        const original=team.pokemons.map(p=>p.uuid),ids=[...original].reverse(),hp=team.pokemons[0].currentHp;
        const handlers={},player={equipe:team};
        require('../server/realtime/handlers/teamOrderHandlers').registerTeamOrderHandlers({socket:{on:(n,fn)=>handlers[n]=fn,emit(){}},userId:u.id,getPlayer:()=>player});
        let result;await handlers.reorderTeam({orderedUuids:ids},r=>result=r);assert.equal(result.success,true);
        assert.deepEqual((await teams.loadEquipe(u.id)).pokemons.map(p=>p.uuid),ids);
        await teams.editEquipe(u.id,player.equipe);
        const saved=await teams.loadEquipe(u.id);assert.deepEqual(saved.pokemons.map(p=>p.uuid),ids);assert.equal(saved.pokemons[1].currentHp,hp);
    } finally {await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});

test('Moonpunch badge: retroactive recorded wins only, original dates, no reward replay and concurrent idempotence', {skip:!enabled}, async()=>{
 const fresh=await fixture(),receipt=await fixture(),legacy=await fixture(),inferred=await fixture();
 try{
  for(const u of [fresh,receipt,legacy,inferred])await db.execute('UPDATE users SET money=321 WHERE id=?',[u.id]);
  await db.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json,completed_at)VALUES(?,'moonpunch_ville1','moon','{\"money\":1800}','2026-01-02 12:00:00')",[receipt.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value,updated_at)VALUES(?,'moonpunch_defeated','true','2026-01-03 12:00:00')",[legacy.id]);
  await db.execute("INSERT INTO player_badges(user_id,badge_key)VALUES(?,'crystal_badge')",[legacy.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'moonpunch_defeated','false'),(?,'hoze_defeated','true')",[inferred.id,inferred.id]);
  const earned=state=>state.badges.find(b=>b.key==='lake_badge').earned;
  assert.equal(earned(await progress.loadProgressState(fresh.id)),false);assert.equal(earned(await progress.loadProgressState(inferred.id)),false,'an inferred prerequisite is not a recorded Moonpunch win');
  const reads=await Promise.all([progress.loadProgressState(receipt.id),progress.loadProgressState(receipt.id),progress.loadProgressState(legacy.id)]);assert(reads.every(earned));assert(reads.every(s=>s.money===321));assert.equal(reads[0].flags.moonpunch_defeated,undefined,'receipt repair does not fabricate story flags');assert(!reads[2].badges.some(b=>b.key==='crystal_badge'));assert.equal((await db.execute("SELECT COUNT(*) AS n FROM player_badges WHERE user_id=? AND badge_key='crystal_badge'",[legacy.id]))[0][0].n,1);
  const [[r]]=await db.execute("SELECT COUNT(*) AS n,MIN(awarded_at='2026-01-02 12:00:00') AS originalDate FROM player_badges WHERE user_id=? AND badge_key='lake_badge'",[receipt.id]);assert.equal(r.n,1);assert.equal(r.originalDate,1);
  const [[l]]=await db.execute("SELECT awarded_at='2026-01-03 12:00:00' AS originalDate FROM player_badges WHERE user_id=? AND badge_key='lake_badge'",[legacy.id]);assert.equal(l.originalDate,1);
  assert.equal(await progress.reconcileMoonpunchBadge(receipt.id),0);assert.equal((await progress.loadProgressState(receipt.id)).completedNpcBattles.length,1);assert.equal((await progress.loadProgressState(legacy.id)).completedNpcBattles.length,0);
  await db.execute("UPDATE player_badges SET awarded_at='2025-01-01 12:00:00' WHERE user_id=? AND badge_key='lake_badge'",[receipt.id]);await progress.loadProgressState(receipt.id);const [[keep]]=await db.execute("SELECT awarded_at='2025-01-01 12:00:00' AS originalDate FROM player_badges WHERE user_id=? AND badge_key='lake_badge'",[receipt.id]);assert.equal(keep.originalDate,1);
 }finally{for(const u of [fresh,receipt,legacy,inferred])await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});

test('wild items SQL: concurrent unique receipts, bag/held/PC exclusion and permanent history after consumption', {skip:!enabled}, async()=>{
    const u=await fixture();
    try {
        const loot=require('../server/persistence/wildLootRepository'),factory=require('../server/game/drift/pokemonFactory');
        const pc=require('../server/persistence/pokemonStorageRepository');
        const team=await teams.loadEquipe(u.id);team.pokemons[0].heldItem='leftovers';await teams.editEquipe(u.id,team);
        const stored=factory.create(25,20,true);stored.heldItem='life_orb';await pc.storeCapturedPokemon(u.id,stored);
        const draws=(...values)=>()=>values.shift() ?? .5;
        assert.equal(require('../server/game/items/wildLoot').ADVENTURE_CHANCE,1/15);
        assert.equal(await loot.awardWildLoot(u.id,()=>1/15),null);
        assert.equal((await loot.awardWildLoot(u.id,draws(1/15-1e-8,0,0))).wildLoot.group,'berries');
        assert.equal((await loot.awardWildLoot(u.id,draws(.04,0,0))).wildLoot.group,'berries');
        const found=await Promise.all([loot.awardWildLoot(u.id,draws(0,.85,0)),loot.awardWildLoot(u.id,draws(0,.85,0))]);
        assert.equal(new Set(found.map(i=>i.key)).size,2);assert(found.every(i=>!['leftovers','life_orb'].includes(i.key)));
        const one=found[0].key;await db.execute('UPDATE user_items SET quantity=0 WHERE user_id=? AND item_key=?',[u.id,one]);
        const next=await loot.awardWildLoot(u.id,draws(0,.85,0));assert.notEqual(next.key,one);
        const exp=await loot.awardWildLoot(u.id,draws(0,.99,0));assert.equal(exp.key,'exp_share');assert(await loot.hasExpShare(u.id));
        await db.execute("DELETE FROM user_items WHERE user_id=? AND item_key='exp_share'",[u.id]);
        assert.notEqual((await loot.awardWildLoot(u.id,draws(0,.99,0))).key,'exp_share');
        const [[duplicates]]=await db.execute('SELECT COUNT(*) AS n,COUNT(DISTINCT item_key) AS distinctN FROM user_item_discoveries WHERE user_id=?',[u.id]);assert.equal(duplicates.n,duplicates.distinctN);assert(duplicates.n>=6);
        const {purchaseUserItem}=require('../server/persistence/itemRepository');
        for(const key of ['exp_share','calcium','life_orb','yache_berry'])assert.equal((await purchaseUserItem(u.id,key,1,{mapName:'ville1_shop'})).reason,'item_unavailable');
        assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,'leftovers');
    } finally {await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});

test('vitamins SQL: authoritative concurrent +10 EV, partial cap, no-effect rollback, PP and stats persist', {skip:!enabled}, async()=>{
    const u=await fixture(),other=await fixture();
    try {
        const team=await teams.loadEquipe(u.id),p=team.pokemons[0];
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'calcium',3),(?,'hondew_berry',1),(?,'leppa_berry',2)",[u.id,u.id,u.id]);
        await assert.rejects(()=>medicine.useMedicine(other.id,p,'calcium'),/appartient/);
        await Promise.all([medicine.useMedicine(u.id,p,'calcium'),medicine.useMedicine(u.id,p,'calcium')]);
        let saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.equal(saved.ev.specialAttack,20);assert.equal(p.ev.specialAttack,0,'repository does not mutate caller before transaction acknowledgement');
        saved.ev.specialAttack=250;team.pokemons=[saved];await teams.editEquipe(u.id,team);
        const cap=await medicine.useMedicine(u.id,p,'calcium');assert.equal(cap.ev.specialAttack,252);
        await db.execute("UPDATE user_items SET quantity=1 WHERE user_id=? AND item_key='calcium'",[u.id]);
        await assert.rejects(()=>medicine.useMedicine(u.id,p,'calcium'),/aucun effet/);
        const [[stock]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='calcium'",[u.id]);assert.equal(stock.quantity,1);
        const reset=await medicine.useMedicine(u.id,p,'hondew_berry');assert.equal(reset.ev.specialAttack,242);
        saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.equal(saved.specialAttack,reset.specialAttack);
        saved.movePp[0]=0;team.pokemons=[saved];await teams.editEquipe(u.id,team);
        const pp=await medicine.useMedicine(u.id,saved,'leppa_berry');assert.equal(pp.movePp[0],10);assert.equal((await teams.loadEquipe(u.id)).pokemons[0].movePp[0],10);
    } finally {for(const u2 of [u,other])await db.execute('DELETE FROM users WHERE id=?',[u2.id]);}
});

test('Adventure stones: Goupix compatibility, purchase, ownership, KO, duplicate requests and persistent evolution', {skip:!enabled}, async()=>{
    const a=await fixture(),b=await fixture(),items=require('../server/persistence/itemRepository');
    const {evolvePokemonWithStone:use}=require('../server/persistence/evolutionRepository');
    const factory=require('../server/game/drift/pokemonFactory');
    try {
        const fox=factory.create(37,15),squirtle=factory.create(7,5),ko=factory.create(37,5);ko.currentHp=0;
        fox.name='Flamme';fox.currentHp-=7;fox.status='poison';fox.heldItem='leftovers';fox.movePp[0]=1;
        await teams.editEquipe(a.id,{pokemons:[squirtle,fox,ko]});
        await db.execute('UPDATE users SET money=100000 WHERE id=?',[a.id]);
        await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[a.id]);
        const bought=await items.purchaseUserItem(a.id,'fire_stone',2,{mapName:'tour_rdc'});
        assert(bought.success);assert.deepEqual(bought.items.find(i=>i.key==='fire_stone').evolutions,{[fox.uuid]:{id:38,name:'Feunard'}});
        await assert.rejects(use(b.id,fox.uuid,'fire_stone'),/appartient/);
        await assert.rejects(use(a.id,squirtle.uuid,'fire_stone'),/convient/);
        await assert.rejects(use(a.id,ko.uuid,'fire_stone'),/Soigne/);
        await assert.rejects(use(a.id,fox.uuid,'potion'),/pierre/);
        assert.equal((await items.loadUserItems(a.id)).find(i=>i.key==='fire_stone').quantity,2);
        const results=await Promise.allSettled([use(a.id,fox.uuid,'fire_stone'),use(a.id,fox.uuid,'fire_stone')]);
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        const saved=(await teams.loadEquipe(a.id)).pokemons;
        assert.deepEqual(saved.map(p=>p.uuid),[squirtle.uuid,fox.uuid,ko.uuid]);
        const evolved=saved[1];assert.equal(evolved.data.id,38);assert.equal(evolved.name,'Flamme');assert.equal(evolved.level,15);
        assert.equal(evolved.experience,fox.experience);assert.equal(evolved.k,fox.k);assert.deepEqual(evolved.iv,fox.iv);assert.deepEqual(evolved.ev,fox.ev);
        assert.equal(evolved.maxHp-evolved.currentHp,7);assert.equal(evolved.status,'poison');assert.equal(evolved.heldItem,'leftovers');
        assert.deepEqual(evolved.abilities,fox.abilities);assert.deepEqual(evolved.movePp,fox.movePp);assert(evolved.specialAttack>fox.specialAttack);
        assert((await progress.loadPokedex(a.id)).entries.find(p=>p.id===38).caught);
        const stone=(await items.loadUserItems(a.id)).find(i=>i.key==='fire_stone');assert.equal(stone.quantity,1);assert.deepEqual(stone.evolutions,{});
    } finally {await db.execute('DELETE FROM users WHERE id IN (?,?)',[a.id,b.id]);}
});

test('Adventure stones: missing inventory and SQL failure roll back species, stock and Pokedex together', {skip:!enabled}, async()=>{
    const a=await fixture(),factory=require('../server/game/drift/pokemonFactory');
    const {evolvePokemonWithStone:use}=require('../server/persistence/evolutionRepository');
    const sync=progress.synchronizeCaughtPokemon;
    try {
        const fox=factory.create(37,5);await teams.editEquipe(a.id,{pokemons:[fox]});
        await assert.rejects(use(a.id,fox.uuid,'fire_stone'),/sac/);
        assert.equal((await teams.loadEquipe(a.id)).pokemons[0].data.id,37);
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,'fire_stone',1)",[a.id]);
        progress.synchronizeCaughtPokemon=async()=>{throw Error('Injected persistence failure');};
        await assert.rejects(use(a.id,fox.uuid,'fire_stone'),/Injected/);
        progress.synchronizeCaughtPokemon=sync;
        assert.equal((await teams.loadEquipe(a.id)).pokemons[0].data.id,37);
        assert.equal((await require('../server/persistence/itemRepository').loadUserItems(a.id)).find(i=>i.key==='fire_stone').quantity,1);
        assert(!(await progress.loadPokedex(a.id)).entries.find(p=>p.id===38).caught);
        const result=await use(a.id,fox.uuid,'fire_stone');assert.equal(result.pokemon.data.id,38);assert(!result.items.some(i=>i.key==='fire_stone'));
    } finally {progress.synchronizeCaughtPokemon=sync;await db.execute('DELETE FROM users WHERE id=?',[a.id]);}
});

test('Hoze Multi Exp: victory reward, legacy repair, no premature grant and concurrent idempotence including held/PC copies', {skip:!enabled}, async()=>{
 const ids=[];
 try {
  const {reconcileHozeExpShare}=require('../server/persistence/hozeRewardRepository');
  for(const location of ['new','legacy','bag','held','pc']){
   const u=await fixture();ids.push(u.id);await progress.loadProgressState(u.id);
   let [[r]]=await db.execute("SELECT COALESCE(SUM(quantity),0) n FROM user_items WHERE user_id=? AND item_key='exp_share'",[u.id]);assert.equal(Number(r.n),0);
   if(location==='bag')await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'exp_share',1)",[u.id]);
   if(location==='held'){const t=await teams.loadEquipe(u.id);t.pokemons[0].heldItem='exp_share';await teams.editEquipe(u.id,t);}
   if(location==='pc'){const p=require('../server/game/drift/pokemonFactory').create(25,20,true);p.heldItem='exp_share';await require('../server/persistence/pokemonStorageRepository').storeCapturedPokemon(u.id,p);}
   if(location==='new'){
    await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'moonpunch_defeated','true')",[u.id]);
    const results=await Promise.all([progress.completeNpcBattle(u.id,'champion_hoze'),progress.completeNpcBattle(u.id,'champion_hoze')]);assert.equal(results.filter(r=>r.granted).length,1);
   }else await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[u.id]);
   await Promise.all([reconcileHozeExpShare(u.id),reconcileHozeExpShare(u.id),progress.loadProgressState(u.id)]);
   [[r]]=await db.execute("SELECT COALESCE(SUM(quantity),0) n FROM user_items WHERE user_id=? AND item_key='exp_share'",[u.id]);assert.equal(Number(r.n),['held','pc'].includes(location)?0:1,location);
   const [[receipt]]=await db.execute("SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key='hoze_exp_share_received'",[u.id]);assert.equal(receipt.n,1);
   const t=await teams.loadEquipe(u.id);
   if(!['held','pc'].includes(location)){
    const {equipHeldItem}=require('../server/persistence/itemRepository');
    const [[teamRow]]=await db.execute('SELECT id FROM teams WHERE user_id=?',[u.id]);
    const equipped=await equipHeldItem(u.id,teamRow.id,t.pokemons[0].uuid,'exp_share');assert.equal(equipped,'exp_share');
    assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,'exp_share');
   }
  }
 }finally{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);}
});

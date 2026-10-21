const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const shouldRun = process.env.RUN_MYSQL_TESTS === '1';
const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;

test.after(async () => {
    if (!shouldRun) return;
    const { dbPool } = require('../server/config/database');
    await dbPool.end();
});

function createTestPool() {
    if (!/test/i.test(testDatabaseName)) {
        throw new Error('DB_TEST_NAME doit contenir « test » pour protéger la base de jeu.');
    }
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: testDatabaseName,
        connectionLimit: 2
    });
}

test('les tables critiques MySQL utilisent InnoDB', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    try {
        const [rows] = await pool.query(
            `SELECT TABLE_NAME, ENGINE
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN (
                 'users', 'teams', 'pokemons', 'user_items', 'player_story_flags',
                 'player_quests', 'player_badges', 'user_pokedex', 'user_npc_battles'
               )`
        );
        assert.equal(rows.length, 9);
        for (const row of rows) assert.equal(row.ENGINE, 'InnoDB');
    } finally {
        await pool.end();
    }
});

test("l'onboarding peut être entièrement annulé par une transaction", { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    const connection = await pool.getConnection();
    const username = `rollback_${Date.now()}`;
    try {
        await connection.beginTransaction();
        const [userResult] = await connection.execute(
            'INSERT INTO users (username, password_hash, x, y, map, sprite) VALUES (?, ?, 80, 208, ?, ?)',
            [username, 'test-hash', 'start', 'sprite.png']
        );
        await connection.execute(
            'INSERT INTO teams (user_id, team_name) VALUES (?, ?)',
            [userResult.insertId, 'Équipe de test']
        );
        await connection.rollback();

        const [rows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
        assert.equal(rows.length, 0);
    } finally {
        try { await connection.rollback(); } catch (error) { /* transaction déjà fermée */ }
        connection.release();
        await pool.end();
    }
});

test('le parcours réel crée, authentifie et sauvegarde un nouveau dresseur', { skip: !shouldRun }, async () => {
    const {
        authenticateUser,
        awardUserMoney,
        createUserWithStarter
    } = require('../server/persistence/userRepository');
    const {
        editEquipe,
        getTeamPokemons,
        getTeamRecord,
        loadEquipe
    } = require('../server/persistence/teamRepository');
    const { loadUserItems, purchaseUserItem } = require('../server/persistence/itemRepository');
    const {
        loadUserPosition,
        saveUserRespawnPoint
    } = require('../server/persistence/playerRepository');
    const {
        completeNpcBattle,
        loadPokedex,
        loadProgressState
    } = require('../server/persistence/progressionRepository');

    const pool = createTestPool();
    const username = `integration_${Date.now()}`;
    let userId = null;
    try {
        const user = await createUserWithStarter(username, 'mot-de-passe-test', {
            starterId: 4,
            sprite: 'sprite2.png'
        });
        userId = user.id;

        const authenticated = await authenticateUser(username, 'mot-de-passe-test');
        assert.equal(authenticated.id, userId);

        const [userRows] = await pool.execute(
            'SELECT password_hash, sprite, money FROM users WHERE id = ?',
            [userId]
        );
        assert.match(userRows[0].password_hash, /^\$2[aby]\$/);
        assert.notEqual(userRows[0].password_hash, 'mot-de-passe-test');
        assert.equal(userRows[0].sprite, 'sprite2.png');
        assert.equal(Number(userRows[0].money), 0);
        await awardUserMoney(userId, 250);
        const [[moneyRow]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);
        assert.equal(Number(moneyRow.money), 250);

        const teamRecord = await getTeamRecord(userId);
        const pokemonRows = await getTeamPokemons(teamRecord.id);
        assert.equal(pokemonRows.length, 1);
        assert.equal(pokemonRows[0].pokemon_id, 4);
        assert.equal(pokemonRows[0].level, 5);
        assert.equal(pokemonRows[0].experience, 64);
        assert([1,2,3,4].includes(pokemonRows[0].k));

        const items = await loadUserItems(userId);
        assert.deepEqual(items.map((item) => [item.key, item.quantity]), [
            ['hyperball', 2],
            ['oran_berry', 2],
            ['pokeball', 10],
            ['superball', 5]
        ]);

        const initialPokedex = await loadPokedex(userId);
        assert.equal(initialPokedex.seen, 1);
        assert.equal(initialPokedex.caught, 1);
        assert.equal(initialPokedex.entries.find((entry) => entry.id === 4)?.caught, true);

        const initialProgress = await loadProgressState(userId);
        assert.equal(initialProgress.flags.starter_chosen, 'true');
        assert.equal(initialProgress.quests.find((quest) => quest.key === 'first_challenge')?.status, 'active');

        const firstReward = await completeNpcBattle(userId, 'dia1');
        const duplicateReward = await completeNpcBattle(userId, 'dia1');
        assert.equal(firstReward.granted, true);
        assert.equal(firstReward.money, 900);
        assert.equal(duplicateReward.granted, false);
        assert.equal(duplicateReward.reason, 'already_completed');
        assert.equal(firstReward.progress.quests.find((quest) => quest.key === 'first_challenge')?.status, 'completed');

        const [[rewardMoneyRow]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);
        assert.equal(Number(rewardMoneyRow.money), 1150);

        const purchase = await purchaseUserItem(userId, 'pokeball', 2);
        assert.equal(purchase.success, true);
        assert.equal(purchase.totalPrice, 300);
        assert.equal(purchase.money, 850);
        assert.equal(purchase.items.find((item) => item.key === 'pokeball')?.quantity, 12);
        const refusedPurchase = await purchaseUserItem(userId, 'hyperball', 1);
        assert.equal(refusedPurchase.success, false);
        assert.equal(refusedPurchase.reason, 'insufficient_funds');
        const [[moneyAfterPurchase]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);
        assert.equal(Number(moneyAfterPurchase.money), 850);

        const team = await loadEquipe(userId);
        const originalUuid = team.pokemons[0].uuid;
        team.pokemons[0].currentHp = Math.max(1, team.pokemons[0].currentHp - 1);
        team.pokemons[0].status = 'burn';
        team.pokemons[0].passiveAbility = 'Blaze';
        team.pokemons[0].heldItem = 'oran_berry';
        team.pokemons[0].movePp[0] -= 1;
        team.pokemons[0].gainEffort({ attack: 252, speed: 252, hp: 6 });
        const expectedHp = team.pokemons[0].currentHp;
        const expectedPp = team.pokemons[0].movePp[0];
        await editEquipe(userId, team);
        const reloadedTeam = await loadEquipe(userId);
        assert.equal(reloadedTeam.pokemons[0].uuid, originalUuid);
        assert.equal(reloadedTeam.pokemons[0].currentHp, expectedHp);
        assert.deepEqual(reloadedTeam.pokemons[0].ev, team.pokemons[0].ev);
        assert.equal(Object.values(reloadedTeam.pokemons[0].ev).reduce((a, b) => a + b, 0), 510);
        assert.equal(reloadedTeam.pokemons[0].status, 'burn');
        assert.equal(reloadedTeam.pokemons[0].passiveAbility, 'Blaze');
        assert.equal(reloadedTeam.pokemons[0].heldItem, 'oran_berry');
        assert.equal(reloadedTeam.pokemons[0].movePp[0], expectedPp);

        const centerCheckpoint = { map: 'centre', x: 304, y: 432 };
        await saveUserRespawnPoint(userId, centerCheckpoint);
        const savedPosition = await loadUserPosition(userId);
        assert.deepEqual(savedPosition.respawnPoint, centerCheckpoint);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('le chapitre suit les victoires, résiste aux doublons et reprend les anciennes sauvegardes', { skip: !shouldRun }, async () => {
    const { createUserWithStarter } = require('../server/persistence/userRepository');
    const { completeNpcBattle, completeStoryEvent, loadProgressState } = require('../server/persistence/progressionRepository');
    const { getSentenceForName } = require('../server/game/world/interactionRepository');
    const pool = createTestPool();
    let userId;
    const main = (state) => state.quests.find((quest) => quest.key === 'main_sister_search');
    try {
        userId = (await createUserWithStarter(`story_${Date.now()}`, 'mot-de-passe-test', { starterId: 7 })).id;
        // Reproduire une sauvegarde issue de l'ancien bug Dune -> quête terminée avec un seul badge.
        await pool.execute("UPDATE player_quests SET status = 'completed', progress = 5, completed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND quest_key = 'main_sister_search'", [userId]);
        await pool.execute("INSERT INTO player_badges (user_id, badge_key) VALUES (?, 'dune_badge')", [userId]);
        await pool.execute("INSERT INTO user_npc_battles (user_id, battle_key, dialogue_name, reward_json) VALUES (?, 'gym_ocreville_champion', 'gym_dune', '{}')", [userId]);
        const legacy = await loadProgressState(userId);
        assert.equal(main(legacy).status, 'active');
        assert.equal(main(legacy).progress, 0);
        assert.equal(main(legacy).completedAt, null);
        assert.equal(legacy.badges.find((badge) => badge.key === 'dune_badge').earned, true);
        assert.equal((await completeNpcBattle(userId, 'champion_wanda')).reason, 'requirements_not_met');
        assert.equal((await completeStoryEvent(userId, 'clara_letter')).reason, 'requirements_not_met');
        assert.equal((await completeNpcBattle(userId, 'gym_dune')).reason, 'unknown_battle');
        const town = await completeNpcBattle(userId, 'town_lina');
        assert.equal(town.granted, true);
        assert.equal(main(town.progress).progress, 0);
        let expectedMoney = 225;
        const chain = ['dia1','aspha_route2','moon','champion_hoze','champion_raphael','champion_ana','champion_wanda'];
        for (const [index,name] of chain.entries()) {
            const before = await loadProgressState(userId);
            assert.equal(getSentenceForName(name,before)[1],name);
            const results = await Promise.all([completeNpcBattle(userId,name),completeNpcBattle(userId,name)]);
            assert.equal(results.filter(result=>result.granted).length,1);
            expectedMoney += results.find(result=>result.granted).money;
            const reloaded = await loadProgressState(userId);
            assert.equal(main(reloaded).progress,index+1);
            assert.equal(main(reloaded).status,index===chain.length-1?'completed':'active');
            assert.equal(reloaded.money,expectedMoney);
            assert.equal(getSentenceForName(name,reloaded)[1],`${name}_after`);
            assert.equal((await completeStoryEvent(userId,'clara_letter')).granted,false);
        }
        await completeNpcBattle(userId,'town_lina');
        const final = await loadProgressState(userId);
        assert.equal(main(final).status,'completed');assert.equal(main(final).progress,7);assert.ok(main(final).completedAt);
        assert.equal(final.badges.filter(b=>b.earned).length,5);assert.equal(final.money,expectedMoney);
        assert.equal(final.quests.some(q=>['clara_chapter2','refuges','valpierre_passage'].includes(q.key)),false);
        assert.equal((await completeNpcBattle(userId,'champion_raphael')).granted,false);
        const [[stored]] = await pool.execute("SELECT status, progress FROM player_quests WHERE user_id = ? AND quest_key = 'main_sister_search'",[userId]);
        assert.equal(stored.status,'completed');assert.equal(stored.progress,7);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('Repousse SQL : achat, activation atomique, anti-cumul et compteur sauvegardé sans perte de stock', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let id;
 try{
  const [created]=await pool.execute('INSERT INTO users(username,password_hash,money) VALUES(?,?,?)',[`repel_${Date.now()}`,'test',5000]);id=created.insertId;
  const {purchaseUserItem,loadUserItems}=require('../server/persistence/itemRepository');
  const {useRepel}=require('../server/persistence/repelRepository');
  const {loadUserPosition,saveUserPosition}=require('../server/persistence/playerRepository');
  for(const key of ['repel','super_repel','max_repel'])assert((await purchaseUserItem(id,key,2)).success);
  assert.equal((await loadUserItems(id)).find(i=>i.key==='max_repel').repelSteps,250);
  const activations=await Promise.allSettled([useRepel(id,'repel'),useRepel(id,'repel')]);
  assert.equal(activations.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await loadUserPosition(id)).repel_steps,100);assert.equal((await loadUserItems(id)).find(i=>i.key==='repel').quantity,1);
  await assert.rejects(useRepel(id,'super_repel'),/déjà actif/);
  await saveUserPosition(id,{x:80,y:208,map:'start',repelSteps:73});assert.equal((await loadUserPosition(id)).repel_steps,73);
  await saveUserPosition(id,{x:80,y:208,map:'start',repelSteps:99});assert.equal((await loadUserPosition(id)).repel_steps,73,'position saves cannot extend a protection');
  await saveUserPosition(id,{x:112,y:208,map:'start'});assert.equal((await loadUserPosition(id)).repel_steps,73,'legacy callers preserve the effect');
  await saveUserPosition(id,{x:112,y:208,map:'start',repelSteps:0});assert.equal(await useRepel(id,'max_repel'),250);
  await saveUserPosition(id,{x:112,y:208,map:'start',repelSteps:0});
  await pool.execute("DELETE FROM user_items WHERE user_id=? AND item_key='max_repel'",[id]);
  await assert.rejects(useRepel(id,'max_repel'),/sac/);assert.equal((await loadUserPosition(id)).repel_steps,0);
  await assert.rejects(useRepel(id,'potion'),/Repousse/);
 }finally{if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('PC SQL : transferts atomiques, métadonnées intactes, accès privé, anti-rejeu et objet rendu au relâchement', {skip:!shouldRun},async()=>{
 const pool=createTestPool();const ids=[];
 try{
  const {createUserWithStarter}=require('../server/persistence/userRepository'),teamRepo=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),factory=require('../server/game/drift/pokemonFactory');
  const owner=await createUserWithStarter(`pc_${Date.now()}`,'storage-test-password',{starterId:7});ids.push(owner.id);
  const other=await createUserWithStarter(`pc_other_${Date.now()}`,'storage-test-password',{starterId:1});ids.push(other.id);
  const team=await teamRepo.loadEquipe(owner.id),special=factory.create(4,20,true);special.currentHp=7;special.status='poison';special.heldItem='life_orb';special.ev.speed=12;special.recalculateStats();special.movePp[0]=2;special.pendingMoves=[{name:'Flamethrower',level:40}];
  team.pokemons.push(special);await teamRepo.editEquipe(owner.id,team);
  const initial={uuid:special.uuid,experience:special.experience,iv:special.iv,ev:special.ev,k:special.k,nature:special.nature,heldItem:special.heldItem,passiveAbility:special.passiveAbility,movePp:special.movePp,pendingMoves:special.pendingMoves,currentHp:special.currentHp,status:special.status,experienceRate:special.experienceRate};
  let result=await pc.mutateStorage(owner.id,{action:'deposit',pokemonUuid:special.uuid,box:3});assert.equal(result.equipe.pokemons.length,1);assert.equal(result.state.entries[0].box,3);assert.equal(result.state.entries[0].slot,0);
  await assert.rejects(pc.mutateStorage(owner.id,{action:'deposit',pokemonUuid:team.pokemons[0].uuid,box:0}),/apte/);
  const [entry]=await pc.loadEntries(owner.id);for(const [key,value]of Object.entries(initial))assert.deepEqual(entry.pokemon[key],value,`stored ${key}`);
  await assert.rejects(pc.mutateStorage(other.id,{action:'withdraw',pokemonUuid:special.uuid}),/PC/);assert.equal((await pc.loadEntries(owner.id)).length,1);
  const concurrent=await Promise.allSettled([pc.mutateStorage(owner.id,{action:'withdraw',pokemonUuid:special.uuid}),pc.mutateStorage(owner.id,{action:'withdraw',pokemonUuid:special.uuid})]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const returned=(await teamRepo.loadEquipe(owner.id)).pokemons.find(p=>p.uuid===special.uuid);for(const [key,value]of Object.entries(initial))assert.deepEqual(returned[key],value,`withdrawn ${key}`);
  await pc.mutateStorage(owner.id,{action:'deposit',pokemonUuid:special.uuid,box:0});
  const captured=factory.create(19,12,true);await pc.storeCapturedPokemon(owner.id,captured);await assert.rejects(pc.storeCapturedPokemon(owner.id,captured),/déjà/);const [[dex]]=await pool.execute('SELECT caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=19',[owner.id]);assert.equal(dex.caught_count,1);
  result=await pc.mutateStorage(owner.id,{action:'swap',pokemonUuid:captured.uuid,teamUuid:team.pokemons[0].uuid});assert.equal(result.equipe.pokemons[0].uuid,captured.uuid);assert.equal(result.state.entries.find(e=>e.pokemon.uuid===team.pokemons[0].uuid).slot,1);
  await assert.rejects(pc.mutateStorage(owner.id,{action:'release',pokemonUuid:special.uuid,source:'box'}),/Confirme/);
  await pc.mutateStorage(owner.id,{action:'release',pokemonUuid:special.uuid,source:'box',confirm:true});
  await assert.rejects(pc.mutateStorage(owner.id,{action:'release',pokemonUuid:special.uuid,source:'box',confirm:true}));const [[item]]=await pool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='life_orb'",[owner.id]);assert.equal(item.quantity,1);
  // Inject a duplicate only in this test account: a SQL failure after DELETE must roll back both sides.
  const active=(await teamRepo.loadEquipe(owner.id)).pokemons[0];await pool.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,7,29,?)',[active.uuid,owner.id,pc.encodePokemon(active)]);
  const before=await pc.loadStorage(owner.id);await assert.rejects(pc.mutateStorage(owner.id,{action:'withdraw',pokemonUuid:active.uuid}),e=>e.code==='ER_DUP_ENTRY');assert.deepEqual(await pc.loadStorage(owner.id),before);
 }finally{for(const id of ids)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('PC SQL drag : cases exactes, échange atomique, équipe ordonnée et refus des déplacements périmés ou étrangers', {skip:!shouldRun},async()=>{
 const pool=createTestPool(),ids=[];
 try {
  const {createUserWithStarter}=require('../server/persistence/userRepository'),repo=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),f=require('../server/game/drift/pokemonFactory');
  const owner=await createUserWithStarter(`drag_${Date.now()}`,'storage-drag-password',{starterId:7}),other=await createUserWithStarter(`drag_other_${Date.now()}`,'storage-drag-password',{starterId:1});ids.push(owner.id,other.id);
  const party=await repo.loadEquipe(owner.id),b=f.create(4,20,true),c=f.create(25,20,true),d=f.create(19,20,true);b.currentHp=3;b.movePp[0]=0;b.heldItem='leftovers';party.pokemons.push(b);await repo.editEquipe(owner.id,party);await pc.storeCapturedPokemon(owner.id,c);await pc.storeCapturedPokemon(owner.id,d);
  const move=(p,from,to,uuid=null)=>({action:'move',pokemonUuid:p.uuid,from,to:{...to,uuid}}),box=(box,slot)=>({kind:'box',box,slot}),team=index=>({kind:'team',index});
  await pc.mutateStorage(owner.id,move(c,box(0,0),box(7,29)));await pc.mutateStorage(owner.id,move(c,box(7,29),box(0,1),d.uuid));
  let entries=await pc.loadEntries(owner.id);assert.equal(entries.find(e=>e.pokemon.uuid===d.uuid).box,7);assert.equal(entries.find(e=>e.pokemon.uuid===d.uuid).slot,29);
  const payload=move(c,box(0,1),box(4,23));const concurrent=await Promise.allSettled([pc.mutateStorage(owner.id,payload),pc.mutateStorage(owner.id,payload)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(pc.mutateStorage(other.id,move(c,box(4,23),team(1))),/changé/);
  const before=await pc.loadStorage(owner.id);await assert.rejects(pc.mutateStorage(owner.id,move(c,box(4,23),team(1))),/destination/);assert.deepEqual(await pc.loadStorage(owner.id),before);
  await pc.mutateStorage(owner.id,move(b,team(1),box(4,23),c.uuid));assert.equal((await repo.loadEquipe(owner.id)).pokemons[1].uuid,c.uuid);
  entries=await pc.loadEntries(owner.id);const stored=entries.find(e=>e.pokemon.uuid===b.uuid).pokemon;assert.equal(stored.currentHp,3);assert.equal(stored.movePp[0],0);assert.equal(stored.heldItem,'leftovers');assert.deepEqual(stored.iv,b.iv);assert.deepEqual(stored.ev,b.ev);
  await pc.mutateStorage(owner.id,move(c,team(1),team(0),party.pokemons[0].uuid));assert.equal((await repo.loadEquipe(owner.id)).pokemons[0].uuid,c.uuid);
 } finally {for(const id of ids)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

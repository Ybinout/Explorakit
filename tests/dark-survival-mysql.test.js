const test = require('node:test'), assert = require('node:assert/strict'), {randomUUID} = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1'; let db, user, teams, inventory, dark, repo, Controller, factory, clock;
const kit = require('../server/game/items/darkSurvivalKit');
test.before(async () => {
    if (!enabled) return; assert.equal(process.env.DB_NAME, 'explorakit_test');
    db = require('../server/config/database').dbPool; teams = require('../server/persistence/teamRepository');
    inventory = require('../server/persistence/itemRepository'); dark = require('../server/persistence/darkContinentRepository');
    repo = require('../server/persistence/darkBattleRepository'); Controller = require('../server/game/battle/darkBattleController').DarkBattleController;
    factory = require('../server/game/drift/pokemonFactory');
    user = await require('../server/persistence/userRepository').createUserWithStarter('survival_' + randomUUID().slice(0, 12), randomUUID());
});
test.beforeEach(async () => {if (!enabled) return; clock = 10000; for (const table of ['dark_battle_checkpoints', 'user_items', 'player_story_flags']) await db.execute(`DELETE FROM ${table} WHERE user_id=?`, [user.id]); await db.execute('UPDATE users SET money=500000 WHERE id=?', [user.id]);});
test.after(async () => {if (db) {if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]); await db.end();}});
async function money() {return Number((await db.execute('SELECT money FROM users WHERE id=?', [user.id]))[0][0].money);}
async function stock() {return Number((await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?', [user.id, kit.KEY]))[0][0]?.quantity || 0);}
function mon(id = 7, level = 5, moves = ['Splash']) {
    const p = factory.create(id, level, true); p.passiveAbility = null; p.heldItem = null; p.abilities = []; p.movePp = [];
    for (const move of moves) p.addAbility(move); return p;
}
function controller(player, persist = repo) {const events = [], c = new Controller({userId: user.id, getPlayer: () => player, emit: (e, d) => events.push([e, d]), now: () => clock, random: () => .5, persist}); return {c, events, player};}
async function battle(corrupted = false) {
    const p = mon(); p.currentHp = 1; p.heldItem = kit.KEY;
    if (corrupted) p.corruption = {version: 1, revision: 1, permanent: true, modules: {}};
    const reserve = mon(143, 150), enemy = mon(445, 150, ['Earthquake']);
    await teams.editEquipe(user.id, {pokemons: [p, reserve]});
    const r = controller({id: 'survival-test', userId: user.id, currentmap: 'jungle4', x: 208, y: 368, equipe: {pokemons: [p, reserve]}});
    await r.c.start(enemy); return {...r, p, reserve, enemy};
}
function act(c, action = 'attack', number = 0) {return c.action({turnId: c.run.battle.token, action, number, ...(c.run.battle.replacementPhase ? {replacementId: c.run.battle.token} : {})});}
async function finish(c) {await c.atomic(() => {const b = c.run.battle; for (const p of b.b.equipe.pokemons) p.currentHp = 0; b.prune(); b.checkEnd(); return true;});}
test('SQL guide purchase: concurrent response replay pays once, different payload rejects, money/stock are atomic', {skip: !enabled}, async () => {
    const requestId = randomUUID(), results = await Promise.all(Array.from({length: 6}, () => dark.buySurvivalKit(user.id, {quantity: 2, requestId})));
    assert.equal(results.filter(r => !r.duplicate).length, 1); assert.equal(await stock(), 2); assert.equal(await money(), 400000);
    await assert.rejects(dark.buySurvivalKit(user.id, {quantity: 1, requestId}), /autre achat/);
    for (const quantity of [0, -1, 21, 1.5]) await assert.rejects(dark.buySurvivalKit(user.id, {quantity, requestId: randomUUID()}), /entre/);
    await db.execute('UPDATE users SET money=49999 WHERE id=?', [user.id]);
    await assert.rejects(dark.buySurvivalKit(user.id, {requestId: randomUUID()}), /assez/); assert.equal(await stock(), 2); assert.equal(await money(), 49999);
});
test('SQL guide purchase rollback cannot charge without crediting the kit and receipt', {skip: !enabled}, async () => {
    const acquire = db.getConnection.bind(db); db.getConnection = async () => {const c = await acquire(), execute = c.execute.bind(c), release = c.release.bind(c); c.execute = async (sql, ...args) => {if (sql.startsWith('INSERT INTO player_story_flags')) throw Error('kit_receipt_failed'); return execute(sql, ...args);}; c.release = () => {c.execute = execute; c.release = release; release();}; return c;};
    try {await assert.rejects(dark.buySurvivalKit(user.id, {requestId: randomUUID()}), /kit_receipt_failed/);} finally {db.getConnection = acquire;}
    assert.equal(await money(), 500000); assert.equal(await stock(), 0);
});
for (const corrupted of [false, true]) test(`SQL Dark KO preserves ${corrupted ? 'corrupted' : 'ordinary'} owner at 0 HP; disconnect/replay cannot reuse its kit`, {skip: !enabled}, async () => {
    const r = await battle(corrupted), before = await repo.load(user.id); await act(r.c); clock += 2000; await r.c.tick(); const b = r.c.run.battle;
    assert(b.replacementPhase); let saved = await teams.loadEquipe(user.id), p = saved.pokemons.find(p => p.uuid === r.p.uuid);
    assert(p); assert.equal(p.currentHp, 0); assert.equal(p.heldItem, null); assert.equal(await stock(), 0);
    assert(r.events.some(([e, d]) => e === 'progressionNotice' && /Kit de survie consommé/.test(d.message)));
    await r.c.stop(); const re = controller({...r.player, id: 'reconnected', equipe: saved}); await re.c.load();
    assert(re.c.run.battle.replacementPhase); assert(re.c.run.battle.originalTeams.get(re.c.run.player).find(p => p.uuid === r.p.uuid).__darkSurvivalSettled);
    await assert.rejects(repo.save(user.id, before.run, before.version), /changé/); assert.equal(await stock(), 0);
    await act(re.c, 'change', 1); await finish(re.c); saved = await teams.loadEquipe(user.id);
    assert.equal(saved.pokemons.length, 2); assert.equal(saved.pokemons.find(p => p.uuid === r.p.uuid).currentHp, 0);
    assert(re.events.some(([e, d]) => e === 'endbattle' && d.summary.lostPokemon.length === 0));
    const healed = await dark.healSurvivors(user.id); assert.equal(healed.charged, 10000);
    p = healed.equipe.pokemons.find(p => p.uuid === r.p.uuid); assert.equal(p.currentHp, p.maxHp); assert.equal(p.heldItem, null);
    // The same Pokémon has no second protection after using and healing its kit.
    p.currentHp = 1; await teams.editEquipe(user.id, healed.equipe);
    const again = controller({...r.player, id: 'again', equipe: healed.equipe}); await again.c.load(); await again.c.start(mon(445, 150, ['Earthquake'])); await act(again.c);
    assert(!(await teams.loadEquipe(user.id)).pokemons.some(q => q.uuid === p.uuid)); assert.equal(await stock(), 0);
});
test('SQL KO rollback restores the equipped kit and turn; retry consumes exactly once', {skip: !enabled}, async () => {
    const r = await battle(), before = await repo.load(user.id), count = r.events.length;
    const original = dark.persistFaints; r.c.persist = {...repo, save: async (...args) => {dark.persistFaints = async (...a) => {await original(...a); throw Error('kit_turn_rollback');}; try {return await repo.save(...args);} finally {dark.persistFaints = original;}}};
    await assert.rejects(act(r.c), /kit_turn_rollback/); assert.equal(r.events.length, count);
    let p = (await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === r.p.uuid); assert.equal(p.currentHp, 1); assert.equal(p.heldItem, kit.KEY);
    assert.equal((await repo.load(user.id)).version, before.version); r.c.persist = repo; await act(r.c);
    p = (await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === r.p.uuid); assert.equal(p.currentHp, 0); assert.equal(p.heldItem, null); assert.equal(await stock(), 0);
});
test('SQL legacy Dark loop consumes its kit once and repeated persistence cannot delete the rescued owner', {skip: !enabled}, async () => {
    const p = mon(); p.heldItem = kit.KEY; await teams.editEquipe(user.id, {pokemons: [p]}); p.currentHp = 0;
    const player = {id: 'legacy', equipe: {pokemons: [p]}};
    assert.deepEqual(await dark.persistFaints(user.id, player, null, new Set([p.uuid])), []); assert(p.__darkSurvivalSettled);
    assert.deepEqual(await dark.persistFaints(user.id, player, null, new Set([p.uuid])), []); assert.equal((await teams.loadEquipe(user.id)).pokemons[0].currentHp, 0);
    assert.equal(p.heldItem, null); assert.equal(await stock(), 0);
});

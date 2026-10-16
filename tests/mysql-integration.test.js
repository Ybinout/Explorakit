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
        assert.equal(pokemonRows[0].k, 2);

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
        assert.equal(firstReward.money, 600);
        assert.equal(duplicateReward.granted, false);
        assert.equal(duplicateReward.reason, 'already_completed');
        assert.equal(firstReward.progress.quests.find((quest) => quest.key === 'first_challenge')?.status, 'completed');

        const [[rewardMoneyRow]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);
        assert.equal(Number(rewardMoneyRow.money), 850);

        const purchase = await purchaseUserItem(userId, 'pokeball', 2);
        assert.equal(purchase.success, true);
        assert.equal(purchase.totalPrice, 300);
        assert.equal(purchase.money, 550);
        assert.equal(purchase.items.find((item) => item.key === 'pokeball')?.quantity, 12);
        const refusedPurchase = await purchaseUserItem(userId, 'hyperball', 1);
        assert.equal(refusedPurchase.success, false);
        assert.equal(refusedPurchase.reason, 'insufficient_funds');
        const [[moneyAfterPurchase]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);
        assert.equal(Number(moneyAfterPurchase.money), 550);

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
        let expectedMoney = 150;
        for (const [index, name] of ['moon', 'champion_hoze', 'champion_raphael', 'champion_ana', 'champion_wanda'].entries()) {
            const before = await loadProgressState(userId);
            assert.equal(getSentenceForName(name, before)[1], name);
            // Deux demandes concurrentes ne produisent qu'une seule récompense.
            const results = await Promise.all([completeNpcBattle(userId, name), completeNpcBattle(userId, name)]);
            assert.equal(results.filter((result) => result.granted).length, 1);
            expectedMoney += results.find((result) => result.granted).money;
            const reloaded = await loadProgressState(userId);
            assert.equal(main(reloaded).progress, index + 1);
            assert.equal(main(reloaded).status, 'active');
            assert.equal(reloaded.money, expectedMoney);
            assert.equal(getSentenceForName(name, reloaded)[1], `${name}_after`);
            if (index < 4) assert.equal((await completeStoryEvent(userId, 'clara_letter')).granted, false);
        }
        const endings = await Promise.all([completeStoryEvent(userId, 'clara_letter'), completeStoryEvent(userId, 'clara_letter')]);
        assert.equal(endings.filter((result) => result.granted).length, 1);
        await completeNpcBattle(userId, 'dia1'); // Une victoire annexe tardive ne rouvre pas la quête.
        expectedMoney += 600;
        await completeNpcBattle(userId, 'town_lina');
        const final = await loadProgressState(userId);
        assert.equal(main(final).status, 'completed');
        assert.equal(main(final).progress, 6);
        assert.ok(main(final).completedAt);
        assert.equal(final.badges.filter((badge) => badge.earned).length, 5);
        assert.equal(final.money, expectedMoney);
        assert.equal(getSentenceForName('clara_letter', final)[1], 'clara_letter_after');
        const [[stored]] = await pool.execute("SELECT status, progress FROM player_quests WHERE user_id = ? AND quest_key = 'main_sister_search'", [userId]);
        assert.equal(stored.status, 'completed');
        assert.equal(stored.progress, 6);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

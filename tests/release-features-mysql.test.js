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
    'chapter II prerequisite, complete path, side quest and concurrent rewards',
    { skip: !enabled },
    async () => {
        const u = await fixture();
        try {
            assert.equal((await progress.completeStoryEvent(u.id, 'ch2_clara')).granted, false);
            assert.equal(
                (await progress.loadProgressState(u.id)).quests.some((q) => q.key === 'clara_chapter2'),
                false
            );
            await db.execute(
                "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES (?,'chapter1_complete','true')",
                [u.id]
            );
            assert.equal((await progress.completeStoryEvent(u.id, 'ch2_nora')).granted, false);
            assert.equal((await progress.completeStoryEvent(u.id, 'ch2_iris')).granted, true);
            assert.equal((await progress.completeStoryEvent(u.id, 'ch2_nora')).granted, true);
            assert.equal((await progress.completeNpcBattle(u.id, 'ch2_soren')).granted, true);
            const money = (await progress.loadProgressState(u.id)).money;
            const results = await Promise.all([
                progress.completeStoryEvent(u.id, 'ch2_clara'),
                progress.completeStoryEvent(u.id, 'ch2_clara'),
            ]);
            assert.equal(results.filter((r) => r.granted).length, 1);
            const done = await progress.loadProgressState(u.id);
            assert.equal(done.money, money + 1200);
            assert.equal(done.quests.find((q) => q.key === 'clara_chapter2').status, 'completed');
            await progress.completeStoryEvent(u.id, 'refuge_lyse');
            await progress.completeStoryEvent(u.id, 'refuge_abel');
            assert.equal(
                (await progress.loadProgressState(u.id)).quests.find((q) => q.key === 'refuges').status,
                'completed'
            );
            const [[items]] = await db.execute(
                "SELECT quantity FROM user_items WHERE user_id=? AND item_key='potion'",
                [u.id]
            );
            assert.equal(items.quantity, 4);
        } finally {
            await db.execute('DELETE FROM users WHERE id=?', [u.id]);
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

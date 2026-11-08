const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let db, repo, users, teams, pc, recovery, codec, factory;
const accounts = [],
    raids = [];
test.before(() => {
    if (!enabled) return;
    assert.equal(process.env.DB_NAME, 'explorakit_test');
    db = require('../server/config/database').dbPool;
    repo = require('../server/persistence/raidRepository');
    users = require('../server/persistence/userRepository');
    teams = require('../server/persistence/teamRepository');
    pc = require('../server/persistence/pokemonStorageRepository');
    recovery = require('../server/persistence/raidRecoveryRepository');
    codec = require('../server/game/drift/checkpointCodec');
    factory = require('../server/game/drift/pokemonFactory');
});
test.after(async () => {
    if (!enabled) return;
    for (const id of raids)
        await db.execute('DELETE FROM corruption_raids WHERE id=?', [id]);
    for (const id of accounts)
        await db.execute('DELETE FROM users WHERE id=?', [id]);
    await db.end();
});
async function fixture(map = 'safari7', kit = false) {
    const members = [],
        models = [];
    for (let n = 0; n < 2; n++) {
        const u = await users.createUserWithStarter(
            'RaidSafe_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        accounts.push(u.id);
        const pokemons = [282, 59, 143].map((id) =>
            factory.create(id, 110, true)
        );
        pokemons.forEach((p, i) => {
            p.heldItem = i < 2 ? ['leftovers', 'life_orb'][i] : null;
            p.status = 'normal';
        });
        if (kit && n === 0) pokemons[0].heldItem = 'survival_kit';
        await teams.editEquipe(u.id, { pokemons });
        const m = {
            id: u.id,
            name: u.username,
            team: await teams.loadEquipe(u.id),
            selected: pokemons.slice(0, 2).map((p) => p.uuid),
            ready: true,
        };
        members.push(m);
        for (const p of m.team.pokemons.slice(0, 2))
            models.push({ ownerId: u.id, pokemon: p, initialHeld: p.heldItem });
    }
    const r = {
        id: randomUUID(),
        phase: 'active',
        version: 0,
        rift: { map, difficulty: 'easy', level: 100 },
        members,
        combat: { models, boss: factory.create(143, 100, true) },
    };
    raids.push(r.id);
    r.version = await repo.save(r);
    for (const m of models) m.pokemon.currentHp = 0;
    return r;
}
async function save(r, settle = false) {
    r.version = await repo.save(r, {
        expected: r.version,
        settle,
        random: () => 0.99999,
    });
}
async function bag(id) {
    return (
        await db.execute(
            'SELECT item_key,quantity FROM user_items WHERE user_id=? ORDER BY item_key',
            [id]
        )
    )[0];
}
async function proof(r) {
    return (
        await db.execute(
            'SELECT SHA2(snapshot,256) h FROM corruption_raids WHERE id=?',
            [r.id]
        )
    )[0][0].h;
}
test(
    'Safari multi-owner KOs preserve all UUIDs, items and unselected reserves; no kit consumption even after replay',
    { skip: !enabled },
    async () => {
        const r = await fixture('safari7', true),
            before = r.members.map((m) => m.team.pokemons.map((p) => p.uuid)),
            bags = await Promise.all(r.members.map((m) => bag(m.id)));
        await save(r);
        await save(r);
        for (const [i, m] of r.members.entries()) {
            const saved = (await teams.loadEquipe(m.id)).pokemons;
            assert.deepEqual(
                saved.map((p) => p.uuid),
                before[i]
            );
            assert(saved.slice(0, 2).every((p) => p.currentHp === 0));
            assert(saved[2].currentHp > 0);
            assert(
                m.team.pokemons.every(
                    (p) => !p.__darkContinentDead && !p.__darkSurvivalSettled
                )
            );
            assert.equal((m.casualties || []).length, 0);
            assert.deepEqual(await bag(m.id), bags[i]);
        }
        assert.equal(
            (await teams.loadEquipe(r.members[0].id)).pokemons[0].heldItem,
            'survival_kit'
        );
    }
);
test(
    'Safari victory grants participant XP once while keeping a KO at zero HP and no permanent casualty',
    { skip: !enabled },
    async () => {
        const r = await fixture(),
            before = r.combat.models.map((m) => m.pokemon.experience);
        r.phase = 'won';
        r.won = true;
        await save(r, true);
        await save(r, true);
        for (const [i, model] of r.combat.models.entries()) {
            const p = (await teams.loadEquipe(model.ownerId)).pokemons.find(
                (p) => p.uuid === model.pokemon.uuid
            );
            assert(p);
            assert.equal(p.currentHp, 0);
            assert.equal(p.experience - before[i], 50000);
        }
    }
);
test(
    'Dark Continent retains permanent losses and consumes the kit exactly once',
    { skip: !enabled },
    async () => {
        const r = await fixture('jungle4', true);
        await save(r);
        await save(r);
        const a = (await teams.loadEquipe(r.members[0].id)).pokemons,
            b = (await teams.loadEquipe(r.members[1].id)).pokemons;
        assert.equal(a.length, 2);
        assert.equal(a[0].currentHp, 0);
        assert.equal(a[0].heldItem, null);
        assert.equal(b.length, 1);
        assert(r.members[0].casualties.some((c) => c.protected));
        assert(r.members[1].casualties.every((c) => !c.protected));
    }
);
async function lost() {
    const r = await fixture('jungle4');
    r.phase = 'lost';
    r.won = false;
    await save(r, true);
    return r;
}
test(
    'repair restores the exact four losses to PC, reuses refunded items and has an idempotent receipt',
    { skip: !enabled },
    async () => {
        const r = await lost(),
            userIds = r.members.map((m) => m.id),
            source = await proof(r),
            bags = await Promise.all(userIds.map(bag)),
            args = { raidId: r.id, userIds };
        const preview = await recovery.recover(args);
        assert.equal(
            preview.accounts.flatMap((a) => a.receipt.restored).length,
            4
        );
        assert.equal((await pc.loadEntries(userIds[0])).length, 0);
        assert.deepEqual(await Promise.all(userIds.map(bag)), bags);
        const outputs = await Promise.all([
            recovery.recover({ ...args, dryRun: false }),
            recovery.recover({ ...args, dryRun: false }),
        ]);
        assert.equal(
            outputs.filter((r) => r.accounts.every((a) => a.duplicate)).length,
            1
        );
        assert.equal(await proof(r), source);
        for (const m of r.members) {
            const entries = await pc.loadEntries(m.id);
            assert.equal(entries.length, 2);
            for (const e of entries) {
                const source = r.combat.models.find(
                    (v) => v.pokemon.uuid === e.pokemon.uuid
                );
                assert(source);
                assert.deepEqual(e.pokemon.iv, source.pokemon.iv);
                assert.deepEqual(e.pokemon.ev, source.pokemon.ev);
                assert.equal(e.pokemon.level, source.pokemon.level);
                assert.equal(e.pokemon.experience, source.pokemon.experience);
                assert.equal(e.pokemon.k, source.pokemon.k);
                assert.deepEqual(e.pokemon.abilities, source.pokemon.abilities);
                assert.equal(
                    e.pokemon.passiveAbility,
                    source.pokemon.passiveAbility
                );
                assert.equal(e.pokemon.heldItem, source.initialHeld);
                assert.equal(e.pokemon.currentHp, e.pokemon.maxHp);
            }
            assert(
                (await bag(m.id))
                    .filter((v) =>
                        ['leftovers', 'life_orb'].includes(v.item_key)
                    )
                    .every((v) => Number(v.quantity) === 0)
            );
            assert.equal((await teams.loadEquipe(m.id)).pokemons.length, 1);
        }
    }
);
test(
    'repair rollback never consumes returned items or partially inserts Pokémon, and unrelated accounts cannot be repaired',
    { skip: !enabled },
    async () => {
        const r = await lost(),
            userIds = r.members.map((m) => m.id),
            bags = await Promise.all(userIds.map(bag)),
            encode = pc.encodePokemon;
        let n = 0;
        try {
            pc.encodePokemon = (...a) => {
                if (++n === 3) throw Error('repair insertion fault');
                return encode(...a);
            };
            await assert.rejects(
                recovery.recover({ raidId: r.id, userIds, dryRun: false }),
                /repair insertion fault/
            );
        } finally {
            pc.encodePokemon = encode;
        }
        assert.deepEqual(await Promise.all(userIds.map(bag)), bags);
        for (const id of userIds) {
            assert.equal((await pc.loadEntries(id)).length, 0);
            assert.equal(
                (
                    await db.execute(
                        "SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'support_raid_recovery:%'",
                        [id]
                    )
                )[0].length,
                0
            );
        }
        const outsider = await users.createUserWithStarter(
            'Outside_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        accounts.push(outsider.id);
        await assert.rejects(
            recovery.recover({
                raidId: r.id,
                userIds: [outsider.id],
                dryRun: false,
            }),
            /participait pas/
        );
    }
);

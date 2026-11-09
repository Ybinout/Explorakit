const test = require('node:test'),
    assert = require('node:assert/strict');
const content = require('../server/game/draft/content'),
    prep = require('../server/game/draft/preparation'),
    rifts = require('../server/game/draft/rifts'),
    codec = require('../server/game/drift/checkpointCodec');
const random =
    require('../server/game/abilities/abilityDex').createDeterministicRandom;
const { createDraftManager } = require('../server/realtime/draftManager');
function simulation(t, { humans = 4, rng = random('table'), saved = [] } = {}) {
    let clock = 1000;
    const rows = new Map(saved.map((r) => [r.id, codec.encode(r)])),
        receipts = new Map();
    const store = {
        async loadActive() {
            return [...rows.values()].map(codec.decode);
        },
        async save(r, expected) {
            const old = rows.get(r.id);
            if ((old ? codec.decode(old).version : 0) !== expected)
                throw Error('stale version');
            r.version = expected + 1;
            rows.set(r.id, codec.encode(r));
            return { version: r.version, payments: [] };
        },
    };
    const manager = createDraftManager(null, {
        store,
        now: () => clock,
        random: rng,
        tickMs: 0,
    });
    for (let id = 1; id <= humans; id++)
        manager.contexts.set(id, {
            id,
            username: 'Player ' + id,
            socket: { id: 'socket-' + id, connected: true, emit() {} },
            account: { active: () => true },
            getPlayer: () => players[id],
            canUse: () => true,
        });
    const players = Object.fromEntries(
        Array.from({ length: humans }, (_, i) => [
            i + 1,
            {
                currentmap: 'draft_house',
                x: 13 * 32,
                y: 13 * 32,
                inbattle: false,
                inventoryBusy: false,
                equipe: { pokemons: [content.pokemon(9, 50, random(i))] },
            },
        ])
    );
    t.after(() => manager.stop());
    return {
        manager,
        rows,
        receipts,
        players,
        advance: (ms) => {
            clock += ms;
        },
        store,
    };
}
test('all final-stage species 1–5 create with immutable random traits and legal distinct moves', () => {
    assert.equal(content.species.length, 298);
    assert.equal(rifts.list.length, 24);
    for (const p of content.species) {
        const m = content.pokemon(p.id, 75, random(p.id));
        assert.equal(m.level, 75);
        assert(m.k >= 1 && m.k <= 4);
        assert(Object.values(m.iv).every((v) => v >= 0 && v <= 31));
        assert(Object.values(m.ev).every((v) => v <= 252));
        assert(Object.values(m.ev).reduce((a, b) => a + b, 0) <= 510);
        assert(m.abilities.length > 0 && m.abilities.length <= 4);
        assert.equal(new Set(m.abilities).size, m.abilities.length);
        assert(m.abilities.every((n) => content.legalMoves(p.id).includes(n)));
        assert(
            !require('../server/game/drift/pokemonFactory').legendary.has(p.id)
        );
    }
    const p = content.pokemon(132, 100, random('ditto'));
    assert.deepEqual(p.abilities, ['Transform']);
});
test('preparation is reversible; one card cannot be duplicated and moves retain species compatibility while talents are free', () => {
    const pcard = {
            id: content.uuid(),
            kind: 'pokemon',
            pokemon: content.pokemon(9, 100, random('p')),
        },
        pcard2 = {
            id: content.uuid(),
            kind: 'pokemon',
            pokemon: content.pokemon(6, 100, random('q')),
        },
        item = { id: content.uuid(), kind: 'item', item: 'leftovers' },
        ability = {
            id: content.uuid(),
            kind: 'ability',
            ability: 'Intimidate',
        },
        iv = { id: content.uuid(), kind: 'iv', stat: 'speed' },
        move = { id: content.uuid(), kind: 'move', move: 'Spore' };
    const cards = [pcard, pcard2, item, ability, iv, move],
        r = { cards: new Map(cards.map((c) => [c.id, c])) },
        s = { collection: cards.map((c) => c.id), plan: prep.empty() },
        original = JSON.stringify(pcard.pokemon);
    prep.edit(r, s, { action: 'slot', slot: 0, cardId: pcard.id });
    prep.edit(r, s, { action: 'slot', slot: 1, cardId: pcard2.id });
    prep.edit(r, s, { action: 'apply', pokemonId: pcard.id, cardId: item.id });
    assert.equal(prep.build(r, s, pcard.id).heldItem, 'leftovers');
    assert.throws(
        () =>
            prep.edit(r, s, {
                action: 'apply',
                pokemonId: pcard2.id,
                cardId: item.id,
            }),
        /déjà utilisée/
    );
    prep.edit(r, s, { action: 'remove', pokemonId: pcard.id, slot: 'item' });
    assert.equal(prep.build(r, s, pcard.id).heldItem, null);
    prep.edit(r, s, { action: 'apply', pokemonId: pcard2.id, cardId: item.id });
    prep.edit(r, s, {
        action: 'apply',
        pokemonId: pcard.id,
        cardId: ability.id,
    });
    assert.equal(prep.build(r, s, pcard.id).passiveAbility, 'Intimidate');
    assert.throws(
        () =>
            prep.edit(r, s, {
                action: 'apply',
                pokemonId: pcard.id,
                cardId: move.id,
                moveSlot: 0,
            }),
        /ne peut pas apprendre/
    );
    prep.edit(r, s, { action: 'apply', pokemonId: pcard.id, cardId: iv.id });
    assert.equal(prep.build(r, s, pcard.id).iv.speed, 31);
    prep.edit(r, s, {
        action: 'remove',
        pokemonId: pcard.id,
        slot: 'iv:speed',
    });
    assert.equal(prep.build(r, s, pcard.id).iv.speed, pcard.pokemon.iv.speed);
    prep.validate(r, s);
    assert.equal(JSON.stringify(pcard.pokemon), original);
    s.plan.confirmed = true;
    assert.throws(
        () => prep.edit(r, s, { action: 'slot', slot: 0, cardId: null }),
        /déjà validée/
    );
});
test('four simultaneous packs pass right and 32 classic plus 2 Rift cards belong to each of four seats', async (t) => {
    const { manager: m, players } = simulation(t);
    await m.ready;
    let v = await m.create(1, { level: 100 });
    for (let i = 2; i <= 4; i++) await m.join(i, { id: v.id });
    await m.start(1, { id: v.id });
    let r = m.tables.get(v.id),
        first = r.packs.map((p) => [...p]);
    for (let i = 1; i <= 4; i++)
        await m.pick(i, {
            id: r.id,
            round: r.round,
            pick: r.pick,
            cardId: first[i - 1][0],
        });
    r = m.tables.get(v.id);
    assert.deepEqual(r.packs[1], first[0].slice(1));
    assert.deepEqual(r.packs[0], first[3].slice(1));
    assert.equal(r.pick, 1);
    const seen = new Set(r.seats.flatMap((s) => s.collection));
    while (r.phase === 'draft') {
        const round = r.round,
            pick = r.pick,
            choices = r.packs.map((p) => p[0]);
        const previous = r.packs.map((p) => [...p]);
        if (round === 4) {
            assert(previous.every((p) => p.length === (pick === 0 ? 4 : 3)));
            assert.equal(m.view(r, 1).roundPicks, 2);
        }
        for (let i = 1; i <= 4; i++)
            await m.pick(i, { id: r.id, round, pick, cardId: choices[i - 1] });
        r = m.tables.get(r.id);
        if (round === 4 && pick === 0)
            assert.deepEqual(r.packs[1], previous[0].slice(1));
        if (round === 4 && pick === 1) {
            for (let i = 0; i < 4; i++)
                for (const id of previous[i].slice(1)) assert(!r.cards.has(id));
            assert(r.packs.every((p) => p.length === 0));
        }
    }
    assert.equal(r.phase, 'preparation');
    assert.equal(r.cards.size, 136);
    for (const s of r.seats) {
        assert.equal(s.collection.length, 34);
        assert.equal(
            s.collection.filter((id) => r.cards.get(id).kind === 'rift').length,
            2
        );
    }
    const all = r.seats.flatMap((s) => s.collection);
    assert.equal(new Set(all).size, 136);
    assert(Object.values(players).every((p) => p.inventoryBusy && !p.inbattle));
    const own = m.view(r, 1);
    assert.equal(own.collection.length, 34);
    assert(!JSON.stringify(own).includes(r.seats[1].collection[0]));
    assert.equal(seen.size, 4);
});
test('solo table bots do not block; deadline picks are random, preparation auto-finalizes and no permanent team is replaced', async (t) => {
    const { manager: m, players, advance } = simulation(t, { humans: 1 });
    await m.ready;
    const original = codec.encode(players[1].equipe),
        v = await m.create(1);
    await m.start(1, { id: v.id });
    let r = m.tables.get(v.id);
    for (let n = 0; r.phase === 'draft' && n < 34; n++) {
        advance(content.config.pickMs + 1);
        await m.tick();
        r = m.tables.get(v.id);
    }
    assert.equal(r.phase, 'preparation');
    assert(r.seats.slice(1).every((s) => s.plan.confirmed));
    advance(content.config.preparationMs + 1);
    await m.tick();
    r = m.tables.get(v.id);
    assert(['tournament', 'finished'].includes(r.phase));
    assert(original.equals(codec.encode(players[1].equipe)));
    assert(r.matches.length >= 2);
});
test('Rifts use all eighteen exact type bonuses, configured stat penalties and incoming damage categories', () => {
    for (const type of Object.keys(content.config.elementalCosts)) {
        const r = rifts.get('element-' + type),
            owner = { draftRift: r.key };
        assert.equal(
            rifts.multiplier(owner, null, {
                type,
                combat: { damage_class: 'special' },
            }),
            1.15
        );
        assert.equal(
            rifts.multiplier(owner, null, {
                type,
                combat: { damage_class: 'status' },
            }),
            1
        );
    }
    assert.equal(rifts.stat({ draftRift: 'brute' }, 'attack'), 1.15);
    assert.equal(rifts.stat({ draftRift: 'brute' }, 'speed'), 0.94);
    assert.equal(
        rifts.multiplier(
            null,
            { draftRift: 'element-Water' },
            { type: 'Normal', combat: { damage_class: 'physical' } }
        ),
        1.1
    );
    assert.equal(
        rifts.multiplier(
            null,
            { draftRift: 'element-Water' },
            { type: 'Normal', combat: { damage_class: 'special' } }
        ),
        1
    );
});

test('real engine semifinals and final accept forfeits, lock validated builds and leave permanent teams unchanged', async (t) => {
    const {
        manager: m,
        players,
        advance,
    } = simulation(t, { rng: random('bracket') });
    await m.ready;
    const originals = Object.values(players).map((p) => codec.encode(p.equipe));
    const v = await m.create(1);
    for (let id = 2; id <= 4; id++) await m.join(id, { id: v.id });
    await m.start(1, { id: v.id });
    let r = m.tables.get(v.id);
    while (r.phase === 'draft') {
        const round = r.round,
            pick = r.pick,
            choices = r.packs.map(
                (pack, i) =>
                    pack.find((id) => r.cards.get(id).kind === 'pokemon') ||
                    pack[0]
            );
        for (let id = 1; id <= 4; id++)
            await m.pick(id, {
                id: r.id,
                round,
                pick,
                cardId: choices[id - 1],
            });
        r = m.tables.get(r.id);
    }
    advance(content.config.preparationMs + 1);
    await m.tick();
    r = m.tables.get(r.id);
    assert.equal(r.phase, 'tournament');
    assert.equal(r.matches.length, 2);
    for (const loser of [2, 4]) {
        const match = r.matches.find((x) => x.seats.includes(loser - 1));
        await m.action(loser, {
            id: r.id,
            matchId: match.id,
            turnId: match.battle.token,
            action: 'flee',
        });
        const other = match.seats.find((i) => i !== loser - 1) + 1;
        await m.action(other, {
            id: r.id,
            matchId: match.id,
            turnId: match.battle.token,
            action: 'attack',
            number: 0,
        });
        r = m.tables.get(r.id);
    }
    assert.deepEqual(r.finalists, [0, 2]);
    await m.leave(2, { id: r.id });
    r = m.tables.get(r.id);
    assert.equal(r.seats[1].forfeited, undefined);
    assert.equal(
        r.matches.length,
        2,
        'results remain readable before final starts'
    );
    for (const s of r.seats)
        if (r.finalists.includes(s.index)) s.finalReady = true;
    await m.tick();
    r = m.tables.get(r.id);
    const final = r.matches.find((m) => m.round === 'final');
    assert(final && final.status === 'active');
    assert(
        [final.battle.a, final.battle.b].every((p) =>
            p.equipe.pokemons.every((p) => p.currentHp === p.maxHp)
        )
    );
    await m.action(3, {
        id: r.id,
        matchId: final.id,
        turnId: final.battle.token,
        action: 'flee',
    });
    await m.action(1, {
        id: r.id,
        matchId: final.id,
        turnId: final.battle.token,
        action: 'attack',
        number: 0,
    });
    r = m.tables.get(r.id);
    assert.equal(r.phase, 'finished');
    assert.deepEqual(
        r.seats.map((s) => s.rank),
        [1, 3, 2, 3]
    );
    assert.equal(r.cards.size, 0);
    assert(r.seats.every((s) => s.collection.length === 0 && s.plan === null));
    for (let i = 0; i < 4; i++)
        assert(originals[i].equals(codec.encode(players[i + 1].equipe)));
    assert(
        Object.values(players).every((p) => !p.inventoryBusy && !p.inbattle)
    );
});
test('native damage and speed see the same Draft Rift in real play and AI copies', () => {
    const engine = require('../server/game/battle/battleEngine'),
        effects = require('../server/game/drift/driftEffects'),
        p = content.pokemon(9, 100, random('native-rift')),
        q = content.pokemon(6, 100, random('native-foe'));
    p.passiveAbility = 'Keen Eye';
    q.passiveAbility = 'Keen Eye';
    const field = engine.createBattleState(),
        move = engine.getMoveByName('Tackle');
    const baseline = engine.estimateDamage(p, q, move, { battleState: field }),
        speed = engine.getBattleSpeed(p, null, field, q);
    effects.attach([p], { draftRift: 'brute', drifts: [], equipped: [] }, true);
    const actual = engine.calculateDamageDetailed(p, q, move, {
        battleState: field,
        preview: true,
    }).damage;
    assert(actual > baseline);
    assert.equal(
        engine.estimateDamage(p, q, move, { battleState: field }),
        actual
    );
    assert.equal(
        engine.getBattleSpeed(p, null, field, q),
        Math.floor(speed * 0.94)
    );
    effects.detach([p]);
    assert.equal(
        engine.estimateDamage(p, q, move, { battleState: field }),
        baseline
    );
});
async function prepared(t, humans = 4) {
    const f = simulation(t, { humans, rng: random('resilience') });
    const m = f.manager;
    await m.ready;
    const v = await m.create(1);
    for (let id = 2; id <= humans; id++) await m.join(id, { id: v.id });
    await m.start(1, { id: v.id });
    let r = m.tables.get(v.id);
    while (r.phase === 'draft') {
        const round = r.round,
            pick = r.pick,
            choices = r.packs.map(
                (pack) =>
                    pack.find((id) => r.cards.get(id).kind === 'pokemon') ||
                    pack[0]
            );
        for (let id = 1; id <= humans; id++)
            await m.pick(id, {
                id: r.id,
                round,
                pick,
                cardId: choices[id - 1],
            });
        r = m.tables.get(r.id);
    }
    f.advance(content.config.preparationMs + 1);
    await m.tick();
    return { ...f, id: r.id };
}
test('cold restore keeps pending action, HP, PP, stages, field, deadline and Rift without replaying entry effects', async (t) => {
    const f = await prepared(t),
        m = f.manager;
    let r = m.tables.get(f.id),
        battle = r.matches[0].battle;
    assert.equal(battle.a.draftRifts.length, 2);
    const token = battle.token,
        deadline = battle.deadline;
    await m.action(1, {
        id: r.id,
        matchId: r.matches[0].id,
        turnId: token,
        action: 'attack',
        number: 0,
    });
    r = m.tables.get(r.id);
    const before = codec.decode(f.rows.get(r.id));
    await m.stop();
    const resumed = simulation(t, { saved: [before], rng: random('resume') });
    await resumed.manager.ready;
    const restored = resumed.manager.tables.get(r.id),
        b = restored.matches[0].battle;
    assert.deepEqual(b.a.draftRifts, battle.a.draftRifts);
    assert.deepEqual(b.b.draftRifts, battle.b.draftRifts);
    assert.equal(b.token, token);
    assert.equal(b.deadline, deadline);
    assert(b.pending.has(b.a));
    assert.equal(
        b.a.equipe.pokemons[0].currentHp,
        battle.a.equipe.pokemons[0].currentHp
    );
    assert.deepEqual(
        b.a.equipe.pokemons[0].movePp,
        battle.a.equipe.pokemons[0].movePp
    );
    assert.deepEqual(b.state, battle.state);
    await resumed.manager.action(2, {
        id: r.id,
        matchId: r.matches[0].id,
        turnId: token,
        action: 'attack',
        number: 0,
    });
    assert(!resumed.manager.tables.get(r.id).matches[0].battle.awaiting);
});
test('transaction failure rolls selection back; stale, foreign and repeated choices cannot duplicate a card', async (t) => {
    const f = simulation(t),
        m = f.manager;
    await m.ready;
    let r = await m.create(1);
    for (let id = 2; id <= 4; id++) await m.join(id, { id: r.id });
    await m.start(1, { id: r.id });
    r = m.tables.get(r.id);
    const save = f.store.save,
        cmd = { id: r.id, round: 0, pick: 0, cardId: r.packs[0][0] };
    f.store.save = async () => {
        throw Error('SQL unavailable');
    };
    await assert.rejects(m.pick(1, cmd), /SQL unavailable/);
    f.store.save = save;
    r = m.tables.get(r.id);
    assert.equal(r.choices[0], null);
    assert.equal(r.seats[0].collection.length, 0);
    await assert.rejects(
        m.pick(1, { ...cmd, cardId: r.packs[1][0] }),
        /pas dans/
    );
    await m.pick(1, cmd);
    await assert.rejects(m.pick(1, cmd), /déjà choisi/);
    assert.equal(m.view(m.tables.get(r.id), 1).picked, cmd.cardId);
});
test('bots execute legal native actions while permanent player team remains untouched', async (t) => {
    const f = await prepared(t, 1),
        m = f.manager,
        original = codec.encode(f.players[1].equipe);
    let observed = 0;
    for (let n = 0; n < 18; n++) {
        f.advance(2600);
        await m.tick();
        const r = m.tables.get(f.id);
        observed = Math.max(
            observed,
            ...r.matches.map((m) => m.battle?.round || 0)
        );
        if (r.phase === 'finished') break;
    }
    assert(observed >= 3);
    assert(original.equals(codec.encode(f.players[1].equipe)));
});
test('Draft room door, collisions, table and regional alias are coherent', () => {
    const maps = require('../server/game/world/mapRepository'),
        room = require('../server/game/draft/room');
    assert.equal(
        require('../server/game/world/regionMap').regionLocation(room.MAP),
        'ville1'
    );
    assert.equal(maps.loadCollisionData('ville1')[16][17], 0);
    assert.equal(maps.getNextMap('ville1', 17, 16).nextMap, room.MAP);
    assert.equal(maps.getNextMap(room.MAP, 13, 18).nextMap, 'ville1');
    assert(
        room.tableCells.every(
            ([x, y]) => maps.loadCollisionData(room.MAP)[y][x]
        )
    );
    assert(room.target({ currentmap: room.MAP, x: 13 * 32, y: 13 * 32 }));
});

test('Draft choices allow 50 seconds and preparation seven minutes, with exact deadline boundaries', async (t) => {
    const { manager: m, advance } = simulation(t, { humans: 1 });
    await m.ready;
    const v = await m.create(1);
    assert.deepEqual(v.timing, { pickMs: 50000, preparationMs: 420000 });
    await m.start(1, { id: v.id });
    advance(49999);
    await m.tick();
    assert.equal(m.tables.get(v.id).pick, 0);
    advance(1);
    await m.tick();
    assert.equal(m.tables.get(v.id).pick, 1);
    for (let i = 1; i < 34; i++) {
        advance(50000);
        await m.tick();
    }
    assert.equal(m.tables.get(v.id).phase, 'preparation');
    advance(419999);
    await m.tick();
    assert.equal(m.tables.get(v.id).phase, 'preparation');
    advance(1);
    await m.tick();
    assert(['tournament', 'finished'].includes(m.tables.get(v.id).phase));
});

test('legacy Draft deadlines are extended and persisted once without restarting battle clocks or picks', async (t) => {
    const timing = require('../server/game/draft/timing');
    for (const [phase, extra] of [
        ['draft', 20000],
        ['preparation', 120000],
        ['lobby', 0],
        ['tournament', 0],
    ]) {
        const f = simulation(t, { humans: 1 });
        await f.manager.ready;
        const created = await f.manager.create(1);
        const r = codec.decode(f.rows.get(created.id));
        delete r.timingVersion;
        r.phase = phase;
        r.deadline = 90000;
        r.finalDeadline = 70000;
        r.pick = 4;
        r.choices = ['submitted', null, null, null];
        const snapshot = codec.encode(r);
        await f.manager.stop();
        const restored = simulation(t, {
            humans: 1,
            saved: [codec.decode(snapshot)],
        });
        await restored.manager.ready;
        const persisted = codec.decode(restored.rows.get(r.id));
        assert.equal(persisted.deadline, 90000 + extra);
        assert.equal(persisted.finalDeadline, 70000);
        assert.equal(persisted.pick, 4);
        assert.deepEqual(persisted.choices, r.choices);
        assert.equal(persisted.timingVersion, content.config.timingVersion);
        assert.equal(persisted.version, r.version + 1);
        assert.equal(timing.upgrade(persisted), false);
        await restored.manager.stop();
        const twice = simulation(t, { humans: 1, saved: [persisted] });
        await twice.manager.ready;
        assert.equal(twice.manager.tables.get(r.id).deadline, 90000 + extra);
        assert.equal(twice.manager.tables.get(r.id).version, persisted.version);
        await twice.manager.stop();
    }
});

test('temporary card deletion rolls back with failed persistence, rejects foreign/repeated cards and keeps the permanent team intact', async (t) => {
    const f = simulation(t, { humans: 1 });
    const m = f.manager;
    await m.ready;
    const original = codec.encode(f.players[1].equipe),
        v = await m.create(1);
    await m.start(1, { id: v.id });
    while (m.tables.get(v.id).phase === 'draft') {
        const r = m.tables.get(v.id);
        await m.pick(1, {
            id: r.id,
            round: r.round,
            pick: r.pick,
            cardId: r.packs[0][0],
        });
    }
    const r = m.tables.get(v.id),
        id = r.seats[0].collection[0],
        foreign = r.seats[1].collection[0];
    await assert.rejects(
        m.edit(1, { id: v.id, action: 'discard', cardId: foreign }),
        /collection/
    );
    const save = f.store.save;
    f.store.save = async () => {
        throw Error('SQL unavailable');
    };
    await assert.rejects(
        m.edit(1, { id: v.id, action: 'discard', cardId: id }),
        /SQL unavailable/
    );
    assert(m.tables.get(v.id).cards.has(id));
    assert(m.tables.get(v.id).seats[0].collection.includes(id));
    f.store.save = save;
    await m.edit(1, { id: v.id, action: 'discard', cardId: id });
    assert(!m.tables.get(v.id).cards.has(id));
    assert(!codec.decode(f.rows.get(v.id)).seats[0].collection.includes(id));
    await assert.rejects(
        m.edit(1, { id: v.id, action: 'discard', cardId: id }),
        /collection/
    );
    assert(original.equals(codec.encode(f.players[1].equipe)));
});
test('old snapshots retain eight Rift picks and their original generation rules after a cold restart', async (t) => {
    const f = simulation(t);
    const m = f.manager;
    await m.ready;
    const v = await m.create(1);
    for (let id = 2; id <= 4; id++) await m.join(id, { id: v.id });
    await m.start(1, { id: v.id });
    const run = m.tables.get(v.id);
    delete run.draftFormat;
    await f.store.save(run, run.version);
    const before = codec.decode(f.rows.get(v.id));
    await m.stop();
    const g = simulation(t, { saved: [before] });
    await g.manager.ready;
    let r = g.manager.tables.get(v.id);
    assert.equal(g.manager.view(r, 1).draftFormat.weights.pokemon, 30);
    while (r.phase === 'draft') {
        const round = r.round,
            pick = r.pick,
            choices = r.packs.map((p) => p[0]);
        if (round === 4) assert.equal(g.manager.view(r, 1).roundPicks, 8);
        for (let id = 1; id <= 4; id++)
            await g.manager.pick(id, {
                id: r.id,
                round,
                pick,
                cardId: choices[id - 1],
            });
        r = g.manager.tables.get(v.id);
    }
    assert.equal(r.cards.size, 160);
    assert(r.seats.every((s) => s.collection.length === 40));
    assert(
        r.seats.every(
            (s) =>
                s.collection.filter((id) => r.cards.get(id).kind === 'rift')
                    .length === 8
        )
    );
});

const codec = require('../drift/checkpointCodec'),
    c = require('./content'),
    rifts = require('./rifts');
function fail(message) {
    throw Object.assign(Error(message), { statusCode: 409 });
}
function empty() {
    return {
        slots: Array(6).fill(null),
        attachments: {},
        rift: null,
        confirmed: false,
    };
}
function owned(run, seat, id) {
    if (typeof id !== 'string' || !seat.collection.includes(id))
        fail('Cette carte ne fait pas partie de ta collection.');
    return run.cards.get(id);
}
function consumed(plan) {
    const ids = [];
    if (plan.rift) ids.push(plan.rift);
    for (const a of Object.values(plan.attachments))
        ids.push(...Object.values(a));
    return ids;
}
function build(run, seat, pokemonId) {
    const base = owned(run, seat, pokemonId);
    if (base.kind !== 'pokemon') fail('Choisis une carte Pokémon.');
    const p = codec.decode(codec.encode(base.pokemon));
    for (const [slot, id] of Object.entries(
        seat.plan.attachments[pokemonId] || {}
    )) {
        const card = owned(run, seat, id);
        if (card.kind === 'item') p.heldItem = card.item;
        else if (card.kind === 'nature') p.nature = card.nature;
        else if (card.kind === 'ability') p.passiveAbility = card.ability;
        else if (card.kind === 'iv') p.iv[card.stat] = 31;
        else if (card.kind === 'move')
            p.abilities[Number(slot.slice(5))] = card.move;
    }
    if (new Set(p.abilities).size !== p.abilities.length)
        fail(
            'Cette modification créerait deux attaques identiques. Retire d’abord la carte correspondante.'
        );
    p.recalculateStats();
    p.movePp = p.abilities.map(
        require('../battle/battleResources').getMaxMovePp
    );
    return p;
}
function compatible(card, p, slot) {
    if (card.kind === 'move') {
        if (
            c.config.moveCompatibility === 'learnset' &&
            !c.legalMoves(p.data.id).includes(card.move)
        )
            fail('Cette espèce ne peut pas apprendre cette attaque.');
        if (
            !Number.isInteger(slot) ||
            slot < 0 ||
            slot >= 4 ||
            slot > p.abilities.length
        )
            fail('Choisis une capacité à remplacer.');
        if (p.abilities.includes(card.move))
            fail('Ce Pokémon connaît déjà cette attaque.');
        return 'move:' + slot;
    }
    if (card.kind === 'ability') {
        if (
            c.config.abilityCompatibility === 'natural' &&
            !c
                .getSpeciesAbilitySlots(p.data.id)
                .some((s) => !s.special && s.name === card.ability)
        )
            fail(
                'Ce talent ne fait pas partie des talents naturels de cette espèce.'
            );
        if (p.passiveAbility === card.ability)
            fail('Ce Pokémon possède déjà ce talent.');
        return 'ability';
    }
    if (card.kind === 'iv') {
        if (p.iv[card.stat] === 31) fail('Cet IV est déjà à 31.');
        return 'iv:' + card.stat;
    }
    if (card.kind === 'nature') {
        if (p.nature === card.nature)
            fail('Ce Pokémon possède déjà cette nature.');
        return 'nature';
    }
    if (card.kind === 'item') return 'item';
    fail('Choisis une amélioration à appliquer.');
}
function edit(run, seat, data) {
    const plan = seat.plan;
    if (plan.confirmed) fail('Ton équipe est déjà validée.');
    if (data.action === 'slot') {
        if (!Number.isInteger(data.slot) || data.slot < 0 || data.slot > 5)
            fail('Emplacement invalide.');
        if (data.cardId === null) {
            plan.slots[data.slot] = null;
            return;
        }
        if (owned(run, seat, data.cardId).kind !== 'pokemon')
            fail('Choisis une carte Pokémon.');
        const before = plan.slots.indexOf(data.cardId);
        if (before >= 0) plan.slots[before] = plan.slots[data.slot];
        plan.slots[data.slot] = data.cardId;
        return;
    }
    if (data.action === 'rift') {
        if (
            data.cardId !== null &&
            owned(run, seat, data.cardId).kind !== 'rift'
        )
            fail('Choisis un Rift.');
        plan.rift = data.cardId;
        return;
    }
    if (data.action === 'remove') {
        owned(run, seat, data.pokemonId);
        if (
            typeof data.slot !== 'string' ||
            !Object.hasOwn(plan.attachments[data.pokemonId] || {}, data.slot)
        )
            fail('Cette amélioration a changé.');
        delete plan.attachments[data.pokemonId][data.slot];
        return;
    }
    if (data.action !== 'apply') fail('Modification inconnue.');
    const card = owned(run, seat, data.cardId),
        p = build(run, seat, data.pokemonId);
    if (consumed(plan).includes(card.id))
        fail('Cette carte est déjà utilisée. Retire-la avant de la déplacer.');
    const slot = compatible(card, p, data.moveSlot);
    plan.attachments[data.pokemonId] ||= {};
    plan.attachments[data.pokemonId][slot] = card.id;
}
function team(run, seat) {
    return seat.plan.slots.filter(Boolean).map((id) => build(run, seat, id));
}
function validate(run, seat) {
    const ids = seat.plan.slots.filter(Boolean);
    if (!ids.length) fail('Place au moins un Pokémon dans ton équipe.');
    if (new Set(ids).size !== ids.length || ids.length > 6)
        fail('Un Pokémon ne peut occuper deux emplacements.');
    const used = consumed(seat.plan);
    if (new Set(used).size !== used.length)
        fail('Une carte ne peut être utilisée plusieurs fois.');
    team(run, seat);
    if (seat.plan.rift && owned(run, seat, seat.plan.rift).kind !== 'rift')
        fail('Rift invalide.');
}
function score(p) {
    const offense = Math.max(p.attack, p.specialAttack),
        moves = p.abilities.map(
            require('../battle/battleResources').getMoveDefinition
        );
    return (
        p.maxHp +
        p.defense * 0.55 +
        p.specialDefense * 0.55 +
        p.speed * 0.8 +
        offense * 1.2 +
        p.k * 16 +
        moves.reduce((n, m) => n + (m?.power || 0) * 0.3, 0)
    );
}
function bestRift(run, seat) {
    const ps = team(run, seat);
    return (
        seat.collection
            .map((id) => run.cards.get(id))
            .filter((c) => c.kind === 'rift')
            .sort((a, b) => riftScore(b) - riftScore(a))[0]?.id || null
    );
    function riftScore(card) {
        const r = rifts.get(card.rift);
        return ps.reduce(
            (n, p) =>
                n +
                (r.type
                    ? p.abilities.filter(
                          (m) =>
                              require('../battle/battleResources').getMoveDefinition(
                                  m
                              )?.type === r.type
                      ).length * 8
                    : 5) +
                (r.stats?.attack ? p.attack * 0.02 : 0) +
                (r.stats?.specialAttack ? p.specialAttack * 0.02 : 0),
            0
        );
    }
}
function finalize(run, seat) {
    const selected = new Set(seat.plan.slots.filter(Boolean)),
        pool = seat.collection
            .map((id) => run.cards.get(id))
            .filter((card) => card.kind === 'pokemon' && !selected.has(card.id))
            .sort((a, b) => score(b.pokemon) - score(a.pokemon));
    for (let i = 0; i < 6; i++)
        if (!seat.plan.slots[i] && pool.length)
            seat.plan.slots[i] = pool.shift().id;
    const upgrades = seat.collection
        .map((id) => run.cards.get(id))
        .filter(
            (card) =>
                !['pokemon', 'rift'].includes(card.kind) &&
                !consumed(seat.plan).includes(card.id)
        );
    for (const card of upgrades) {
        let best = null;
        for (const id of seat.plan.slots.filter(Boolean)) {
            const p = build(run, seat, id),
                slots =
                    card.kind === 'move'
                        ? p.abilities.map((_, i) => i)
                        : [undefined];
            for (const slot of slots)
                try {
                    const key = compatible(card, p, slot);
                    if (seat.plan.attachments[id]?.[key]) continue;
                    let merit =
                        card.kind === 'iv'
                            ? 31 - p.iv[card.stat]
                            : card.kind === 'move'
                            ? (require('../battle/battleResources').getMoveDefinition(
                                  card.move
                              )?.power || 0) -
                              (require('../battle/battleResources').getMoveDefinition(
                                  p.abilities[slot]
                              )?.power || 0)
                            : 1;
                    if (
                        card.kind === 'move' &&
                        require('../battle/battleResources').getMoveDefinition(
                            card.move
                        )?.type &&
                        p.data.type.includes(
                            require('../battle/battleResources').getMoveDefinition(
                                card.move
                            ).type
                        )
                    )
                        merit += 20;
                    if (merit > 0 && (!best || merit > best.merit))
                        best = { id, slot, merit };
                } catch {
                    /* Incompatible cards remain unused. */
                }
        }
        if (best)
            edit(run, seat, {
                action: 'apply',
                cardId: card.id,
                pokemonId: best.id,
                moveSlot: best.slot,
            });
    }
    if (!seat.plan.rift) seat.plan.rift = bestRift(run, seat);
    seat.plan.confirmed = true;
    return seat.plan;
}
function pickScore(card, run, seat) {
    const ps = seat.collection
        .map((id) => run.cards.get(id))
        .filter((c) => c.kind === 'pokemon');
    if (card.kind === 'pokemon')
        return (
            (ps.length < 3 ? 160 : ps.length < 6 ? 90 : 0) +
            score(card.pokemon) / 12
        );
    if (card.kind === 'rift') {
        const r = rifts.get(card.rift);
        return (
            5 +
            ps.reduce(
                (n, x) =>
                    n +
                    x.pokemon.abilities.filter(
                        (m) =>
                            require('../battle/battleResources').getMoveDefinition(
                                m
                            )?.type === r.type
                    ).length,
                0
            )
        );
    }
    if (!ps.length) return 1;
    if (card.kind === 'move')
        return ps.some((x) =>
            c.legalMoves(x.pokemon.data.id).includes(card.move)
        )
            ? 25 +
                  (require('../battle/battleResources').getMoveDefinition(
                      card.move
                  )?.power || 0) /
                      8
            : 2;
    if (card.kind === 'ability' && c.config.abilityCompatibility === 'free')
        return 28;
    if (card.kind === 'ability')
        return ps.some((x) =>
            c
                .getSpeciesAbilitySlots(x.pokemon.data.id)
                .some((a) => a.name === card.ability)
        )
            ? 28
            : 2;
    return card.kind === 'item' ? 38 : card.kind === 'iv' ? 32 : 25;
}
module.exports = {
    empty,
    owned,
    consumed,
    build,
    compatible,
    edit,
    team,
    validate,
    score,
    finalize,
    pickScore,
};

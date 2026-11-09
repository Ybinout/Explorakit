const { randomInt, randomUUID } = require('node:crypto');
const config = require('../../../data/game/draft_mode.json'),
    rifts = require('./rifts');
const factory = require('../drift/pokemonFactory'),
    Pokemon = require('../models/Pokemon');
const { machines } = require('../items/machines'),
    resources = require('../battle/battleResources');
const {
    chooseSpeciesAbility,
    getSpeciesAbilitySlots,
    getAbilityDefinition,
} = require('../abilities/abilityDex');
const catalog = require('../../../data/game/items.json').items;
const dex = require('../../../data/game/pokedex.json');
const evolvable = new Set(
    [
        ...require('../../../data/game/evolutions.json').rules,
        ...require('../../../data/game/stone_evolutions.json').rules,
    ]
        .filter((r) => r.to <= 649)
        .map((r) => r.from)
);
const species = dex.filter(
    (p) => p.id <= 649 && !factory.legendary.has(p.id) && !evolvable.has(p.id)
);
const machineList = Object.values(machines).filter((m) =>
    resources.getMoveDefinition(m.move)
);
const movePool = [...new Set(machineList.map((m) => m.move))].filter(
    (n) => n !== 'Struggle'
);
const legal = new Map(
    species.map((p) => [
        p.id,
        machineList.filter((m) => m.species.includes(p.id)).map((m) => m.move),
    ])
);
const legacyItems = catalog.filter(
    (i) => i.category === 'held' && !i.corruptedHeldItem && !i.berryKind
);
// Adventure/permadeath/training effects have no useful role in this temporary format.
const excludedItems = new Set([
    'everstone',
    'exp_share',
    'rift_talisman',
    'survival_kit',
    'macho_brace',
]);
const evolutionEligible = new Set(
    require('../../../data/game/stone_evolutions.json').evolvable
);
if (!species.some((p) => evolutionEligible.has(p.id)))
    excludedItems.add('eviolite');
for (const key of ['douse_drive', 'shock_drive', 'burn_drive', 'chill_drive'])
    if (!species.some((p) => legal.get(p.id)?.includes('Techno Blast')))
        excludedItems.add(key);
const items = legacyItems.filter((i) => !excludedItems.has(i.key));
const itemPools = {
    berries: items.filter((i) => i.key.endsWith('_berry')),
    other: items.filter((i) => !i.key.endsWith('_berry')),
};
const movePools = {
    damage: movePool.filter(
        (n) => resources.getMoveDefinition(n).combat.damage_class !== 'status'
    ),
    status: movePool.filter(
        (n) => resources.getMoveDefinition(n).combat.damage_class === 'status'
    ),
};
const abilities = [
    ...new Set(
        dex
            .filter((p) => p.id <= 649)
            .flatMap((p) =>
                getSpeciesAbilitySlots(p.id)
                    .filter((a) => !a.special)
                    .map((a) => a.name)
            )
    ),
].filter(getAbilityDefinition);
const stats = [
    'hp',
    'attack',
    'defense',
    'specialAttack',
    'specialDefense',
    'speed',
];
const statNames = [
    'PV',
    'Attaque',
    'Défense',
    'Attaque Spéciale',
    'Défense Spéciale',
    'Vitesse',
];
const random = () => randomInt(0, 0x100000000) / 0x100000000;
function choose(list, rng = random) {
    if (!list.length) throw Error('Pool Draft vide.');
    return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}
function shuffle(list, rng = random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function legalMoves(id) {
    return [
        ...new Set(
            legal.get(id) ||
                machineList
                    .filter((m) => m.species.includes(id))
                    .map((m) => m.move)
        ),
    ];
}
function moveView(name) {
    const m = resources.getMoveDefinition(name);
    return {
        name,
        type: m.type,
        power: m.power ?? null,
        accuracy: m.accuracy ?? null,
        pp: resources.getMaxMovePp(name),
        damageClass: m.combat.damage_class,
    };
}
function pokemon(id, level, rng = random) {
    const p = factory.create(id, level, false, rng);
    p.nature = Pokemon.randomNature(rng);
    p.passiveAbility = chooseSpeciesAbility(id, rng);
    p.heldItem = null;
    p.pendingMoves = [];
    p.evolutionState = null;
    p.ev = Object.fromEntries(stats.map((k) => [k, 0]));
    let budget = Math.floor(rng() * 511);
    while (budget > 0) {
        const keys = stats.filter((k) => p.ev[k] < 252),
            k = choose(keys, rng),
            n = Math.min(budget, 252 - p.ev[k], 1 + Math.floor(rng() * 64));
        p.ev[k] += n;
        budget -= n;
    }
    p.abilities = shuffle(legalMoves(id), rng).slice(0, 4);
    if (!p.abilities.length) throw Error('Aucun movepool Draft pour ' + id);
    p.movePp = p.abilities.map(resources.getMaxMovePp);
    p.recalculateStats();
    return p;
}
function createCard(
    level,
    rng = random,
    rift = false,
    weights = config.weights,
    generation = {
        version: 3,
        moveDamageChance: config.moveDamageChance,
        itemBerryChance: config.itemBerryChance,
    }
) {
    const id = randomUUID();
    if (rift) {
        const r = choose(rifts.list, rng);
        return { id, kind: 'rift', rift: r.key };
    }
    let roll = rng() * Object.values(weights).reduce((a, b) => a + b, 0),
        kind = 'pokemon';
    for (const [k, v] of Object.entries(weights)) {
        kind = k;
        roll -= v;
        if (roll < 0) break;
    }
    if (kind === 'pokemon')
        return {
            id,
            kind,
            pokemon: pokemon(choose(species, rng).id, level, rng),
        };
    if (kind === 'move')
        return {
            id,
            kind,
            move: choose(
                generation.version >= 3
                    ? rng() < generation.moveDamageChance
                        ? movePools.damage
                        : movePools.status
                    : movePool,
                rng
            ),
        };
    if (kind === 'item')
        return {
            id,
            kind,
            item: choose(
                generation.version >= 3
                    ? rng() < generation.itemBerryChance
                        ? itemPools.berries
                        : itemPools.other
                    : legacyItems,
                rng
            ).key,
        };
    if (kind === 'nature')
        return { id, kind, nature: choose(Pokemon.natureNames, rng) };
    if (kind === 'ability')
        return { id, kind, ability: choose(abilities, rng) };
    return { id, kind: 'iv', stat: choose(stats, rng) };
}
function view(c) {
    if (c.kind === 'pokemon') {
        const p = c.pokemon;
        return {
            id: c.id,
            kind: c.kind,
            pokemon: {
                ...require('../storage/pokemonStorage').view([p], []).team[0],
                data: { id: p.data.id },
                abilities: [...p.abilities],
            },
            name: p.name || p.truename,
        };
    }
    if (c.kind === 'rift')
        return { id: c.id, kind: c.kind, ...rifts.get(c.rift), rift: c.rift };
    if (c.kind === 'move')
        return { id: c.id, kind: c.kind, ...moveView(c.move), move: c.move };
    if (c.kind === 'item') {
        const i = legacyItems.find((i) => i.key === c.item);
        return {
            id: c.id,
            kind: c.kind,
            item: c.item,
            name: i.name,
            description: i.description,
        };
    }
    if (c.kind === 'iv')
        return {
            ...c,
            name: 'IV ' + statNames[stats.indexOf(c.stat)] + ' · 31',
        };
    return {
        ...c,
        name: c.kind === 'nature' ? 'Pilule Nature' : 'Pilule Talent',
    };
}
module.exports = {
    config,
    species,
    items,
    legacyItems,
    excludedItems,
    itemPools,
    movePools,
    abilities,
    movePool,
    stats,
    statNames,
    legalMoves,
    moveView,
    pokemon,
    createCard,
    view,
    choose,
    shuffle,
    random,
    uuid: randomUUID,
    getSpeciesAbilitySlots,
};

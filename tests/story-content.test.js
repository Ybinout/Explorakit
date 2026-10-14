const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../data/game/progression.json');
const dialogues = require('../data/game/interact.json');
const teams = require('../data/game/pnj_teams.json').pnjs;
const pnjs = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/game/pnjs.jsonc'))).pnjs;
const { getSentenceForName, getEndSentenceInformation } = require('../server/game/world/interactionRepository');
const { deriveStoryQuest } = require('../server/game/world/storyProgression');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { getCanonicalSpeciesAbility } = require('../server/game/abilities/abilityDex');
const { SUPPORTED_ABILITIES } = require('../server/game/abilities/abilityEngine');
const { loadCollisionData, changeMapData, getNextMap } = require('../server/game/world/mapRepository');
const { isPnjBlockingTile } = require('../server/game/world/pnjStore');
const moves = new Set(require('../data/game/moves.json').map((move) => move.ename));
const items = new Set(require('../data/game/items.json').items.map((item) => item.key));
const world = require('../data/game/nextMap.json').maps;

const chain = ['moon', 'champion_hoze', 'champion_raphael', 'champion_ana', 'champion_wanda'];

test('la mère soigne à chaque conversation et conserve son introduction à Clara', () => {
    const mother = pnjs.find(pnj => pnj.name === 'mere_clara');
    assert(mother);
    const [sentences, name] = getSentenceForName(mother.interactionName, { flags: { chapter2_complete: 'true' } });
    assert.equal(getEndSentenceInformation(name), 'heal');
    assert(sentences.some(sentence => sentence.text.includes('Clara')));
    assert(sentences.some(sentence => /soign/i.test(sentence.text)));
});

test('les champions originaux suivent le parcours approuvé et remplacent les anciens', () => {
    for (const [name, city] of [['hoze', 5], ['raphael', 4], ['ana', 3], ['wanda', 2]]) {
        const pnj = pnjs.find((entry) => entry.name === name);
        assert.equal(pnj.map, `gen_arene${city}`);
        assert.equal(pnj.interactionName, `champion_${name}`);
    }
    assert.equal(pnjs.some((pnj) => pnj.interactionName.startsWith('gym_')), false);
    assert.equal(pnjs.find((pnj) => pnj.map === 'gen_arene1').interactionName, 'clara_letter');
    for (const city of ['ville1', 'gen_ville1', 'gen_ville2', 'gen_ville3', 'gen_ville4', 'gen_ville5']) {
        assert.equal(pnjs.filter((pnj) => pnj.map === city && pnj.name.startsWith('town_')).length, 2);
    }
});

test('les scènes suivent les victoires réelles ; la lettre seule conclut le chapitre', () => {
    const state = { flags: {}, completedNpcBattles: [] };
    assert.equal(getSentenceForName('champion_wanda', state)[1], 'champion_wanda_locked');
    assert.notEqual(getEndSentenceInformation('champion_wanda_locked'), 'battle');
    assert.equal(deriveStoryQuest({ flags: { gym_dune_defeated: 'true', generated_region_complete: 'true' } }).progress, 0);
    for (const [index, name] of chain.entries()) {
        assert.equal(getSentenceForName(name, state)[1], name);
        const definition = catalog.npcBattles[name];
        Object.assign(state.flags, definition.reward.flags);
        state.completedNpcBattles.push({ battleKey: definition.battleKey });
        assert.equal(getSentenceForName(name, state)[1], `${name}_after`);
        assert.equal(deriveStoryQuest(state).progress, index + 1);
        assert.equal(deriveStoryQuest(state).status, 'active');
    }
    assert.equal(getSentenceForName('clara_letter', state)[1], 'clara_letter');
    state.flags.chapter1_complete = 'true';
    assert.equal(deriveStoryQuest(state).status, 'completed');
    assert.equal(getSentenceForName('clara_letter', state)[1], 'clara_letter_after');
});

test('les dialogues, portraits, récompenses et équipes actives sont raccordés et cohérents', () => {
    assert.equal(new Set(dialogues.map((entry) => entry.name)).size, dialogues.length);
    assert.equal(new Set(pnjs.map((entry) => entry.name)).size, pnjs.length);
    assert.equal(new Set(Object.values(catalog.npcBattles).map((entry) => entry.battleKey)).size, Object.keys(catalog.npcBattles).length);
    for (const entry of dialogues) {
        for (const target of [entry.after, entry.locked].filter(Boolean)) assert.ok(getSentenceForName(target), target);
        for (const sentence of entry.sentences) {
            assert.ok(fs.existsSync(path.join(__dirname, '../vue-explorakit/src/assets/image', sentence.imageName)), sentence.imageName);
            assert.ok(sentence.text.length < 300, `${entry.name} : phrase trop longue pour les petits écrans`);
        }
        if (entry.end !== 'battle') continue;
        assert.ok(catalog.npcBattles[entry.name], `${entry.name} : récompense unique manquante`);
        const definition = teams.find((team) => team.name === entry.team);
        const built = getPnjTeam(entry.team);
        assert.ok(built.pokemons.length >= 1 && built.pokemons.length <= 6);
        for (const [index, pokemon] of definition.team.entries()) {
            assert.equal(built.pokemons[index].level, pokemon.level);
            assert.ok(pokemon.abilities.length >= 1 && pokemon.abilities.length <= 4);
            pokemon.abilities.forEach((move) => assert.ok(moves.has(move), move));
            assert.ok(getCanonicalSpeciesAbility(pokemon.pokemonId, pokemon.passiveAbility));
            assert.ok(SUPPORTED_ABILITIES.has(pokemon.passiveAbility), pokemon.passiveAbility);
            assert.ok(!pokemon.heldItem || items.has(pokemon.heldItem));
            assert.ok(built.pokemons[index].movePp.every((pp) => pp > 0));
        }
    }
});

function reachable(collision, blocked, origin) {
    const seen = new Set();
    const queue = [origin];
    while (queue.length) {
        const [x, y] = queue.shift();
        const key = `${x}:${y}`;
        if (seen.has(key) || collision[y]?.[x] !== 0 || blocked(x, y)) continue;
        seen.add(key);
        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
}

test('les nouveaux habitants sont accessibles et ne coupent aucun passage existant', () => {
    const additions = pnjs.filter((pnj) => pnj.name.startsWith('town_') || pnj.name === 'mere_clara');
    for (const map of new Set(additions.map((pnj) => pnj.map))) {
        const collision = loadCollisionData(map);
        const changes = changeMapData(map);
        const residents = pnjs.filter((pnj) => pnj.map === map);
        const oldResidents = residents.filter((pnj) => !additions.includes(pnj));
        const beforeBlocked = (x, y) => oldResidents.some((pnj) => pnj.block && pnj.x === x && (pnj.y === y || pnj.y - 1 === y));
        const arrivals = [];
        for (const source of world) {
            for (const transition of source.mapchange.filter((entry) => entry.goto === map)) {
                const target = getNextMap(source.mapName, transition.valX ?? 0, transition.valY ?? 0);
                arrivals.push([Math.floor(target.nextX / 32), Math.floor(target.nextY / 32)]);
            }
        }
        assert.ok(arrivals.length, map);
        const allReachable = new Set();
        for (const arrival of arrivals) {
            assert.equal(isPnjBlockingTile(map, ...arrival), false, `${map} arrivée ${arrival}`);
            const before = reachable(collision, beforeBlocked, arrival);
            const after = reachable(collision, (x, y) => isPnjBlockingTile(map, x, y), arrival);
            for (const key of after) allReachable.add(key);
            // Une porte atteignable avant l'ajout doit toujours l'être, depuis chaque arrivée.
            changes.forEach((row, y) => row.forEach((tile, x) => {
                const key = `${x}:${y}`;
                if (tile && before.has(key)) assert.ok(after.has(key), `${map} passage coupé ${key}`);
            }));
        }
        const occupied = new Set();
        for (const pnj of residents) {
            for (const y of [pnj.y, pnj.y - 1]) {
                const key = `${pnj.x}:${y}`;
                assert.equal(occupied.has(key), false, `${map} PNJ superposés ${key}`);
                occupied.add(key);
                if (additions.includes(pnj)) {
                    assert.equal(collision[y]?.[pnj.x], 0, `${pnj.name} collision ${key}`);
                    assert.equal(changes[y]?.[pnj.x], 0, `${pnj.name} sur une porte ${key}`);
                }
            }
            if (additions.includes(pnj)) assert.ok(
                [[pnj.x - 1, pnj.y], [pnj.x + 1, pnj.y], [pnj.x, pnj.y + 1], [pnj.x, pnj.y - 2]]
                    .some(([x, y]) => allReachable.has(`${x}:${y}`)), `${pnj.name} inaccessible`
            );
        }
    }
});

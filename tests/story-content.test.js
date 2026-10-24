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
const abilityCoverage = require('../server/game/abilities/abilityCoverage');
const { loadCollisionData, changeMapData, getNextMap } = require('../server/game/world/mapRepository');
const { isPnjBlockingTile } = require('../server/game/world/pnjStore');
const moves = new Set(require('../data/game/moves.json').map((move) => move.ename));
const items = new Set(require('../data/game/items.json').items.map((item) => item.key));
const world = require('../data/game/nextMap.json').maps;

const chain = ['dia1', 'aspha_route2', 'moon', 'champion_hoze', 'champion_raphael', 'champion_ana', 'champion_wanda', 'champion_7p'];

test('la mère soigne à chaque conversation et conserve son introduction à Lucie', () => {
    const mother = pnjs.find(pnj => pnj.name === 'mere_clara');
    assert(mother);
    const [sentences, name] = getSentenceForName(mother.interactionName, { flags: { chapter2_complete: 'true' } });
    assert.equal(getEndSentenceInformation(name), 'heal');
    assert(sentences.some(sentence => sentence.text.includes('Lucie')));
    assert(sentences.some(sentence => /soign/i.test(sentence.text)));
});

test('les champions originaux suivent le parcours approuvé et remplacent les anciens', () => {
    for (const [name, city] of [['hoze', 'ville_safe1_arene'], ['raphael', 'gen_arene5'], ['ana', 'ville3_arene'], ['wanda', 'ville4_arene']]) {
        const pnj = pnjs.find((entry) => entry.name === name);
        assert.equal(pnj.map, city);
        assert.equal(pnj.interactionName, `champion_${name}`);
    }
    assert.equal(pnjs.some((pnj) => pnj.interactionName.startsWith('gym_')), false);
    assert.equal(pnjs.find((pnj) => pnj.map === 'gen_arene1').interactionName, 'clara_letter');
    for (const city of ['ville1', 'gen_ville1', 'gen_ville2', 'gen_ville3', 'gen_ville4', 'gen_ville5']) {
        assert.equal(pnjs.filter((pnj) => pnj.map === city && pnj.name.startsWith('town_')).length, 2);
    }
});

test('les huit victoires ouvrent les indices, puis la rencontre de Lucie termine la recherche', () => {
    const state = { flags: {}, completedNpcBattles: [] };
    for (const name of chain.slice(1)) {
        assert.equal(getSentenceForName(name,state)[1],`${name}_locked`);
        assert.notEqual(getEndSentenceInformation(`${name}_locked`),'battle');
    }
    assert.equal(deriveStoryQuest({ flags: { gym_dune_defeated:'true',generated_region_complete:'true' } }).progress,0);
    for (const [index,name] of chain.entries()) {
        assert.equal(getSentenceForName(name,state)[1],name);
        const definition=catalog.npcBattles[name];
        Object.assign(state.flags,definition.reward.flags);
        state.completedNpcBattles.push({battleKey:definition.battleKey});
        assert.equal(getSentenceForName(name,state)[1],`${name}_after`);
        assert.equal(deriveStoryQuest(state).progress,index+1);
        assert.equal(deriveStoryQuest(state).status,'active');
    }
    assert.match(deriveStoryQuest(state).description,/Lucie/);
    assert.equal(deriveStoryQuest(state).map,'route2_maison');
    state.flags.lucie_reunited='true';assert.equal(deriveStoryQuest(state).status,'active');state.flags.lucie_freed='true';assert.equal(deriveStoryQuest(state).status,'completed');assert.equal(deriveStoryQuest(state).progress,9);
    for(const name of ['clara_letter','ch2_iris','valpierre_gardien']) {
        assert.equal(getSentenceForName(name,state)[1],`${name}_locked`);
        assert.equal(getSentenceForName(name)[1],`${name}_locked`);
    }
});
test('les anciennes victoires restent acquises sans payer le nouveau duel ni réécrire les drapeaux', () => {
    const {meetsRequirements,hasCompletedBattle}=require('../server/game/world/storyProgression');
    const state={flags:{moonpunch_defeated:'true'}};
    assert.equal(deriveStoryQuest(state).progress,3);
    assert.equal(getSentenceForName('aspha_route2',state)[1],'aspha_route2_after');
    assert(hasCompletedBattle(catalog.npcBattles.aspha_route2,state));
    assert(meetsRequirements(catalog.npcBattles.champion_hoze,state));
    assert.deepEqual(state.flags,{moonpunch_defeated:'true'});
    assert.equal(deriveStoryQuest({flags:{hoze_defeated:'true'}}).status,'active');
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
            assert.equal(abilityCoverage.status(pokemon.passiveAbility), 'single_battle', pokemon.passiveAbility);
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
    const additions = pnjs.filter((pnj) => pnj.name.startsWith('town_') || ['mere_clara','aspha_route2'].includes(pnj.name));
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


test('Mathilde guards Route 5 with four distinct Pikachu instances and requires her own one-time victory after Raph', () => {
    const definition = catalog.npcBattles.mathilde_pikapika;
    assert.equal(definition.once, true);
    const team = getPnjTeam('mathilde_pikapika');
    assert.equal(team.pokemons.length, 4);
    assert(team.pokemons.every(p => p.data.id === 25));
    assert.equal(new Set(team.pokemons.map(p => p.uuid)).size, 4);
    assert.equal(getSentenceForName('mathilde_pikapika', {flags:{gwenn_route8_defeated:'true'}})[1], 'mathilde_pikapika_locked');
    assert.equal(getSentenceForName('mathilde_pikapika', {flags:{hoze_defeated:'true'}})[1], 'mathilde_pikapika_locked');
    const progress = {flags:{raphael_defeated:'true'}};
    assert.equal(getSentenceForName('mathilde_pikapika', progress)[1], 'mathilde_pikapika');
    Object.assign(progress.flags, definition.reward.flags);
    assert.equal(getSentenceForName('mathilde_pikapika', progress)[1], 'mathilde_pikapika_after');
    assert.notEqual(getEndSentenceInformation('mathilde_pikapika_after'), 'battle');
});

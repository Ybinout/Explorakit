const test = require('node:test');
const assert = require('node:assert/strict');
const world = require('../data/game/nextMap.json').maps;
const balance = require('../data/game/experience_balance.json');
const progression = require('../data/game/progression.json');
const { calculateBattleExperience, getTotalExperienceForLevel, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
const { battleMapData } = require('../server/game/world/mapRepository');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const CreatePokemon = require('../server/game/world/wildPokemonFactory');
const byName = new Map(world.map((entry) => [entry.mapName, entry]));
const wildStages = balance.chapterPath.filter((name) => battleMapData(name).flat().some(Boolean));

test('les rencontres progressent le long du parcours réellement raccordé, du niveau 2 au niveau 61', () => {
    for (let index = 1; index < balance.chapterPath.length; index++) {
        const before = byName.get(balance.chapterPath[index - 1]);
        assert.ok(before.mapchange.some((link) => link.goto === balance.chapterPath[index]), `${before.mapName} : chemin narratif interrompu`);
    }
    for (let index = 1; index < wildStages.length; index++) {
        const previous = byName.get(wildStages[index - 1]).level;
        const current = byName.get(wildStages[index]).level;
        assert.ok(current.min > previous.min && current.max >= previous.max, wildStages[index]);
        // Mounir (17–23) fait le pont entre la route 2 et la route 3.
        const previousChallenge = wildStages[index] === 'route3'
            ? Math.max(...getPnjTeam('moonpunch').pokemons.map((pokemon) => pokemon.level)) : previous.max;
        assert.ok(current.min - previousChallenge <= 2, `${wildStages[index]} : saut brutal`);
        assert.ok(current.max - current.min <= (wildStages[index] === 'gen_route8' ? 6 : 4), `${wildStages[index]} : fourchette trop dispersée`);
    }
    assert.equal(byName.get(wildStages[0]).level.min, 2);
    assert.equal(byName.get(wildStages.at(-1)).level.max, 61);
});

test('les Pokémon sauvages effectivement générés respectent les nouvelles bornes', async () => {
    const random = Math.random;
    try {
        for (const name of wildStages) {
            for (const [roll, bound] of [[0, 'min'], [0.999999, 'max']]) {
                Math.random = () => roll;
                const pokemon = await CreatePokemon(name);
                assert.equal(pokemon.level, byName.get(name).level[bound], `${name} ${bound}`);
                assert(pokemon.abilities.length>=1&&pokemon.abilities.length<=4);
                assert.equal(new Set(pokemon.abilities).size,pokemon.abilities.length);
                assert.ok(pokemon.movePp.every((pp) => pp > 0));
            }
        }
    } finally { Math.random = random; }
});

test('les arènes prolongent les routes précédentes et possèdent leur propre bonus XP', () => {
    for (const [name, team, road] of [
        ['moon', 'moonpunch', 'route2'], ['champion_hoze', 'hoze', 'route4'],
        ['champion_raphael', 'raphael', 'gen_route8'], ['champion_ana', 'ana', 'gen_route6'],
        ['champion_wanda', 'wanda', 'route12'], ['champion_7p', 'sevenp', 'route14']
    ]) {
        const maxWild = byName.get(road).level.max;
        const levels = getPnjTeam(team).pokemons.map((pokemon) => pokemon.level);
        assert.ok(Math.max(...levels) > maxWild && Math.max(...levels) <= maxWild + (name === 'moon' ? 8 : name === 'champion_7p' ? 5 : 4), name);
        assert.equal(progression.npcBattles[name].experienceKind, 'arena');
    }
    for (const [name, definition] of Object.entries(progression.npcBattles)) {
        if (name.startsWith('town_') || name === 'dia1') assert.equal(definition.experienceKind, 'trainer');
    }
});

test('l’XP distingue sauvage, dresseur et arène et favorise les défis adaptés', () => {
    const enemy = { level: 40, k: 1 };
    const sameLevel = { level: 40 };
    const wild = calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.wild, sameLevel);
    assert.equal(wild, 3099);
    assert.equal(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.trainer, sameLevel), 5071);
    assert.equal(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.arena, sameLevel), 6762);
    assert.equal(calculateBattleExperience(enemy, 1, sameLevel), 1452, 'la formule brute reste inchangée');
    assert.ok(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.wild, { level: 30 }) > wild);
    assert.ok(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.wild, { level: 80 }) < wild);
    assert.equal(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.wild, { level: 1000 }), Math.round(wild * 0.25 * 0.1));
    // Le calcul arrondit une seule fois, après le bonus et l'ajustement de niveau.
    assert.equal(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.wild, { level: 1 }), 4649);
});

test('l’Aventure accélérée demande environ 1 à 2 victoires sauvages par niveau standard, sans plafond', () => {
    for (const level of [10, 20, 40, 60, 100, 200]) {
        const cost = getTotalExperienceForLevel(level + 1) - getTotalExperienceForLevel(level);
        const xp = calculateBattleExperience({ level, k: 1 }, BATTLE_EXPERIENCE_MULTIPLIERS.wild, { level });
        const wins = cost / xp;
        assert.ok(wins >= 1.1 && wins <= 1.6, `niveau ${level}: ${wins}`);
    }
});

test('après Raph, les routes restent proches du dernier champion et les champions suivants montent en puissance', () => {
    for (const [champion, nextRoad] of [['raphael', 'gen_route7'], ['ana', 'route11'], ['wanda', 'cave_rochebrume1'], ['mathilde_pikapika', 'route5']]) {
        const aceLevel = Math.max(...getPnjTeam(champion).pokemons.map(p => p.level));
        const zone = byName.get(nextRoad).level;
        assert.ok(zone.max >= aceLevel - 1 && zone.max <= aceLevel + 2, `${champion} → ${nextRoad}`);
        assert.ok(zone.min >= aceLevel - 3, `${nextRoad} : retour à une zone trop faible`);
    }
    let previousAce = Math.max(...getPnjTeam('raphael').pokemons.map(p => p.level));
    for (const champion of ['ana', 'wanda', 'sevenp']) {
        const levels = getPnjTeam(champion).pokemons.map(p => p.level);
        assert.ok(Math.min(...levels) > previousAce, champion);
        previousAce = Math.max(...levels);
    }
    assert.equal(previousAce, 66, 'le sommet de 7p atteint le niveau 66');
    for (const [city, road] of [['ville3', 'gen_route6'], ['ville4', 'route12'], ['ville5', 'route14'], ['ville_commerciale', 'route6']]) {
        assert.deepEqual(byName.get(city).level, byName.get(road).level, `${city} : cohérence des rencontres de pêche`);
    }
});

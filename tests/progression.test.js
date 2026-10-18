const test = require('node:test');
const assert = require('node:assert/strict');

const Pokemon = require('../server/game/models/Pokemon');
const {
    calculateBattleExperience,
    getLevelFromExperience,
    getTotalExperienceForLevel,
    rollK
} = require('../server/game/models/progression');
const { createStarterPokemon } = require('../server/persistence/userRepository');

test('la progression cubique est sans plafond et devient plus exigeante', () => {
    assert.equal(getTotalExperienceForLevel(1), 0);
    assert.equal(getTotalExperienceForLevel(5), 64);
    assert.equal(getLevelFromExperience(64), 5);
    assert.equal(getLevelFromExperience(getTotalExperienceForLevel(1000)), 1000);

    const costFrom10To11 = getTotalExperienceForLevel(11) - getTotalExperienceForLevel(10);
    const costFrom100To101 = getTotalExperienceForLevel(101) - getTotalExperienceForLevel(100);
    assert.ok(costFrom100To101 > costFrom10To11);
});

test("la récompense de combat dépend du niveau, pas de l'expérience cumulée", () => {
    const reward = calculateBattleExperience({ level: 20, experience: 999999999, k: 1 });
    assert.equal(reward, calculateBattleExperience({ level: 20, experience: 0, k: 1 }));
    assert.ok(calculateBattleExperience({ level: 40, k: 1 }) > reward);
});

test('les espèces sans ancienne valeur exp utilisent une progression standard', () => {
    const victini = new Pokemon(494, 'Victini', 1, getTotalExperienceForLevel(120));
    assert.equal(victini.level, 120);
    assert.equal(victini.expGroup, 'Standard');
});

test('la rareté k respecte les seuils documentés', () => {
    assert.equal(rollK(() => 0), 4);
    assert.equal(rollK(() => 0.002), 3);
    assert.equal(rollK(() => 0.02), 2);
    assert.equal(rollK(() => 0.2), 1);
});

test('un meilleur k augmente toutes les statistiques, y compris les PV', () => {
    const iv = { attack: 31, defense: 31, hp: 31, specialAttack: 31, specialDefense: 31, speed: 31 };
    const common = new Pokemon(1, 'Commun', 50, getTotalExperienceForLevel(50), iv, 'Hardy', 1);
    const exceptional = new Pokemon(1, 'Exceptionnel', 50, getTotalExperienceForLevel(50), iv, 'Hardy', 4);
    assert.ok(exceptional.attack > common.attack);
    assert.ok(exceptional.maxHp > common.maxHp);
});

test('les trois starters sont autorisés et commencent au niveau 5 avec un potentiel tiré au sort', () => {
    for (const id of [1, 4, 7]) {
        const starter = createStarterPokemon(id);
        assert.equal(starter.data.id, id);
        assert.equal(starter.level, 5);
        assert([1,2,3,4].includes(starter.k));
        assert.equal(starter.abilities.length, 4);
    }
    assert.throws(() => createStarterPokemon(150), /Starter invalide/);
});

test('starter traits roll six independent IVs, a nature and the established K rarity', () => {
    for (const [roll,k] of [[0,4],[.002,3],[.02,2],[.2,1]]) {
        const values=[0,.1,.3,.5,.75,.999,.6,roll];
        const starter=createStarterPokemon(7,()=>values.shift());
        assert.deepEqual(Object.values(starter.iv),[0,3,9,16,24,31]);
        assert.equal(starter.nature,'Modest');assert.equal(starter.k,k);
        assert.equal(starter.currentHp,starter.maxHp);assert.equal(starter.level,5);
        assert.equal(values.length,0);
    }
});

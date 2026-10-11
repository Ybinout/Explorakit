const test = require('node:test');
const assert = require('node:assert/strict');
const Pokemon = require('../server/game/models/Pokemon');
const { STAT_KEYS, normalizeEffort, rewardTraining } = require('../server/game/models/training');
const { yields } = require('../data/game/effort_yields.json');
const iv = Object.fromEntries(STAT_KEYS.map(key => [key, 20]));
function specimen(nature = 'Bashful', ev = {}) {
    const p = new Pokemon(25, 'Pikachu', 1, 0, iv, nature, 2, ev);
    p.level = 100;
    p.recalculateStats();
    return p;
}

test('les 809 espèces fournissent un rendement EV exploitable', () => {
    assert.equal(Object.keys(yields).length, 809);
    for (let id = 1; id <= 809; id++) {
        const entry = yields[id];
        assert.ok(entry, `espèce ${id}`);
        assert.ok(Object.keys(entry).every(key => STAT_KEYS.includes(key)));
        const total = Object.values(entry).reduce((a, b) => a + b, 0);
        assert.ok(total >= 1 && total <= 3);
    }
    assert.deepEqual(yields[25], { speed: 2 });
});

test('les natures neutres restent neutres et les bonus/malus sont exacts', () => {
    const neutral = specimen();
    for (const nature of ['Hardy', 'Docile', 'Quirky', 'Serious', 'inconnue']) {
        const p = specimen(nature);
        for (const key of ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']) assert.equal(p[key], neutral[key]);
    }
    const adamant = specimen('Adamant');
    assert.equal(adamant.attack, Math.floor(neutral.attack * 1.1));
    assert.equal(adamant.specialAttack, Math.floor(neutral.specialAttack * 0.9));
    assert.equal(adamant.maxHp, neutral.maxHp);
    assert.equal(new Set(Array.from({ length: 25 }, (_, i) => Pokemon.randomNature(() => i / 25))).size, 25);
});

test('les EV respectent 252/510 sans retirer les points déjà acquis', () => {
    const p = specimen();
    const oldAttack = p.attack;
    p.currentHp -= 30;
    p.currentAttack = p.attack * 2;
    p.gainEffort({ speed: 252, specialAttack: 252, defense: 6 });
    const before = { ...p.ev };
    p.gainEffort({ hp: 252, attack: 252 });
    assert.deepEqual(p.ev, before);
    assert.equal(p.maxHp - p.currentHp, 30);
    assert.equal(p.currentAttack, oldAttack * 2);
    assert.equal(p.speed - specimen().speed, 63);
    const normalized = normalizeEffort({ hp: -5, attack: 1000, defense: '253', speed: NaN });
    assert.equal(normalized.hp, 0);
    assert.equal(normalized.attack, 252);
    assert.equal(normalized.defense, 252);
});

test('niveau et évolution préservent identité, entraînement, PP, équipement et blessures', () => {
    const p = specimen('Adamant', { hp: 100, attack: 200 });
    p.addAbility('Thunder Shock');
    p.movePp[0] = 2;
    p.heldItem = 'oran_berry';
    p.status = 'burn';
    p.currentHp -= 20;
    const uuid = p.uuid;
    p.updatePokemon(26);
    assert.equal(p.uuid, uuid);
    assert.equal(p.ev.attack, 200);
    assert.deepEqual(p.movePp, [2]);
    assert.equal(p.heldItem, 'oran_berry');
    assert.equal(p.status, 'burn');
    assert.equal(p.maxHp - p.currentHp, 20);
    p.gainExperience(p.getNextLevelExp());
    assert.equal(p.level, 101);
    assert.equal(p.maxHp - p.currentHp, 20);
    p.currentHp = 0;
    p.gainEffort({ defense: 4 });
    assert.equal(p.currentHp, 0);
});

test('la récompense annonce le Pokémon actualisé au seul joueur concerné', () => {
    const p = new Pokemon(25, 'Pikachu', 1, 0, iv, 'Bashful', 2);
    const events = [];
    rewardTraining(p, { data: { id: 25 } }, 10, { to: id => ({ emit: (event, payload) => events.push({ id, event, payload }) }) }, 'owner');
    assert.equal(p.ev.speed, 2);
    assert.equal(p.experience, 10);
    assert.equal(events[0].id, 'owner');
    assert.equal(events[0].event, 'battleExperience');
    assert.equal(events[0].payload.previousLevel, 1);
    assert.equal(events[0].payload.pokemon.uuid, p.uuid);
});

test('les statistiques gagnées restent actives après un effet de transformation et un rechargement', () => {
    const { clearBattleTransientState } = require('../server/game/battle/battleOutcome');
    const { pokemonToRow, POKEMON_COLUMNS, rowToPokemon } = require('../server/persistence/teamRepository');
    const p = specimen();
    p.__moveAndStatOverrides = { currentAttack: p.attack };
    p.experience = p.getNextLevelExpForLevel(p.level);
    p.gainEffort({ attack: 252 });
    clearBattleTransientState([p]);
    assert.equal(p.currentAttack, p.attack);
    const values = pokemonToRow(p, 1, 1);
    const row = Object.fromEntries(POKEMON_COLUMNS.map((key, index) => [key, values[index]]));
    row.current_attack = 9999;
    const loaded = rowToPokemon(row);
    assert.equal(loaded.currentAttack, loaded.attack);
    assert.equal(loaded.attack, p.attack);
    assert.deepEqual(loaded.ev, p.ev);
});

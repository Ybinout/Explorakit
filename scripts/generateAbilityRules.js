// Build-time reference only; the server reads the generated local JSON.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const source = process.env.ABILITY_DEX_PATH || '@pkmn/dex', { Dex } = require(source);
const version = require(source + '/package.json').version;
assert.equal(version, '0.10.11', 'Use the pinned ability reference');
const dex = Dex.mod('gen7'), data = require('../data/game/abilities.gen7.json');
const slots = require('../data/game/pokemon_abilities.gen7.json').pokemon;
for (const [id, pokemon] of Object.entries(slots)) {
    const expected = Object.entries(dex.species.get(pokemon.name).abilities).map(([slot, name]) => [name, slot]).sort();
    const actual = pokemon.abilities.map(a => [a.name, a.hidden ? 'H' : a.special ? 'S' : String(a.slot - 1)]).sort();
    assert.deepEqual(actual, expected, 'Species ability slots #' + id);
}
const flags = ['breakable', 'notrace', 'failroleplay', 'failskillswap', 'cantsuppress', 'noentrain', 'notransform'];
const abilities = Object.fromEntries(data.abilities.map(({ name }) => {
    const ability = dex.abilities.get(name); assert(ability.exists && ability.gen <= 7, name);
    return [name, Object.fromEntries(flags.filter(flag => ability.flags?.[flag]).map(flag => [flag, true]))];
}));
const file = path.resolve(__dirname, '../data/game/ability_rules.gen7.json');
const output = JSON.stringify({ generation: 7, source: 'Pokemon Showdown via @pkmn/dex', version, abilities }, null, 2) + '\n';
if (process.argv.includes('--check')) assert.equal(fs.readFileSync(file, 'utf8'), output, 'Stale ability rules');
else fs.writeFileSync(file, output);
console.log(JSON.stringify({ speciesChecked: Object.keys(slots).length, abilityRules: Object.keys(abilities).length, differences: 0, version }));

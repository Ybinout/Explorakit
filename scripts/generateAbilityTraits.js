// Reproduce with @pkmn/dex@0.10.11 installed separately; no runtime dependency.
const fs = require('node:fs');
const path = require('node:path');
const { Dex } = require(process.env.ABILITY_DEX_PATH || '@pkmn/dex');
const dex = Dex.mod('gen7');
const moves = {};
for (const entry of require('../data/game/moves.json')) {
    const move = dex.moves.get(entry.ename);
    if (!move.exists || move.gen > 7) continue;
    // The imported dex can retain the modern self boost when gen7 explicitly
    // clears `secondary`. Rapid Spin has no Speed boost before generation 8.
    const secondaries = entry.ename === 'Rapid Spin' ? null : move.secondaries;
    moves[entry.ename] = {
        ...(secondaries?.length ? { secondaries } : {}),
        ...(move.drain ? { drain: move.drain } : {}),
        ...(move.multihit ? { multihit: move.multihit } : {}),
        ...(move.multiaccuracy ? { multiaccuracy: true } : {}),
        ...(move.flags.reflectable ? { reflectable: true } : {}),
        ...(move.flags.dance ? { dance: true } : {})
    };
}
const weights = {};
for (const pokemon of require('../data/game/pokedex.json')) {
    const species = dex.species.get(pokemon.name.english);
    if (species.exists) weights[pokemon.id] = species.weightkg;
}
const forms={};
for(const name of ['Darmanitan-Zen','Aegislash-Blade','Wishiwashi-School','Minior','Minior-Meteor','Zygarde-Complete','Greninja-Ash']) {
    const p=dex.species.get(name); if(!p.exists)throw Error(name); forms[name]={stats:p.baseStats,types:p.types};
}
const output = { generation: 7, source: '@pkmn/dex@0.10.11 (Pokemon Showdown), mod gen7', moves, weights, forms };
fs.writeFileSync(path.join(__dirname, '../data/game/ability_move_traits.gen7.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`${Object.keys(moves).length} move traits, ${Object.keys(weights).length} species weights`);

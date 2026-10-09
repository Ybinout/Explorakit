const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'data', 'game', 'pokemonData.json');

async function fetchPokemonMoves(id) {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}/`);
    if (!response.ok) throw new Error(`PokeAPI ${response.status} pour le Pokémon ${id}`);
    const data = await response.json();
    return data.moves.map((entry) => entry.move.name);
}

async function run(maxId = 497) {
    const existing = fs.existsSync(OUTPUT_PATH)
        ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
        : {};

    for (let id = 1; id <= maxId; id += 1) {
        existing[id] = await fetchPokemonMoves(id);
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 2));
        console.log(`Pokémon ${id}/${maxId}`);
    }
}

if (require.main === module) {
    const requestedMax = Number.parseInt(process.argv[2] || '497', 10);
    run(requestedMax).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { fetchPokemonMoves, run };

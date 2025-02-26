const fs = require('fs');
let currentId = 1;
const interval = setInterval(() => {
    if (currentId <= 497) {
        fetchdata(currentId);
        currentId++;
    } else {
        clearInterval(interval);
    }
}, 2000);

async function fetchdata(id) {
    const response = await fetch(`https://pokeapi.co/api/v2/source_json/${id}/`);
    const data = await response.json();
    const moves = data.moves.map(move => move.move.name);
    const result = {
        [id]: moves
    };
    const fileData = fs.existsSync('pokemonData.json') ? JSON.parse(fs.readFileSync('pokemonData.json')) : {};
    const updatedData = { ...fileData, ...result };
    fs.writeFileSync('pokemonData.json', JSON.stringify(updatedData, null, 2));
}
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT_DIR, 'data', 'vendor', 'pokeapi');
const OUTPUT_PATH = path.join(ROOT_DIR, 'vue-explorakit', 'src', 'data', 'gameNames.fr.json');
const FRENCH_LANGUAGE_ID = '5';
const ENGLISH_LANGUAGE_ID = '9';

function parseCsvLine(line) {
    const fields = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            fields.push(value);
            value = '';
        } else {
            value += char;
        }
    }
    fields.push(value);
    return fields;
}

function buildTranslationMap(csvPath) {
    const namesById = new Map();
    const lines = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1);
    for (const line of lines) {
        if (!line.trim()) continue;
        const [resourceId, languageId, name] = parseCsvLine(line);
        if (![FRENCH_LANGUAGE_ID, ENGLISH_LANGUAGE_ID].includes(languageId)) continue;
        const names = namesById.get(resourceId) || {};
        if (languageId === FRENCH_LANGUAGE_ID) names.fr = name;
        if (languageId === ENGLISH_LANGUAGE_ID) names.en = name;
        namesById.set(resourceId, names);
    }

    return Object.fromEntries(
        [...namesById.values()]
            .filter((names) => names.en && names.fr)
            .sort((left, right) => left.en.localeCompare(right.en, 'en'))
            .map((names) => [names.en, names.fr])
    );
}

function selectKnownNames(translations, names) {
    return Object.fromEntries(
        [...new Set(names)]
            .sort((left, right) => left.localeCompare(right, 'en'))
            .filter((name) => translations[name])
            .map((name) => [name, translations[name]])
    );
}

const knownMoves = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'game', 'moves.json'), 'utf8'))
    .map((move) => move.ename);
const knownAbilities = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'game', 'abilities.gen7.json'), 'utf8'))
    .abilities
    .map((ability) => ability.name);
const allMoveNames = buildTranslationMap(path.join(VENDOR_DIR, 'move_names.csv'));
const allAbilityNames = buildTranslationMap(path.join(VENDOR_DIR, 'ability_names.csv'));

const output = {
    source: 'PokeAPI/pokeapi data/v2/csv (move_names.csv, ability_names.csv)',
    sourceUrl: 'https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv',
    language: 'fr',
    moves: selectKnownNames(allMoveNames, knownMoves),
    abilities: selectKnownNames(allAbilityNames, knownAbilities)
};

Object.assign(output.moves, {
    "Forest's Curse": 'Maléfice Sylvain',
    "King's Shield": 'Bouclier Royal',
    Celebration: 'Célébration',
    "Land's Wrath": 'Force Tellurique'
});

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Noms français générés : ${Object.keys(output.moves).length} capacités, ${Object.keys(output.abilities).length} talents.`);

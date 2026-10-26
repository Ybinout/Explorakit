// Validate raw assignments, not a decoder that might silently normalize them.
const Pokemon = require('../server/game/models/Pokemon');
const factory = require('../server/game/drift/pokemonFactory');
const colosseum = require('../server/game/drift/colosseum');
const { pnjTeams, getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { getCanonicalSpeciesAbility, getSpeciesAbilitySlots } = require('../server/game/abilities/abilityDex');
const species = require('../data/game/pokedex.json');
const report = { constructors: 0, expeditionFactory: 0, npcPokemon: 0, colosseumPokemon: 0, storedParty: 0, storedComputer: 0, errors: [] };
function check(id, name, location) {
    if (!getCanonicalSpeciesAbility(id, name)) report.errors.push({ species: Number(id), ability: name || null, location });
}
async function audit() {
    for (const p of species) {
        const a = new Pokemon(p.id, p.name.english, 50, 0); check(p.id, a.passiveAbility, 'constructor'); report.constructors++;
        const b = factory.create(p.id, 50); check(p.id, b.passiveAbility, 'expedition'); report.expeditionFactory++;
        for (const created of [a,b]) {
            const slot = getSpeciesAbilitySlots(p.id).find(s => s.name === created.passiveAbility);
            if (slot?.special) report.errors.push({ species: p.id, ability: slot.name, location: 'special_event_random_roll' });
        }
    }
    for (const key of pnjTeams.keys()) for (const p of getPnjTeam(key).pokemons) { check(p.data.id, p.passiveAbility, 'npc'); report.npcPokemon++; }
    for (let wave=1;wave<=100;wave++) for (const p of colosseum.opponent(wave).equipe.pokemons) { check(p.data.id,p.passiveAbility,'colosseum'); report.colosseumPokemon++; }
    if (process.argv.includes('--stored')) {
        const { dbPool } = require('../server/config/database');
        try {
            const [party] = await dbPool.execute('SELECT pokemon_id, passive_ability FROM pokemons');
            for (const p of party) { check(p.pokemon_id, p.passive_ability, 'stored_party'); report.storedParty++; }
            const [pc] = await dbPool.execute('SELECT pokemon_data FROM pokemon_storage');
            for (const { pokemon_data } of pc) {
                const p = typeof pokemon_data === 'string' ? JSON.parse(pokemon_data) : Buffer.isBuffer(pokemon_data) ? JSON.parse(pokemon_data.toString('utf8')) : pokemon_data;
                check(p.pokemon_id, p.passive_ability, 'stored_computer'); report.storedComputer++;
            }
        } finally { await dbPool.end(); }
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
}
audit().catch(error => { console.error(error.message); process.exitCode = 1; });

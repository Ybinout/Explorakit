const { dbPool, withTransaction } = require('../config/database');
const { POKEMON_COLUMNS, pokemonToRow, rowToPokemon, getTeamRecord, getTeamPokemons } = require('./teamRepository');
const {markPokemonCaught}=require('./progressionRepository');
const storage = require('../game/storage/pokemonStorage');
function encodePokemon(pokemon) {
    const row = pokemonToRow(pokemon, 0, 0);
    const record = Object.fromEntries(POKEMON_COLUMNS.map((key,i) => [key,row[i]]));
    delete record.team_id; delete record.position;
    return JSON.stringify(record);
}
function decodePokemon(data) { return rowToPokemon(typeof data === 'string' ? JSON.parse(data) : data); }
async function loadEntries(userId, c = dbPool, lock = false) {
    const [rows] = await c.execute(`SELECT uuid,box_index,slot_index,pokemon_data FROM pokemon_storage WHERE user_id=? ORDER BY box_index,slot_index${lock?' FOR UPDATE':''}`, [userId]);
    return rows.map(r => ({box:r.box_index, slot:r.slot_index, pokemon:decodePokemon(r.pokemon_data)}));
}
async function insertEntry(c, userId, entry) {
    await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',
        [entry.pokemon.uuid,userId,entry.box,entry.slot,encodePokemon(entry.pokemon)]);
}
async function hasRoom(userId) {
    const [[row]] = await dbPool.execute('SELECT COUNT(*) AS total FROM pokemon_storage WHERE user_id=?', [userId]);
    return row.total < storage.CAPACITY;
}
async function storeCapturedPokemon(userId, pokemon) {
    return withTransaction(async c => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [entries] = await c.execute('SELECT uuid,box_index AS box,slot_index AS slot FROM pokemon_storage WHERE user_id=? FOR UPDATE', [userId]);
        if (entries.some(e => e.uuid === pokemon.uuid)) throw Error('Ce Pokémon a déjà été transféré.');
        const [active] = await c.execute('SELECT uuid FROM pokemons WHERE uuid=?', [pokemon.uuid]);
        if (active.length) throw Error('Ce Pokémon fait déjà partie d’une équipe.');
        const entry = {...storage.freeSlot(entries), pokemon}; await insertEntry(c,userId,entry);
        await markPokemonCaught(userId,pokemon,c);
        return {box:entry.box,slot:entry.slot};
    });
}
async function loadStorage(userId) {
    const record = await getTeamRecord(userId);
    if (!record) throw Error('Équipe introuvable.');
    const [rows, entries] = await Promise.all([getTeamPokemons(record.id),loadEntries(userId)]);
    return storage.view(rows.map(rowToPokemon), entries);
}
async function mutateStorage(userId, payload) {
    return withTransaction(async c => {
        const [users] = await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        if (!users.length) throw Error('Joueur introuvable.');
        const record = await getTeamRecord(userId,c); if (!record) throw Error('Équipe introuvable.');
        const [rows] = await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]);
        const entries = await loadEntries(userId,c,true);
        const plan = storage.planAction(rows.map(rowToPokemon),entries,payload);
        // Both sides of a transfer are committed together. Never reuse editEquipe's separate transaction.
        await c.execute('DELETE FROM pokemons WHERE team_id=?',[record.id]);
        for(const old of entries)if(!plan.entries.some(e=>e.pokemon.uuid===old.pokemon.uuid && e.box===old.box && e.slot===old.slot))
            await c.execute('DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?',[userId,old.pokemon.uuid]);
        const insert = `INSERT INTO pokemons (${POKEMON_COLUMNS.join(',')}) VALUES (${POKEMON_COLUMNS.map(()=>'?').join(',')})`;
        for (const [i,pokemon] of plan.team.entries()) await c.execute(insert,pokemonToRow(pokemon,record.id,i+1));
        for (const entry of plan.entries) if(!entries.some(old=>old.pokemon.uuid===entry.pokemon.uuid && old.box===entry.box && old.slot===entry.slot)) await insertEntry(c,userId,entry);
        if (plan.released?.heldItem) await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,plan.released.heldItem]);
        return {success:true, state:storage.view(plan.team,plan.entries), equipe:{pokemons:plan.team}};
    });
}
module.exports = {encodePokemon,decodePokemon,loadEntries,hasRoom,loadStorage,mutateStorage,storeCapturedPokemon};

const itemNames = new Map(require('../../../data/game/items.json').items.map(i=>[i.key,i.name]));
const BOX_COUNT = 8;
const BOX_SIZE = 30;
const CAPACITY = BOX_COUNT * BOX_SIZE;
function assertBox(box) {
    if (!Number.isInteger(box) || box < 0 || box >= BOX_COUNT) throw Error('Boîte invalide.');
}
function freeSlot(entries, preferredBox = null) {
    if (preferredBox !== null) assertBox(preferredBox);
    for (const box of preferredBox === null ? Array.from({length:BOX_COUNT}, (_, i) => i) : [preferredBox]) {
        for (let slot = 0; slot < BOX_SIZE; slot++) if (!entries.some(e => e.box === box && e.slot === slot)) return {box, slot};
    }
    throw Error(preferredBox === null ? 'Le PC est plein. Libère une place avant de capturer.' : 'Cette boîte est pleine. Choisis une autre boîte.');
}
function isAble(pokemon) { return pokemon?.currentHp > 0 && !pokemon.riftFainted && !pokemon.isEgg; }
function planAction(team, entries, payload = {}) {
    const nextTeam = [...team], nextEntries = entries.map(e => ({...e}));
    const {action, pokemonUuid, teamUuid, box, source, confirm} = payload;
    if (typeof pokemonUuid !== 'string' || pokemonUuid.length > 64) throw Error('Choisis un Pokémon.');
    const teamIndex = nextTeam.findIndex(p => p.uuid === pokemonUuid);
    const storedIndex = nextEntries.findIndex(e => e.pokemon.uuid === pokemonUuid);
    let released = null, teamChanged = false;
    if (action === 'deposit') {
        if (teamIndex < 0) throw Error('Ce Pokémon ne fait plus partie de ton équipe.');
        const destination = freeSlot(nextEntries, box);
        nextEntries.push({...destination, pokemon: nextTeam.splice(teamIndex,1)[0]}); teamChanged = true;
    } else if (action === 'withdraw') {
        if (storedIndex < 0) throw Error('Ce Pokémon ne se trouve plus dans le PC.');
        if (nextTeam.length >= 6) throw Error('Équipe complète. Choisis un échange avec un compagnon.');
        nextTeam.push(nextEntries.splice(storedIndex,1)[0].pokemon); teamChanged = true;
    } else if (action === 'swap') {
        const outgoing = nextTeam.findIndex(p => p.uuid === teamUuid);
        if (storedIndex < 0 || outgoing < 0) throw Error('Choisis un Pokémon du PC et un compagnon de ton équipe.');
        const incoming = nextEntries[storedIndex].pokemon;
        nextEntries[storedIndex].pokemon = nextTeam[outgoing]; nextTeam[outgoing] = incoming; teamChanged = true;
    } else if (action === 'release') {
        if (confirm !== true) throw Error('Confirme le relâchement définitif de ce Pokémon.');
        if (source === 'team' && teamIndex >= 0) { released = nextTeam.splice(teamIndex,1)[0]; teamChanged = true; }
        else if (source === 'box' && storedIndex >= 0) released = nextEntries.splice(storedIndex,1)[0].pokemon;
        else throw Error('Ce Pokémon n’est plus à cet emplacement.');
    } else throw Error('Action PC invalide.');
    if (teamChanged && (!nextTeam.length || !nextTeam.some(isAble))) throw Error('Garde au moins un Pokémon apte au combat dans ton équipe.');
    return {team:nextTeam, entries:nextEntries, released};
}
function pokemonView(p) {
    return { uuid:p.uuid, pokemonId:p.data.id, name:p.truename || p.name, nickname:p.name, level:p.level,
        types:p.data.type, currentHp:p.currentHp, maxHp:p.maxHp, status:p.status, potential:p.k,
        heldItem:p.heldItem || null, heldItemName:itemNames.get(p.heldItem) || p.heldItem || null, passiveAbility:p.passiveAbility, iv:p.iv, ev:p.ev, moves:(p.abilities || []).slice(0,4) };
}
function view(team, entries, expedition = false) {
    return {boxCount:BOX_COUNT, boxSize:BOX_SIZE, capacity:CAPACITY, count:entries.length, expedition,
        team:team.map(pokemonView), entries:entries.map(e => ({box:e.box, slot:e.slot, pokemon:pokemonView(e.pokemon)}))};
}
module.exports = {BOX_COUNT, BOX_SIZE, CAPACITY, assertBox, freeSlot, isAble, planAction, view};

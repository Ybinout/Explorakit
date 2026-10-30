const itemNames = new Map(require('../../../data/game/items.json').items.map(i=>[i.key,i.name]));
const {getMoveDefinition,getMaxMovePp}=require('../battle/battleResources');
const {gender:pokemonGender}=require('../items/stoneEvolution');
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
function movePokemon(team, entries, {pokemonUuid, from, to}) {
    if (!from || !to || !['team','box'].includes(from.kind) || !['team','box'].includes(to.kind)) throw Error('Emplacement invalide.');
    const storedAt = place => {
        assertBox(place.box);
        if (!Number.isInteger(place.slot) || place.slot < 0 || place.slot >= BOX_SIZE) throw Error('Case de boîte invalide.');
        return entries.find(e=>e.box===place.box && e.slot===place.slot);
    };
    const teamAt = (place, append = false) => {
        if (!Number.isInteger(place.index) || place.index < 0 || place.index >= 6 || place.index > team.length || (!append && place.index===team.length)) throw Error('Place d’équipe invalide.');
        return team[place.index];
    };
    const origin = from.kind==='team' ? teamAt(from) : storedAt(from)?.pokemon;
    if (!origin || origin.uuid!==pokemonUuid) throw Error('Ce Pokémon a changé de place. Rouvre le PC pour réessayer.');
    const destination = to.kind==='team' ? teamAt(to,true) : storedAt(to)?.pokemon;
    if (!Object.hasOwn(to,'uuid') || to.uuid!==(destination?.uuid || null)) throw Error('La destination a changé. Rouvre le PC pour réessayer.');
    if (origin===destination) return;
    if (from.kind==='team' && to.kind==='team') {
        if (destination) [team[from.index],team[to.index]]=[destination,origin];
        else {team.splice(from.index,1);team.push(origin);}
    } else if (from.kind==='box' && to.kind==='box') {
        const sourceEntry=storedAt(from), targetEntry=storedAt(to);
        if(targetEntry){targetEntry.box=from.box;targetEntry.slot=from.slot;}
        sourceEntry.box=to.box;sourceEntry.slot=to.slot;
    } else if (from.kind==='team') {
        const targetEntry=storedAt(to);
        if(targetEntry){team[from.index]=targetEntry.pokemon;targetEntry.pokemon=origin;}
        else {team.splice(from.index,1);entries.push({box:to.box,slot:to.slot,pokemon:origin});}
    } else {
        const sourceEntry=storedAt(from);
        if(destination){sourceEntry.pokemon=destination;team[to.index]=origin;}
        else {entries.splice(entries.indexOf(sourceEntry),1);team.push(origin);}
    }
}
function planAction(team, entries, payload = {}) {
    const nextTeam = [...team], nextEntries = entries.map(e => ({...e}));
    const {action, pokemonUuid, teamUuid, box, source, confirm} = payload;
    if (typeof pokemonUuid !== 'string' || pokemonUuid.length > 64) throw Error('Choisis un Pokémon.');
    const teamIndex = nextTeam.findIndex(p => p.uuid === pokemonUuid);
    const storedIndex = nextEntries.findIndex(e => e.pokemon.uuid === pokemonUuid);
    let released = null, teamChanged = false;
    if (action === 'move') {
        movePokemon(nextTeam,nextEntries,payload);
        teamChanged = payload.from.kind==='team' || payload.to.kind==='team';
    } else if (action === 'deposit') {
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
    return { uuid:p.uuid, pokemonId:p.data.id, gender:pokemonGender(p), name:p.truename || p.name, nickname:p.name, level:p.level,
        nature:p.nature, experience:p.experience, experienceRate:p.experienceRate,
        stats:Object.fromEntries(['attack','defense','specialAttack','specialDefense','speed'].map(key=>[key,p[key]])),
        movePp:(p.movePp || []).slice(0,4),
        moveDetails:(p.abilities || []).slice(0,4).map((name,index)=>{const m=getMoveDefinition(name);return {name,type:m?.type || null,damageClass:m?.combat?.damage_class || null,power:m?.power ?? null,accuracy:m?.accuracy ?? null,pp:p.movePp?.[index] ?? getMaxMovePp(name),maxPp:getMaxMovePp(name)};}),
        types:p.data.type, currentHp:p.currentHp, maxHp:p.maxHp, status:p.status, potential:p.k,
        heldItem:p.heldItem || null, heldItemName:itemNames.get(p.heldItem) || p.heldItem || null, passiveAbility:p.passiveAbility, iv:p.iv, ev:p.ev, moves:(p.abilities || []).slice(0,4) };
}
function view(team, entries, expedition = false) {
    return {boxCount:BOX_COUNT, boxSize:BOX_SIZE, capacity:CAPACITY, count:entries.length, expedition,
        team:team.map(pokemonView), entries:entries.map(e => ({box:e.box, slot:e.slot, pokemon:pokemonView(e.pokemon)}))};
}
module.exports = {BOX_COUNT, BOX_SIZE, CAPACITY, assertBox, freeSlot, isAble, planAction, view};

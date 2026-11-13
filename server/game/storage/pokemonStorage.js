const itemNames = new Map(require('../../../data/game/items.json').items.map(i=>[i.key,i.name]));
const {getMoveDefinition,getMaxMovePp}=require('../battle/battleResources');
const {gender:pokemonGender}=require('../items/stoneEvolution');
const BOX_COUNT = 40;
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
function heldItemToTake(team, entries, payload) {
    const {pokemonUuid,source,expectedItem}=payload || {};
    if(typeof pokemonUuid!=='string' || !pokemonUuid || pokemonUuid.length>64 || !['team','box'].includes(source)) throw Error('Choisis un Pokémon dans le PC.');
    const pokemon=source==='team'?team.find(p=>p.uuid===pokemonUuid):entries.find(e=>e.pokemon.uuid===pokemonUuid)?.pokemon;
    if(!pokemon) throw Error('Ce Pokémon n’est plus à cet emplacement.');
    if(!pokemon.heldItem) throw Error('Ce Pokémon ne tient aucun objet.');
    if(expectedItem!==pokemon.heldItem) throw Error('L’objet tenu a changé. Sélectionne à nouveau ce Pokémon.');
    return {pokemon,itemKey:pokemon.heldItem};
}
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
// One locked transaction for the entire selection. Never overwrite unselected
// occupants, and reject stale origins/destinations before changing any position.
function moveMany(entries, {moves, to}) {
    if (!Array.isArray(moves) || !moves.length || moves.length > BOX_SIZE) throw Error('Sélectionne entre 1 et 30 Pokémon du PC.');
    assertBox(to?.box);
    const start = to.slot ?? 0;
    if (!Number.isInteger(start) || start < 0 || start >= BOX_SIZE) throw Error('Case de boîte invalide.');
    const actual = Array.from({length:BOX_SIZE}, (_,slot)=>entries.find(e=>e.box===to.box && e.slot===slot)?.pokemon.uuid || null);
    if (!Array.isArray(to.expected) || to.expected.length!==BOX_SIZE || actual.some((id,i)=>id!==to.expected[i])) throw Error('La destination a changé. Rouvre le PC pour réessayer.');
    const ids = new Set(), selected = moves.map(m=>{
        if(typeof m?.pokemonUuid!=='string' || m.pokemonUuid.length>64 || ids.has(m.pokemonUuid)) throw Error('Sélection de Pokémon invalide.');
        ids.add(m.pokemonUuid);
        const entry=entries.find(e=>e.pokemon.uuid===m.pokemonUuid);
        if(m.from?.kind!=='box' || !entry || entry.box!==m.from.box || entry.slot!==m.from.slot) throw Error('Un Pokémon a changé de place. Rouvre le PC pour réessayer.');
        return entry;
    });
    const free = Array.from({length:BOX_SIZE},(_,i)=>(start+i)%BOX_SIZE).filter(slot=>!actual[slot] || ids.has(actual[slot]));
    if(free.length<selected.length) throw Error('Pas assez de places libres dans cette boîte. Aucun Pokémon n’a été déplacé.');
    selected.forEach((e,i)=>{e.box=to.box;e.slot=free[i];});
}
function planAction(team, entries, payload = {}) {
    const nextTeam = [...team], nextEntries = entries.map(e => ({...e}));
    const {action, pokemonUuid, teamUuid, box, source, confirm} = payload;
    if (!['moveMany','swapParty'].includes(action) && (typeof pokemonUuid !== 'string' || pokemonUuid.length > 64)) throw Error('Choisis un Pokémon.');
    const teamIndex = nextTeam.findIndex(p => p.uuid === pokemonUuid);
    const storedIndex = nextEntries.findIndex(e => e.pokemon.uuid === pokemonUuid);
    let released = null, teamChanged = false;
    if (action === 'swapParty') {
        const {moves,expectedTeam}=payload;
        if(nextTeam.length!==6||!Array.isArray(moves)||moves.length!==6||new Set(moves.map(m=>m?.pokemonUuid)).size!==6)
            throw Error('Sélectionne exactement six Pokémon du PC pour échanger une équipe complète.');
        if(!Array.isArray(expectedTeam)||expectedTeam.length!==6||nextTeam.some((p,i)=>p.uuid!==expectedTeam[i]))
            throw Error('L’équipe a changé. Rouvre le PC pour réessayer.');
        const selected=moves.map(m=>{
            const e=nextEntries.find(e=>e.pokemon.uuid===m.pokemonUuid);
            if(!e||m.from?.kind!=='box'||e.box!==m.from.box||e.slot!==m.from.slot)throw Error('Un Pokémon a changé de place. Rouvre le PC pour réessayer.');
            return e;
        });
        selected.forEach((e,i)=>{const p=e.pokemon;e.pokemon=nextTeam[i];nextTeam[i]=p;});
        teamChanged=true;
    } else if (action === 'moveMany') {
        moveMany(nextEntries,payload);
    } else if (action === 'move') {
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
    if (teamChanged && (!nextTeam.length || !nextTeam.some(isAble)) && !(team.length===0 && action==='withdraw' && nextTeam.length===1)) throw Error('Garde au moins un Pokémon apte au combat dans ton équipe.');
    require('../corruption/pokemon').assertTeam(nextTeam);
    return {team:nextTeam, entries:nextEntries, released};
}
function boxNames(custom = []) {
    return Array.from({length:BOX_COUNT}, (_,box)=>custom[box] || `Boîte ${box+1}`);
}
function renamedBox(custom, payload) {
    assertBox(payload?.box);
    if(payload.expectedName !== boxNames(custom)[payload.box]) throw Error('Le nom de cette boîte a changé. Rouvre le PC pour réessayer.');
    return require('../models/ownedNames').normalizeName(payload.name);
}
function pokemonView(p) {
    return { shiny:p.shiny===true,corruption:require('../corruption/pokemon').view(p), uuid:p.uuid, pokemonId:p.data.id, gender:pokemonGender(p), name:p.name || p.truename, speciesName:p.truename || p.name, nickname:p.name, level:p.level,
        nature:p.nature, experience:p.experience, experienceRate:p.experienceRate,
        stats:Object.fromEntries(['attack','defense','specialAttack','specialDefense','speed'].map(key=>[key,p[key]])),
        movePp:(p.movePp || []).slice(0,4),
        moveDetails:(p.abilities || []).slice(0,4).map((name,index)=>{const m=getMoveDefinition(name);return {name,type:m?.type || null,damageClass:m?.combat?.damage_class || null,power:m?.power ?? null,accuracy:m?.accuracy ?? null,pp:p.movePp?.[index] ?? getMaxMovePp(name),maxPp:getMaxMovePp(name)};}),
        types:p.data.type, currentHp:p.currentHp, maxHp:p.maxHp, status:p.status, potential:p.k,
        heldItem:p.heldItem || null, heldItemName:itemNames.get(p.heldItem) || p.heldItem || null, passiveAbility:p.passiveAbility, iv:p.iv, ev:p.ev, moves:(p.abilities || []).slice(0,4) };
}
function view(team, entries, expedition = false, customNames = []) {
    return {boxCount:BOX_COUNT, boxNames:boxNames(customNames), boxSize:BOX_SIZE, capacity:CAPACITY, count:entries.length, expedition,
        team:team.map(pokemonView), entries:entries.map(e => ({box:e.box, slot:e.slot, pokemon:pokemonView(e.pokemon)}))};
}
module.exports = {BOX_COUNT, BOX_SIZE, CAPACITY, assertBox, freeSlot, isAble, heldItemToTake, planAction, view, boxNames, renamedBox};

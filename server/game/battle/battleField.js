// Public battlefield effects only. No Pokémon, action choices or private teams.
const FIELD_TIMERS = {
    gravity:'gravityTurns', trick_room:'trickRoomTurns', magic_room:'magicRoomTurns',
    wonder_room:'wonderRoomTurns', ion_deluge:'ionDelugeTurns', mud_sport:'mudSportTurns',
    water_sport:'waterSportTurns', fairy_lock:'fairyLockTurns'
};
const SIDE_TIMERS = {
    reflect:'reflectTurns', light_screen:'lightScreenTurns', safeguard:'safeguardTurns',
    mist:'mistTurns', tailwind:'tailwindTurns', lucky_chant:'luckyChantTurns'
};
const LABELS = {
    gravity:'Gravité', trick_room:'Distorsion', magic_room:'Zone Magique', wonder_room:'Zone Étrange',
    ion_deluge:'Déluge Plasmique', mud_sport:'Lance-Boue', water_sport:'Tourniquet', fairy_lock:'Verrou Enchanté',
    reflect:'Protection', light_screen:'Mur Lumière', safeguard:'Rune Protect', mist:'Brume',
    tailwind:'Vent Arrière', lucky_chant:'Air Veinard',
    electric_terrain:'Champ Électrifié', grassy_terrain:'Champ Herbu', misty_terrain:'Champ Brumeux', psychic_terrain:'Champ Psychique',
    rain:'Pluie', sun:'Soleil', sandstorm:'Tempête de sable', hail:'Grêle',
    spikes:'Picots', toxicSpikes:'Pics Toxik', stealthRock:'Piège de Roc', stickyWeb:'Toile Gluante'
};
const ROOMS = new Set(['trick_room','magic_room','wonder_room']);
const TEAM_GUARDS = {wide_guard:'wideGuardTurns',quick_guard:'quickGuardTurns',mat_block:'matBlockTurns',crafty_shield:'craftyShieldTurns'};
Object.assign(LABELS,{wide_guard:'Garde Large',quick_guard:'Prévention',mat_block:'Tatamigaeshi',crafty_shield:'Vigilance'});
const SPREAD_MOVES = new Set(require('../../../data/vendor/pokeapi/spread-moves.json').moves);
const HAZARDS = {spikes:['spikes',3],toxic_spikes:['toxicSpikes',2],stealth_rock:['stealthRock',1],sticky_web:['stickyWeb',1]};
const SCREEN_KEYS = ['reflectTurns','lightScreenTurns','safeguardTurns','mistTurns'];
function clearHazards(side) {
    if(!side?.hazards)return false;
    const had=Object.values(side.hazards).some(Boolean);
    Object.assign(side.hazards,{spikes:0,toxicSpikes:0,stealthRock:false,stickyWeb:false});
    return had;
}
function clearScreens(side,keys=SCREEN_KEYS) {
    if(!side?.screens)return false;
    const had=keys.some(k=>side.screens[k]>0);
    for(const k of keys)side.screens[k]=0;
    return had;
}
function setHazard(name,side,messages) {
    const spec=HAZARDS[name];if(!spec||!side?.hazards)return false;
    const [key,max]=spec,old=Number(side.hazards[key])||0;
    if(old>=max){messages.push(`${LABELS[key]} : impossible d’ajouter davantage de pièges.`);return false;}
    side.hazards[key]=max===1?true:old+1;
    messages.push(`${LABELS[key]} recouvre le camp adverse${max>1?` (${old+1}/${max})`:''}.`);
    return true;
}
function tickTimers(container,map,messages,side=false) {
    for(const [name,key] of Object.entries(map))if(container?.[key]>0){
        container[key]=Math.max(0,container[key]-1);
        if(container[key]===0)messages.push(`${LABELS[name]} ${side?'du camp concerné ':''}se termine.`);
    }
}
const count=v=>Math.max(0,Math.min(99,Math.trunc(Number(v)||0)));
function publicSide(side) {
    return {
        hazards:Object.fromEntries(Object.values(HAZARDS).map(([k,max])=>[k,max===1?Boolean(side?.hazards?.[k]):Math.min(max,count(side?.hazards?.[k]))])),
        screens:Object.fromEntries([...Object.values(SIDE_TIMERS).map(k=>[k,count(side?.screens?.[k])]),...Object.values(TEAM_GUARDS).map(k=>[k,count(side?.protectTeam?.[k])])])
    };
}
function publicField(state,viewerSide='player') {
    return {field:Object.fromEntries(Object.values(FIELD_TIMERS).map(k=>[k,count(state?.field?.[k])])),
        sides:{player:publicSide(state?.sides?.[viewerSide]),opponent:publicSide(state?.sides?.[viewerSide==='enemy'?'player':'enemy'])}};
}
module.exports={FIELD_TIMERS,SIDE_TIMERS,TEAM_GUARDS,SPREAD_MOVES,LABELS,ROOMS,clearHazards,clearScreens,setHazard,tickTimers,publicField};

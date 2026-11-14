// Anonymous team progress only: never expose unseen species, moves or items.
function partyIndicator(pokemons, limit = 6) {
    const members = (Array.isArray(pokemons) ? pokemons : [])
        .filter(pokemon => pokemon && !pokemon.isEgg && !pokemon.storyActor).slice(0, limit === 12 ? 12 : 6);
    return members.length ? members.map(pokemon => Number(pokemon.currentHp) > 0)
        .sort((a, b) => Number(b) - Number(a)) : null;
}
function partyConditionIndicator(pokemons) {
    const rank = { ready: 0, hurt: 1, ko: 2 };
    const states = (Array.isArray(pokemons) ? pokemons : [])
        .filter(pokemon => pokemon && !pokemon.isEgg && !pokemon.storyActor).slice(0, 6)
        .map(pokemon => Number(pokemon.currentHp) > 0
            ? Number(pokemon.maxHp) > Number(pokemon.currentHp) ? 'hurt' : 'ready'
            : 'ko');
    // Counts only, independent of switches: no identity, order or exact HP.
    return states.length ? states.sort((a, b) => rank[a] - rank[b]) : null;
}
function partyVisualIndicator(pokemons,limit=6){
 const aliases={psn:'poison',tox:'badly_poison',brn:'burn',par:'paralyze',slp:'sleep',frz:'freeze',paralysis:'paralyze',badly_poisoned:'badly_poison'};
 const rank={ready:0,hurt:1,poison:2,badly_poison:3,burn:4,paralyze:5,freeze:6,sleep:7,ko:8};
 const states=(Array.isArray(pokemons)?pokemons:[]).filter(p=>p&&!p.isEgg&&!p.storyActor).slice(0,limit===12?12:6).map(p=>{
  if(!(Number(p.currentHp)>0))return 'ko';const status=aliases[p.status]||p.status;
  return Object.hasOwn(rank,status)&&!['ready','hurt','ko'].includes(status)?status:Number(p.maxHp)>Number(p.currentHp)?'hurt':'ready';
 });return states.length?states.sort((a,b)=>rank[a]-rank[b]):null;
}
module.exports = { partyIndicator, partyConditionIndicator,partyVisualIndicator };

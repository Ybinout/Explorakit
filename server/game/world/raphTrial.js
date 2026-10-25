const config = require('../../../data/game/raph_trial.json');

function normalize(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return null; } }
    if (value?.version !== 1 || !Array.isArray(value.stops) || value.stops.length !== 4
        || new Set(value.stops).size !== 4 || value.stops.some(i => !Number.isInteger(i) || !config.stops[i])
        || !Number.isInteger(value.step) || value.step < 0 || value.step > 4
        || !Number.isSafeInteger(value.availableAt) || value.availableAt < 0) return null;
    return { version: 1, stops: [...value.stops], step: value.step, availableAt: value.availableAt };
}
function position(state) { return state && state.step < 4 ? config.stops[state.stops[state.step]] : config.home; }
function occupies(point, x, y) { return x >= point.x && x < point.x + 2 && y <= point.y && y >= point.y - 1; }
function adjacent(state, player) {
    if (player?.currentmap !== config.map) return false;
    const point = position(state), x = Math.floor(player.x / 32), y = Math.floor(player.y / 32);
    return !occupies(point,x,y) && [point.x,point.x+1].some(px => [point.y,point.y-1].some(py => Math.abs(px-x)+Math.abs(py-y)===1));
}
function create(player, random = Math.random) {
    const stops = [], x = Math.floor(player?.x / 32), y = Math.floor(player?.y / 32);
    while (stops.length < 4) {
        const previous = stops.length ? config.stops[stops[stops.length-1]] : null;
        let candidates = config.stops.map((_,i)=>i).filter(i => !stops.includes(i)
            && (!previous || Math.abs(previous.x-config.stops[i].x)+Math.abs(previous.y-config.stops[i].y)>=5));
        if (!stops.length) candidates = candidates.filter(i=>Math.abs(config.stops[i].x-x)>2||Math.abs(config.stops[i].y-y)>2);
        if (!candidates.length) candidates = config.stops.map((_,i)=>i).filter(i=>!stops.includes(i));
        stops.push(candidates[Math.min(candidates.length-1,Math.max(0,Math.floor(random()*candidates.length)))]);
    }
    return {version:1,stops,step:0,availableAt:0};
}
function advance(state, player, now = Date.now()) {
    state = normalize(state);
    if (!state || state.step === 4 || now < state.availableAt || !adjacent(state,player)) return {state,changed:false};
    const next = {...state,step:state.step+1,availableAt:now+config.duration};
    return {state:next,changed:true,transition:{map:config.map,name:config.actor,
        from:position(state),to:position(next),duration:config.duration,step:next.step,complete:next.step===4}};
}
// A personal overlay, never a mutation of the shared NPC store or authored map.
function scopedStore(base, getState) {
    const originalActor=base.getPnjsForMap(config.map).find(p=>p.name===config.actor);
    function actor(map) {
        const state=getState();
        if(map!==config.map || !state)return null;
        return originalActor ? {...originalActor,...position(state)} : null;
    }
    function getPnjAtTile(map,x,y) {
        const personal=actor(map), original=base.getPnjAtTile(map,x,y);
        if(!personal)return original;
        if(occupies(personal,x,y))return personal;
        return original?.name===config.actor?null:original;
    }
    return {
        getPnjsForMap(map) { const personal=actor(map);return base.getPnjsForMap(map).map(p=>personal&&p.name===config.actor?personal:p); },
        getPnjAtTile,
        isPnjBlockingTile(map,x,y) {
            if(map!==config.map || !getState())return base.isPnjBlockingTile(map,x,y);
            const occupant=getPnjAtTile(map,x,y);return Boolean(occupant&&occupant.block!==false);
        }
    };
}
module.exports = {config,normalize,position,occupies,adjacent,create,advance,scopedStore};

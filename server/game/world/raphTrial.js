const config = require('../../../data/game/raph_trial.json');

function normalize(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return null; } }
    if (!value || !Number.isSafeInteger(value.availableAt) || value.availableAt < 0) return null;
    if (value.version === 1) {
        if (!Array.isArray(value.stops) || value.stops.length !== 4 || new Set(value.stops).size !== 4
            || value.stops.some(i => !Number.isInteger(i) || !config.stops[i])
            || !Number.isInteger(value.step) || value.step < 0 || value.step > 4) return null;
        // Preserve a previously solved trial; unfinished trails become endless.
        return {version:2,stop:value.stops[Math.min(value.step,3)],previous:value.step ? value.stops[Math.min(value.step-1,2)] : null,
            step:value.step,revealed:value.step===4,availableAt:value.availableAt};
    }
    if (value.version !== 2 || !Number.isInteger(value.stop) || !config.stops[value.stop]
        || !(value.previous === null || (Number.isInteger(value.previous) && config.stops[value.previous] && value.previous !== value.stop))
        || !Number.isSafeInteger(value.step) || value.step < 0 || typeof value.revealed !== 'boolean') return null;
    return {version:2,stop:value.stop,previous:value.previous,step:value.step,revealed:value.revealed,availableAt:value.availableAt};
}
function position(state) { state=normalize(state);return state && !state.revealed ? config.stops[state.stop] : config.home; }
function occupies(point, x, y) { return x >= point.x && x < point.x + 2 && y <= point.y && y >= point.y - 1; }
function adjacentPoint(point, player) {
    if (player?.currentmap !== config.map) return false;
    const x = Math.floor(player.x / 32), y = Math.floor(player.y / 32);
    return !occupies(point,x,y) && [point.x,point.x+1].some(px => [point.y,point.y-1].some(py => Math.abs(px-x)+Math.abs(py-y)===1));
}
function adjacent(state, player) { return adjacentPoint(position(state),player); }
function atDais(player) { return adjacentPoint(config.home,player); }
function ready(state, now=Date.now()) { state=normalize(state);return !state || (state.revealed && now>=state.availableAt); }
function choose(candidates,random) {
    const value=Number(random());
    return candidates[Math.max(0,Math.min(candidates.length-1,Math.floor((Number.isFinite(value)?value:0)*candidates.length)))];
}
function create(player, random = Math.random) {
    const x = Math.floor(player?.x / 32), y = Math.floor(player?.y / 32), all=config.stops.map((_,i)=>i);
    const away=all.filter(i=>Math.abs(config.stops[i].x-x)>2||Math.abs(config.stops[i].y-y)>2);
    return {version:2,stop:choose(away.length?away:all,random),previous:null,step:0,revealed:false,availableAt:0};
}
function advance(state, player, now = Date.now(), random = Math.random) {
    state = normalize(state);
    if (!state || state.revealed || now < state.availableAt) return {state,changed:false};
    const reveal=atDais(player);
    if (!reveal && !adjacent(state,player)) return {state,changed:false};
    const point=position(state), all=config.stops.map((_,i)=>i).filter(i=>i!==state.stop&&i!==state.previous);
    const away=all.filter(i=>Math.abs(point.x-config.stops[i].x)+Math.abs(point.y-config.stops[i].y)>=5);
    const stop=reveal?state.stop:choose(away.length?away:all,random);
    const next = {...state,stop,previous:reveal?state.previous:state.stop,
        step:state.step===Number.MAX_SAFE_INTEGER?0:state.step+1,revealed:reveal,availableAt:now+config.duration};
    return {state:next,changed:true,transition:{map:config.map,name:config.actor,
        from:point,to:position(next),duration:config.duration,step:next.step,complete:reveal,kind:reveal?'reveal':'clone'}};
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
        // The real champion stays concealed on the dais, but A can find him.
        // This interaction anchor is deliberately absent from the render list.
        if(occupies(config.home,x,y))return originalActor ? {...originalActor,...config.home} : null;
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
module.exports = {config,normalize,position,occupies,adjacent,atDais,ready,create,advance,scopedStore};

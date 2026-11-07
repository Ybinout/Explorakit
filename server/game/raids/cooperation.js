const config = require('../../../data/game/raid_cooperation.json');
const active = p => !!p && p.hp > 0 && p.isActive && !p.fainted && !p.m.retired;
function validTarget(sim, loc, source, kind) {
    if (!loc) return true; // Native auto-target for side and field moves.
    if (!Number.isInteger(loc)) return false;
    const side = loc < 0 ? source.side : source.side.foe;
    const target = side.active[Math.abs(loc) - 1];
    if (!active(source) || !active(target)) return false;
    const self = target === source, ally = target.side === source.side;
    if (kind === 'normal' || kind === 'any') return !self;
    if (kind === 'adjacentFoe' || kind === 'randomNormal') return !ally;
    if (kind === 'adjacentAlly') return ally && !self;
    if (kind === 'adjacentAllyOrSelf') return ally;
    return false;
}
function targetAvailable(sim, source, move, target) {
    const loc = (source.side===target.side ? -1 : 1) * (target.position+1);
    if (!validTarget(sim, loc, source, move.target)) return false;
    // Helping Hand is a one-turn native boost, not a buff for a later round.
    return move.id!=='helpinghand' || !sim.raid.reactive || !!sim.queue.willMove(target);
}
function unavailable(move) {
    if (move.id==='allyswitch') return 'Les emplacements des quatre alliés sont fixes dans un raid.';
    if (move.category==='Status' && move.selfSwitch || ['healingwish','lunardance'].includes(move.id)) {
        return 'Aucun remplaçant n’est disponible dans un raid.';
    }
    return null;
}
function disableUnavailable(sim,p) {
    for(const slot of p.moveSlots)if(unavailable(sim.dex.moves.get(slot.id)))p.disableMove(slot.id);
}
function equivalentDamage(sim, hp) {
    return Math.max(0,hp) / Math.max(1,sim.sides[1].pokemon[0].maxhp) * config.aggro.damageScale;
}
function supportAggro(move) {
    const a=config.aggro;
    if (move.category!=='Status') return 0;
    if (['reflect','lightscreen','auroraveil','safeguard','mist','luckychant'].includes(move.sideCondition)) return a.screens;
    if (['wideguard','quickguard','matblock','craftyshield'].includes(move.id)) return a.teamGuards;
    if (move.id==='tailwind') return a.tailwind;
    if (move.id==='helpinghand') return a.helpingHand;
    if (move.id==='taunt') return a.taunt;
    if (move.terrain || move.pseudoWeather) return a.terrain;
    if (move.weather) return a.weather;
    if (move.stallingMove || ['protect','detect','kingsshield','spikyshield','banefulbunker','endure'].includes(move.id)) return a.protection;
    if (move.boosts || move.self?.boosts || ['acupressure','aromaticmist','afteryou','quash','coaching','flowershield','rototiller'].includes(move.id)) return a.boosts;
    if (move.status || ['aromatherapy','healbell','purify','haze','clearsmog'].includes(move.id)) return a.status;
    return 0;
}
module.exports={config,active,validTarget,targetAvailable,unavailable,disableUnavailable,equivalentDamage,supportAggro};

// The shared Center interior is used by every town; this blocked cabinet faces a free floor tile.
const TERMINAL = Object.freeze({id:'pokemon-pc', kind:'pc', x:17, y:8});
const HOUSE_TERMINAL = Object.freeze({id:'battle-house-pc', kind:'pc', x:3, y:4});
function terminalsForMap(map) { return map === 'centre' ? [TERMINAL] : map === 'whitepeak_club' ? [HOUSE_TERMINAL] : []; }
function devicesForMap(map) { return {map, devices:map==='professor_lab'?require('../corruption/workstations').STATIONS.map(s=>({kind:'corruption',...s})):terminalsForMap(map).map(d=>({...d}))}; }
function isNearComputer(player) {
    return Boolean(player && terminalsForMap(player.currentmap).some(d => Math.abs(Math.floor(player.x / 32) - d.x) + Math.abs(Math.floor(player.y / 32) - d.y) === 1));
}
function requireComputer(player, available = isNearComputer(player)) {
    if (!available) throw Error('Approche-toi d’un PC Pokémon et appuie sur A.');
    if (player.inbattle) throw Error('Le PC est indisponible pendant un combat.');
}
module.exports = {TERMINAL, HOUSE_TERMINAL, terminalsForMap, devicesForMap, isNearComputer, requireComputer};

// The shared Center interior is used by every town; this blocked cabinet faces a free floor tile.
const TERMINAL = Object.freeze({id:'pokemon-pc', kind:'pc', x:17, y:8});
function devicesForMap(map) { return {map, devices:map === 'centre' ? [{...TERMINAL}] : map==='professor_lab'?require('../corruption/workstations').STATIONS.map(s=>({kind:'corruption',...s})):[]}; }
function isNearComputer(player) {
    return Boolean(player?.currentmap === 'centre'
        && Math.abs(Math.floor(player.x / 32) - TERMINAL.x) + Math.abs(Math.floor(player.y / 32) - TERMINAL.y) === 1);
}
function requireComputer(player, available = isNearComputer(player)) {
    if (!available) throw Error('Approche-toi d’un PC Pokémon et appuie sur A.');
    if (player.inbattle) throw Error('Le PC est indisponible pendant un combat.');
}
module.exports = {TERMINAL, devicesForMap, isNearComputer, requireComputer};

const climates = require('../../../data/game/map_weather.json');
const kinds = new Set(['rain', 'sun', 'sandstorm', 'hail']);
// Map climate is authoritative and shared. Display preferences never change it.
function getMapWeather(map) {
    const entry = typeof map === 'string' && Object.hasOwn(climates, map) ? climates[map] : null;
    return { map, kind: kinds.has(entry?.kind) ? entry.kind : null };
}
function battleWeatherForMap(map, opponentMap = map) {
    const climate = getMapWeather(map);
    if (!climate.kind || map !== opponentMap) return { kind: null, turns: 0 };
    return { kind: climate.kind, turns: 0, persistent: true, source: 'map' };
}
module.exports = { getMapWeather, battleWeatherForMap };

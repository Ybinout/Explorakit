const climates = require('../../../data/game/map_weather.json');
const kinds = new Set(['rain', 'sun', 'sandstorm', 'hail']);
// Map climate is authoritative and shared. Display preferences never change it.
function getMapWeather(map) {
    const entry = typeof map === 'string' && Object.hasOwn(climates, map) ? climates[map] : null;
    const climate = { map, kind: kinds.has(entry?.kind) ? entry.kind : null };
    if (climate.kind && entry.ambience) {
        const level = value => Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
        climate.ambience = { wind: level(entry.ambience.wind), rain: level(entry.ambience.rain) };
    }
    return climate;
}
function battleWeatherForMap(map, opponentMap = map) {
    const climate = getMapWeather(map);
    if (!climate.kind || map !== opponentMap) return { kind: null, turns: 0 };
    return { kind: climate.kind, turns: 0, persistent: true, source: 'map' };
}
module.exports = { getMapWeather, battleWeatherForMap };

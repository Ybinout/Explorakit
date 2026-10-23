const climates = require('../../../data/game/map_weather.json');
const battleKinds = new Set(['rain', 'sun', 'sandstorm', 'hail']);
const kinds = new Set([...battleKinds, 'snow', 'wind']);
// Map climate is authoritative and shared. Display preferences never change it.
function getMapWeather(map) {
    const entry = typeof map === 'string' && Object.hasOwn(climates, map) ? climates[map] : null;
    const climate = { map, kind: kinds.has(entry?.kind) ? entry.kind : null };
    if (climate.kind && entry.ambience) {
        const level = value => Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
        climate.ambience = { wind: level(entry.ambience.wind), rain: level(entry.ambience.rain) };
        if (climate.kind === 'sandstorm') climate.ambience.sand = level(entry.ambience.sand);
        if (climate.kind === 'snow') climate.ambience.snow = level(entry.ambience.snow);
    }
    return climate;
}
function battleWeatherForMap(map, opponentMap = map) {
    const climate = getMapWeather(map);
    // Outdoor snowfall uses the existing Gen 7 ice-weather rules in battle.
    const kind = climate.kind === 'snow' ? 'hail' : climate.kind;
    if (!battleKinds.has(kind) || map !== opponentMap) return { kind: null, turns: 0 };
    return { kind, turns: 0, persistent: true, source: 'map' };
}
module.exports = { getMapWeather, battleWeatherForMap };

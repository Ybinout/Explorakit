// Region topology and habitats follow playable transitions, never obsolete map names.
const { maps } = require('../../../data/game/nextMap.json');
const atlas = require('../../../data/game/region_map.json');
const terrain = require('./mapRepository');
const { profiles } = require('./fishingEncounters');
const legendary = require('./legendaryEncounters');
const safari=require('../../../data/game/safari_encounters.json');
const evolutionRules = [...require('../../../data/game/evolutions.json').rules, ...require('../../../data/game/stone_evolutions.json').rules];
const nodeIds = new Set(atlas.nodes.map(n => n.id));
let cached;
function buildRegion() {
    if (cached) return cached;
    const byName = new Map(maps.filter(m => !m.legacyOnly).map(m => [m.mapName, m]));
    const adjacency = new Map();
    for (const [name] of byName) {
        const links = new Set();
        for(const next of byName.get(name).actionLinks||[])if(byName.has(next))links.add(next);
        try {
            const collision = terrain.loadCollisionData(name);
            terrain.changeMapData(name).forEach((row,y) => row.forEach((tile,x) => {
                if (!tile || collision[y]?.[x]) return;
                const link = terrain.getNextMap(name,x,y);
                if (link && !link.blockedMessage && byName.has(link.nextMap)) links.add(link.nextMap);
            }));
        } catch { /* Unpublished maps are not regional destinations. */ }
        adjacency.set(name, [...links]);
    }
    const reachable = new Set(['start']);
    for (const name of reachable) for (const next of adjacency.get(name) || []) reachable.add(next);
    const nodes = atlas.nodes.filter(n => reachable.has(n.id));
    const aliases = {};
    // Interiors resolve outward, without travelling through another regional node.
    for (const name of reachable) {
        if (name === 'centre') continue; // Shared interior: use the player's saved return town.
        const queue = [name], visited = new Set(queue);
        for (const candidate of queue) {
            if (nodeIds.has(candidate)) { aliases[name] = candidate; break; }
            for (const next of adjacency.get(candidate) || []) if (next !== 'centre' && !visited.has(next)) { visited.add(next); queue.push(next); }
        }
    }
    const edges = new Map();
    for (const node of nodes.filter(n=>n.kind!=='event')) for (const next of adjacency.get(node.id) || []) {
        if (nodeIds.has(next) && atlas.nodes.find(n=>n.id===next)?.kind!=='event') { const pair = [node.id,next].sort(); edges.set(pair.join(':'),pair); }
    }
    const habitats = new Map(), legendaryHabitats = [];
    const add = (id, location) => habitats.set(id, [...(habitats.get(id) || []), location]);
    for (const name of reachable) {
        if (!nodeIds.has(name)) continue;
        const zone = byName.get(name), collision = terrain.loadCollisionData(name);
        if(safari.maps[name]){
            for(const method of ['grass','fishing','rare'])for(const entry of safari.maps[name][method]||[])
                add(entry.id,{map:name,method:method==='fishing'?'fishing':'grass',level:zone.level,day:entry.day,...(method==='rare'?{oneIn:safari.legendaryOneIn}:{})});
            continue;
        }
        const grass = terrain.battleMapData(name).some((row,y) => row.some((tile,x) => tile && !collision[y]?.[x]));
        if (grass && zone.canCapture!==false && zone.wildpokemon?.length) legendaryHabitats.push({ map:name, method:name.startsWith('cave')?'cave':'grass', level:zone.level });
        if (profiles[name]?.length) legendaryHabitats.push({ map:name, method:'fishing', level:zone.level });
        if (grass && zone.canCapture!==false) for (const id of new Set(zone.wildpokemon || [])) add(id, { map:name, method:name.startsWith('cave')?'cave':'grass', level:zone.level });
        for (const [id] of profiles[name] || []) add(id, { map:name, method:'fishing', level:zone.level });
    }
    cached = { public: { ...atlas, nodes, edges:[...edges.values()], aliases }, habitats, legendaryHabitats };
    return cached;
}
function getRegionMap(state={}) {const map=buildRegion().public,dc2=require('./darkContinent2'),visible=state.chartOwned===true;
 return {...map,width:visible?map.width:map.darkContinent2.baseWidth,darkContinent:{...map.darkContinent,label:dc2.islandName(state),enLabel:dc2.islandName(state,true)},...(visible?{darkContinent2:map.darkContinent2}:{darkContinent2:null}),nodes:map.nodes.filter(n=>visible||!dc2.isMap(n.id)),edges:map.edges.filter(([a,b])=>visible||!dc2.isMap(a)&&!dc2.isMap(b)),aliases:Object.fromEntries(Object.entries(map.aliases).filter(([a,b])=>visible||!dc2.isMap(a)&&!dc2.isMap(b)))};
}
function regionLocation(map, centerReturnPoint) {
    const source = map === 'centre' ? centerReturnPoint?.map : map;
    return buildRegion().public.aliases[source] || null;
}
function pokemonLocations(id, known) {
    if (!known) return undefined;
    if (legendary.isLegendary(id)) return { kind:'wild', legendary:{ oneIn:legendary.oneIn, poolSize:legendary.species.length }, locations:buildRegion().legendaryHabitats };
    const habitats = buildRegion().habitats;
    if (habitats.has(id)) return { kind:'wild', locations:habitats.get(id) };
    const visited = new Set([id]), queue = [id], ancestors = [];
    for (const current of queue) for (const rule of evolutionRules.filter(r => r.to === current)) {
        if (visited.has(rule.from)) continue;
        visited.add(rule.from);
        if (habitats.has(rule.from)) ancestors.push({ speciesId:rule.from, locations:habitats.get(rule.from) });
        else queue.push(rule.from);
    }
    return ancestors.length ? { kind:'evolution', ancestors, locations:[] } : { kind:'unavailable', locations:[] };
}
module.exports = { getRegionMap, regionLocation, pokemonLocations };

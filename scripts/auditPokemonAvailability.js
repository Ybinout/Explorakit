const fs = require('node:fs');
const path = require('node:path');
const dex = require('../data/game/pokedex.json');
const { maps } = require('../data/game/nextMap.json');
const { legendary } = require('../server/game/drift/pokemonFactory');
const { profiles } = require('../server/game/world/fishingEncounters');
const terrain = require('../server/game/world/mapRepository');
const evolutionRules = require('../data/game/evolutions.json').rules;
const stoneRules = require('../data/game/stone_evolutions.json').rules;
const MAX_SPECIES = 493;
// Deliberate rewards for raising a companion, not shortcuts in late grass.
const EVOLUTION_ONLY = [3,6,9,149,154,157,160,230,248,254,257,260,289,350,373,376,389,392,395,445,448,468];

function reachableMaps() {
    const reached = new Set(['start']);
    const byName = new Map(maps.map(map => [map.mapName, map]));
    for (const name of reached) {
        const changes = terrain.changeMapData(name), collision = terrain.loadCollisionData(name);
        changes.forEach((row, y) => row.forEach((tile, x) => {
            if (!tile || collision[y]?.[x]) return;
            const link = terrain.getNextMap(name, x, y);
            // Story locks are eventually open; permanent construction barriers aren't.
            if (link && !link.blockedMessage && byName.has(link.nextMap) && !byName.get(link.nextMap).legacyOnly) reached.add(link.nextMap);
        }));
    }
    return reached;
}

function buildReport() {
    const reached = reachableMaps(), sources = new Map();
    const add = (id, source) => sources.set(id, [...(sources.get(id) || []), source]);
    const zones = maps.filter(map => reached.has(map.mapName) && !map.legacyOnly && map.wildpokemon.length && (() => {
        const collision = terrain.loadCollisionData(map.mapName);
        return terrain.battleMapData(map.mapName).some((row,y) => row.some((tile,x) => tile && !collision[y]?.[x]));
    })());
    for (const zone of zones) for (const id of zone.wildpokemon) add(id, { map: zone.mapName, method: 'grass', level: zone.level });
    for (const [map, pool] of Object.entries(profiles)) if (reached.has(map)) for (const [id, weight] of pool) add(id, { map, method: 'fishing', percent: weight });
    const obtained = new Map([...sources].map(([id, locations]) => [id, { method:'capture', locations }]));
    const rules = [...evolutionRules, ...stoneRules];
    let changed = true;
    while (changed) {
        changed = false;
        for (const rule of rules) if (obtained.has(rule.from) && !obtained.has(rule.to) && !legendary.has(rule.to)) {
            obtained.set(rule.to, { method:'evolution', from:rule.from, rule });
            changed = true;
        }
    }
    const eligible = dex.filter(p => p.id <= MAX_SPECIES && !legendary.has(p.id));
    const entries = eligible.map(p => ({ id:p.id, name:p.name.french, ...(obtained.get(p.id) || {method:'missing'}) }));
    return {
        scope:'Générations I–IV, espèces de base (formes alternatives non comptées séparément)',
        total:eligible.length, excluded:MAX_SPECIES-eligible.length,
        direct:entries.filter(p=>p.method==='capture').length,
        evolutionOnly:entries.filter(p=>p.method==='evolution').length,
        zones:zones.map(m=>m.mapName),
        missing:entries.filter(p=>p.method==='missing'),
        forbiddenWild:[...sources.keys()].filter(id=>legendary.has(id)||id>MAX_SPECIES||EVOLUTION_ONLY.includes(id)),
        missingSprites:eligible.flatMap(p=>['dp2','back'].filter(dir=>!fs.existsSync(path.join(__dirname,`../vue-explorakit/src/assets/${dir}/${p.id}.png`))).map(dir=>`${dir}/${p.id}.png`)),
        entries
    };
}
function markdown(report) {
    const lines = ['# Pokémon obtenables — générations I à IV', '',
        'Rapport reproductible : `node scripts/auditPokemonAvailability.js --markdown`. Les cartes inaccessibles, les anciennes routes et les intérieurs sans herbe ne comptent pas. Les verrous de scénario sont considérés ouvrables en progressant.', '',
        `${report.total} espèces non légendaires : **${report.direct} capturables directement**, **${report.evolutionOnly} par évolution uniquement**. ${report.excluded} légendaires/fabuleux exclus. ${report.missing.length} espèce manquante ; ${report.missingSprites.length} sprite manquant.`, '',
        'Les mêmes rencontres sont utilisées en Aventure et en exploration Rift/Colosseum. Les niveaux de début et les poids rares des expéditions restent spécifiques à ces modes. La pêche nécessite la canne du Grand Comptoir. Les branches d’évolution se choisissent dans la fiche ; pierres vendues par les marchands. Les évolutions par échange/bonheur suivent les adaptations solo indiquées dans la fiche.', '',
        'Une présence dans les données ne suffit pas : les tests vérifient aussi les sprites avant/arrière, les deux fabriques sauvages, les conditions des évolutions, leurs capacités requises et les pierres disponibles.', '',
        '| N° | Pokémon | Obtention |', '|---|---|---|'];
    const names = new Map(dex.map(p=>[p.id,p.name.french]));
    for (const p of report.entries) {
        const where = p.method==='capture' ? p.locations.map(l=>`${l.map}${l.method==='fishing'?` (pêche ${l.percent} %)`:''}`).join(', ')
            : p.method==='evolution' ? `Évolution de ${names.get(p.from)} (${p.rule.item || `niv. ${p.rule.level}${p.rule.moveName?`, ${p.rule.moveName}`:''}`})` : '**Manquant**';
        lines.push(`| ${p.id} | ${p.name} | ${where} |`);
    }
    return lines.join('\n')+'\n';
}
if (require.main === module) {
    const report = buildReport();
    process.stdout.write(process.argv.includes('--markdown') ? markdown(report) : JSON.stringify(report,null,2)+'\n');
    if (report.missing.length || report.forbiddenWild.length || report.missingSprites.length) process.exitCode=1;
}
module.exports={buildReport,reachableMaps,MAX_SPECIES,EVOLUTION_ONLY};

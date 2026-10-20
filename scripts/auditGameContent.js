const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gamePath = (...parts) => path.join(root, 'data', 'game', ...parts);
const mapsPath = path.join(root, 'data', 'maps');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function countBy(values) {
    return values.reduce((counts, value) => {
        counts[value || 'non_classe'] = (counts[value || 'non_classe'] || 0) + 1;
        return counts;
    }, {});
}

const activeMaps = readJson(gamePath('nextMap.json')).maps || [];
const interactions = readJson(gamePath('interact.json')) || [];
const pnjs = readJson(gamePath('pnjs.jsonc')).pnjs || [];
const trainerTeams = readJson(gamePath('pnj_teams.json')).pnjs || [];
const items = readJson(gamePath('items.json')).items || [];
const progression = readJson(gamePath('progression.json'));
const mapAliases = readJson(gamePath('mapAliases.json')).aliases || {};
const installedMaps = fs.readdirSync(mapsPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.basename(name, '.json'))
    .sort();

const activeNames = new Set(activeMaps.map((entry) => entry.mapName));
const installedNames = new Set([...installedMaps, ...Object.keys(mapAliases)]);
const destinations = activeMaps.flatMap((entry) => (entry.mapchange || []).map((link) => link.goto));
const reachable = new Set(['start']);
const queue = ['start'];
const mapsByName = new Map(activeMaps.map((entry) => [entry.mapName, entry]));
while (queue.length > 0) {
    const current = mapsByName.get(queue.shift());
    for (const link of current?.mapchange || []) {
        if (!reachable.has(link.goto)) {
            reachable.add(link.goto);
            queue.push(link.goto);
        }
    }
}

const report = {
    maps: {
        installed: installedMaps.length,
        active: activeMaps.length,
        reachableFromStart: [...reachable].filter((name) => activeNames.has(name)).length,
        generatedButInactive: installedMaps.filter((name) => name.startsWith('gen_') && !activeNames.has(name)),
        activeWithoutFile: [...activeNames].filter((name) => !installedNames.has(name)),
        inactiveInstalled: installedMaps.filter((name) => !activeNames.has(name)),
        legacyOnly: activeMaps.filter(entry=>entry.legacyOnly).map(entry=>entry.mapName),
        unreachableActive: [...activeNames].filter((name) => !reachable.has(name) && !mapsByName.get(name).legacyOnly),
        unknownDestinations: [...new Set(destinations.filter((name) => !activeNames.has(name)))]
    },
    content: {
        dialogues: interactions.length,
        dialogueLines: interactions.reduce((total, entry) => total + (entry.sentences || []).length, 0),
        battleDialogues: interactions.filter((entry) => entry.end === 'battle').length,
        placedPnjs: pnjs.length,
        trainerTeams: trainerTeams.length,
        items: items.length,
        itemsByCategory: countBy(items.map((item) => item.category)),
        quests: (progression.quests || []).length,
        badges: (progression.badges || []).length,
        persistentNpcBattles: Object.keys(progression.npcBattles || {}).length,
        battleDialoguesWithoutProgression: interactions
            .filter((entry) => entry.end === 'battle' && !progression.npcBattles?.[entry.name])
            .map((entry) => entry.name)
    },
    balance: {
        mapLevels: activeMaps
            .filter((entry) => entry.level)
            .map((entry) => ({ map: entry.mapName, min: entry.level.min, max: entry.level.max })),
        suspiciousLevelJumps: activeMaps
            .filter((entry) => Number(entry.level?.max) - Number(entry.level?.min) >= 10 || Number(entry.level?.min) >= 80)
            .map((entry) => ({ map: entry.mapName, min: entry.level.min, max: entry.level.max }))
    }
};

console.log(JSON.stringify(report, null, 2));

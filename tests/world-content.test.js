const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getNextMap, loadCollisionData, resolveMapSourceName } = require('../server/game/world/mapRepository');
const { getSentenceForName, getEndSentenceInformation, getTeamInformation } = require('../server/game/world/interactionRepository');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { getPnjsForMap } = require('../server/game/world/pnjStore');
const { getShopCatalog, isShopMap } = require('../server/game/world/shopCatalog');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const worldConfig = readJson('data', 'game', 'nextMap.json').maps;
const generatedEntries = worldConfig.filter((entry) => entry.mapName.startsWith('gen_'));

function technicalLayers(map) {
    return Object.fromEntries(map.layers.map((layer) => [layer.name, layer.data]));
}

function matchesTransition(transition, x, y) {
    const hasX = Number.isInteger(transition.valX);
    const hasY = Number.isInteger(transition.valY);
    return (hasX || hasY)
        && (!hasX || transition.valX === x)
        && (!hasY || transition.valY === y);
}

test('toutes les cartes générées raccordées sont actives et accessibles', () => {
    const activeNames = new Set(worldConfig.map((entry) => entry.mapName));
    const expected = fs.readdirSync(path.join(root, 'data', 'maps'))
        .filter((fileName) => fileName.startsWith('gen_') && fileName.endsWith('.json'))
        .map((fileName) => path.basename(fileName, '.json'));
    expected.forEach((mapName) => {
        assert.ok(activeNames.has(mapName), `${mapName} doit être active`);
        assert.ok(fs.existsSync(path.join(root, 'data', 'maps', `${mapName}.json`)), `${mapName}.json doit exister`);
    });

    const reachable = new Set(['start']);
    const queue = ['start'];
    const byName = new Map(worldConfig.map((entry) => [entry.mapName, entry]));
    while (queue.length) {
        const current = byName.get(queue.shift());
        for (const transition of current?.mapchange || []) {
            if (reachable.has(transition.goto)) continue;
            reachable.add(transition.goto);
            queue.push(transition.goto);
        }
    }
    expected.forEach((mapName) => assert.ok(reachable.has(mapName), `${mapName} doit être accessible depuis start`));
});

test('chaque passage généré possède une destination libre et non ambiguë', () => {
    const activeNames = new Set(worldConfig.map((entry) => entry.mapName));
    for (const entry of generatedEntries) {
        const map = readJson('data', 'maps', `${entry.mapName}.json`);
        const layers = technicalLayers(map);
        assert.ok(layers.coll && layers.change, `${entry.mapName} doit avoir coll et change`);

        layers.change.forEach((tile, index) => {
            if (!tile) return;
            const x = index % map.width;
            const y = Math.floor(index / map.width);
            const matches = entry.mapchange.filter((transition) => matchesTransition(transition, x, y));
            assert.equal(matches.length, 1, `${entry.mapName} (${x},${y}) doit cibler un seul passage`);
        });

        for (const transition of entry.mapchange) {
            assert.ok(activeNames.has(transition.goto), `${entry.mapName} cible une carte active`);
            const target = readJson('data', 'maps', `${transition.goto}.json`);
            const targetLayers = technicalLayers(target);
            const x = Math.floor((transition.nexX + 16) / 32);
            const y = Math.floor((transition.nexY - 16) / 32);
            const index = y * target.width + x;
            assert.equal(targetLayers.coll[index], 0, `${entry.mapName} -> ${transition.goto} arrive sur une case libre`);
            assert.equal(targetLayers.change[index], 0, `${entry.mapName} -> ${transition.goto} ne reboucle pas immédiatement`);
        }
    }
});

test('les raccords vers les intérieurs livrés par l’agent cartes sont exacts', () => {
    for (const source of worldConfig.filter((entry) => entry.mapName.startsWith('gen_ville'))) {
        const map = readJson('data', 'maps', `${source.mapName}.json`);
        const layers = technicalLayers(map);
        const interiors = source.mapchange.filter((transition) => /^gen_(maison|shop)/.test(transition.goto));
        for (const transition of interiors) {
            assert.ok(Number.isInteger(transition.valX) && Number.isInteger(transition.valY), `${source.mapName} -> ${transition.goto} doit cibler une porte exacte`);
            const index = transition.valY * map.width + transition.valX;
            assert.equal(layers.coll[index], 0, `${source.mapName} -> ${transition.goto} doit partir d'une case libre`);
            assert.notEqual(layers.change[index], 0, `${source.mapName} -> ${transition.goto} doit partir d'une case change`);
            assert.equal(getNextMap(source.mapName, transition.valX, transition.valY)?.nextMap, transition.goto);
        }
    }
});

test('chaque nouveau PNJ est posé sur une case libre et possède un dialogue exploitable', () => {
    const pnjs = readJson('data', 'game', 'pnjs.jsonc').pnjs.filter((pnj) => pnj.map.startsWith('gen_'));
    assert.equal(pnjs.length, 22);
    for (const pnj of pnjs) {
        const map = readJson('data', 'maps', `${pnj.map}.json`);
        const layers = technicalLayers(map);
        const index = pnj.y * map.width + pnj.x;
        assert.equal(layers.coll[index], 0, `${pnj.name} doit être sur une case libre`);
        assert.equal(layers.change[index], 0, `${pnj.name} ne doit pas bloquer une transition`);
        assert.ok(getSentenceForName(pnj.interactionName), `${pnj.name} doit avoir un dialogue`);

        if (getEndSentenceInformation(pnj.interactionName) === 'battle') {
            const teamName = getTeamInformation(pnj.interactionName);
            const team = getPnjTeam(teamName);
            assert.ok(team?.pokemons?.length, `${pnj.name} doit avoir une équipe`);
        }
    }
});

test('les PNJ utilisent les planches 4x4 correspondant à leurs portraits', () => {
    const pnjs = readJson('data', 'game', 'pnjs.jsonc').pnjs;
    const expectedSprites = [
        '7ps.png', 'ana.png', 'cynthia.png', 'hoze.png', 'inf.png', 'mom.png',
        'moonpunch.png', 'prof2.png', 'raph.png', 'sana.png', 'village.png', 'wanda.png'
    ];
    const usedSprites = [...new Set(pnjs.map((pnj) => pnj.sprite))].sort();
    assert.deepEqual(usedSprites, expectedSprites);

    for (const spriteName of expectedSprites) {
        const spritePath = path.join(root, 'vue-explorakit', 'src', 'assets', 'pnj', spriteName);
        const png = fs.readFileSync(spritePath);
        assert.equal(png.toString('ascii', 1, 4), 'PNG', `${spriteName} doit être un PNG`);
        assert.equal(png.readUInt32BE(16), 256, `${spriteName} doit contenir quatre colonnes de 64 px`);
        assert.equal(png.readUInt32BE(20), 256, `${spriteName} doit contenir quatre lignes de 64 px`);
        assert.equal(png[25], 6, `${spriteName} doit conserver un canal alpha transparent`);
    }
});

test('ville1 raccorde ses portes existantes à une arène et une boutique indépendantes', () => {
    assert.equal(getNextMap('ville1', 4, 11)?.nextMap, 'ville1_arene');
    assert.equal(getNextMap('ville1', 20, 8)?.nextMap, 'ville1_shop');
    assert.equal(getNextMap('ville1', 15, 8)?.nextMap, 'centre');
    assert.equal(resolveMapSourceName('ville1_arene'), 'gen_arene1');
    assert.equal(resolveMapSourceName('ville1_shop'), 'gen_shop1');
    assert.ok(loadCollisionData('ville1_arene').length > 0);
    assert.ok(loadCollisionData('ville1_shop').length > 0);

    const arenaPnjs = getPnjsForMap('ville1_arene');
    const shopPnjs = getPnjsForMap('ville1_shop');
    assert.equal(arenaPnjs.some((pnj) => pnj.name === 'moonpunch'), true);
    assert.equal(shopPnjs.some((pnj) => pnj.interactionName === 'shop_keeper_ville1'), true);
});

test('le catalogue des boutiques ne vend que des objets tarifés', () => {
    const catalog = getShopCatalog();
    assert.ok(isShopMap('ville1_shop'));
    assert.ok(catalog.length >= 7);
    for (const item of catalog) {
        assert.ok(item.key);
        assert.ok(Number.isInteger(item.price) && item.price > 0);
    }
    assert.equal(getEndSentenceInformation('shop_keeper_ville1'), 'shop');
    assert.equal(getEndSentenceInformation('shop_keeper_1'), 'shop');
});

test('la traduction française couvre toutes les capacités et tous les talents du jeu', () => {
    const translations = readJson('vue-explorakit', 'src', 'data', 'gameNames.fr.json');
    const moves = readJson('data', 'game', 'moves.json');
    const abilities = readJson('data', 'game', 'abilities.gen7.json').abilities;
    assert.deepEqual(moves.filter((move) => !translations.moves[move.ename]), []);
    assert.deepEqual(abilities.filter((ability) => !translations.abilities[ability.name]), []);
});

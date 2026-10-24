const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { getNextMap, loadCollisionData, resolveMapSourceName } = require('../server/game/world/mapRepository');
const { getSentenceForName, getEndSentenceInformation, getTeamInformation } = require('../server/game/world/interactionRepository');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { getPnjsForMap } = require('../server/game/world/pnjStore');
const { getShopCatalog, isShopMap } = require('../server/game/world/shopCatalog');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const worldConfig = readJson('data', 'game', 'nextMap.json').maps;
const generatedEntries = worldConfig.filter((entry) => entry.mapName.startsWith('gen_'));

test('les décors de chaque lieu actif sont inclus dans le contexte Webpack du client', () => {
    const source = fs.readFileSync(path.join(root, 'vue-explorakit/src/services/mapAssets.js'), 'utf8');
    const declaration = source.match(/const mapAssetContext = require\.context\([\s\S]*?\n\);/);
    assert.ok(declaration, 'Le contexte des décors doit être identifiable');
    let assetPattern;
    vm.runInNewContext(declaration[0], {
        require: { context(directory, recursive, pattern) {
            assert.equal(directory, '@/assets');
            assert.equal(recursive, false);
            assetPattern = pattern;
        } }
    });
    for (const { mapName } of worldConfig) {
        const sourceName = resolveMapSourceName(mapName);
        for (const suffix of ['', '_f']) {
            const filename = `${sourceName}${suffix}.png`;
            const exists = fs.existsSync(path.join(root, 'vue-explorakit/src/assets', filename));
            if (suffix && !exists) continue; // Les premiers plans sont optionnels.
            assert.ok(exists, `${mapName} : décor ${filename} absent`);
            assert.ok(assetPattern.test(`./${filename}`), `${mapName} : ${filename} exclu du build client`);
        }
    }
});

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
    expected.filter(mapName=>!byName.get(mapName)?.legacyOnly).forEach((mapName) => assert.ok(reachable.has(mapName), `${mapName} doit être accessible depuis start`));
});

test('chaque passage généré possède une destination libre et non ambiguë', () => {
    const activeNames = new Set(worldConfig.map((entry) => entry.mapName));
    for (const entry of generatedEntries) {
        const map = readJson('data', 'maps', `${resolveMapSourceName(entry.mapName)}.json`);
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
            const target = readJson('data', 'maps', `${resolveMapSourceName(transition.goto)}.json`);
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
    assert.equal(pnjs.length, 40); // Hoze is in Valpierre; Gwenn now guards Route 8.
    for (const pnj of pnjs) {
        const map = readJson('data', 'maps', `${resolveMapSourceName(pnj.map)}.json`);
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

test('les champions conservent leurs planches et les civils utilisent les portraits cohérents de l’atlas', () => {
    const pnjs = readJson('data', 'game', 'pnjs.jsonc').pnjs;
    const expectedSprites = ['7ps.png', 'ana.png', 'hoze.png', 'lucie-pixel-v2.png', 'moonpunch.png', 'raph.png', 'townspeople.png', 'wanda.png'];
    const usedSprites = [...new Set(pnjs.map((pnj) => pnj.sprite))].sort();
    assert.deepEqual(usedSprites, expectedSprites);

    const civilians = pnjs.filter(pnj => pnj.sprite === 'townspeople.png');
    assert.equal(civilians.length, 67);
    const lucie = pnjs.find(pnj => pnj.name === 'lucie_route2');
    assert.equal(lucie.sprite, 'lucie-pixel-v2.png');
    assert.deepEqual(lucie.spriteFrame, {columns:1, rows:1, index:0});
    assert(fs.existsSync(path.join(root, 'vue-explorakit/src/assets/pnj', lucie.sprite)));
    assert(fs.existsSync(path.join(root, 'vue-explorakit/src/assets/image/lucie-v1.png'))); // Splash/portrait unchanged.
    assert.equal(new Set(civilians.map(pnj => pnj.spriteFrame.index)).size, 32);
    const dialogues = readJson('data', 'game', 'interact.json');
    for (const pnj of civilians) {
        const dialogue = dialogues.find(entry => entry.name === pnj.interactionName);
        for (const sentence of dialogue.sentences) {
            assert.equal(sentence.imageName, 'townspeople.png');
            assert.deepEqual(sentence.portraitFrame, pnj.spriteFrame);
        }
    }
    for (const directory of ['pnj', 'image']) {
        const png = fs.readFileSync(path.join(root, 'vue-explorakit', 'src', 'assets', directory, 'townspeople.png'));
        assert.equal(png.readUInt32BE(16) / 8, png.readUInt32BE(20) / 4, 'les cases de l’atlas doivent être carrées');
        assert.ok(png.readUInt32BE(16) / 8 >= 128);
        assert.equal(png[25], 6);
    }
    for (const spriteName of expectedSprites) {
        const spritePath = path.join(root, 'vue-explorakit', 'src', 'assets', 'pnj', spriteName);
        const png = fs.readFileSync(spritePath);
        assert.equal(png.toString('ascii', 1, 4), 'PNG', `${spriteName} doit être un PNG`);
        if (spriteName === 'townspeople.png') continue;
        if (spriteName === 'lucie-pixel-v2.png') {
            assert.equal(png.readUInt32BE(16),24);assert.equal(png.readUInt32BE(20),32);
            assert.equal(png[25],6);continue; // Single low-resolution pose, no atlas crop.
        }
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

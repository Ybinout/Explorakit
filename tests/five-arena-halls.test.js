const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const maps = require('../server/game/world/mapRepository');
const pnjs = require('../server/game/world/pnjStore');
const { nearestSafePosition } = require('../server/game/world/safePosition');
const world = require('../data/game/nextMap.json').maps;
const halls = [['ville1_arene','moonpunch'],['ville_safe1_arene','hoze'],['gen_arene5','raphael'],['ville3_arene','ana'],['ville4_arene','wanda']];

for (const [name,champion] of halls) {
    test(`${champion}: standalone image, editable map and server layers agree`, () => {
        assert.equal(maps.resolveMapSourceName(name),name);
        const map = maps.readMap(name);
        const xml = fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8');
        const layers = [...xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data encoding="csv">([\s\S]*?)<\/data>/g)];
        assert.equal(layers.length,map.layers.length);
        for(const [,label,csv] of layers) assert.deepEqual(csv.trim().split(/[,\s]+/).map(Number),map.layers.find(l=>l.name===label).data);
        const png = fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/assets',name+'.png'));
        assert.equal(png.readUInt32BE(16),map.width*map.tilewidth);
        assert.equal(png.readUInt32BE(20),map.height*map.tileheight);
        assert(map.layers.find(l=>l.name==='sol interieur').data.every(Boolean));
        assert(map.layers.find(l=>l.name==='battle').data.every(v=>!v));
        assert.equal(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets',name+'_f.png')),false);
    });
    test(`${champion}: city door, champion and both exit tiles are reachable; old positions recover`, () => {
        const collision = maps.loadCollisionData(name), seen = new Set(), queue = [[13,16]];
        for(let i=0;i<queue.length;i++) {
            const [x,y] = queue[i], key = `${x},${y}`;
            if(seen.has(key)||collision[y]?.[x]!==0||pnjs.isPnjBlockingTile(name,x,y))continue;
            seen.add(key);
            for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x+dx,y+dy]);
        }
        assert.deepEqual(pnjs.getPnjsForMap(name).map(p=>[p.name,p.x,p.y]),[[champion,13,4]]);
        assert(seen.has('13,5'));
        const city = world.find(m=>m.mapchange.some(c=>c.goto===name));
        const door = city.mapchange.find(c=>c.goto===name);
        const enter = maps.getNextMap(city.mapName,door.valX,door.valY);
        assert.equal(enter.nextMap,name);
        assert(seen.has(`${Math.floor(enter.nextX/32)},${Math.floor(enter.nextY/32)}`));
        for(const x of [13,14]) {
            assert(seen.has(`${x},17`));
            const exit = maps.getNextMap(name,x,17);
            assert.equal(exit.nextMap,city.mapName);
            assert.deepEqual([Math.floor(exit.nextX/32),Math.floor(exit.nextY/32)],[door.valX,door.valY+1]);
            assert.equal(maps.loadCollisionData(city.mapName)[door.valY+1][door.valX],0);
        }
        for(let y=0;y<20;y++)for(let x=0;x<28;x++)if(!collision[y][x]&&!pnjs.isPnjBlockingTile(name,x,y))assert(seen.has(`${x},${y}`),'no disconnected floor');
        for(const [x,y]of [[3,10],[24,10],[13,1],[13,4],[0,0]]) {
            const p = nearestSafePosition(x*32+16,y*32+16,collision,name,{allowTransition:false});
            assert(seen.has(`${Math.floor(p.x/32)},${Math.floor(p.y/32)}`));
            assert.equal(maps.changeMapData(name)[Math.floor(p.y/32)][Math.floor(p.x/32)],0);
        }
    });
}

test('archived interiors retain their own sources and their archivist', () => {
    for(const name of ['gen_arene1','gen_arene2','gen_arene3','gen_arene4'])assert.equal(maps.resolveMapSourceName(name),name);
    assert.equal(pnjs.getPnjsForMap('gen_arene1')[0].name,'archiviste_eloi');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const maps = require('../server/game/world/mapRepository');
const pnjs = require('../server/game/world/pnjStore');
const { nearestSafePosition } = require('../server/game/world/safePosition');
const name = 'ville5_arene';

function accessible() {
    const collision = maps.loadCollisionData(name), seen = new Set(), queue = [[13,16]];
    for (let i = 0; i < queue.length; i++) {
        const [x,y] = queue[i], key = `${x},${y}`;
        if (seen.has(key) || collision[y]?.[x] !== 0 || pnjs.isPnjBlockingTile(name,x,y)) continue;
        seen.add(key);
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) queue.push([x+dx,y+dy]);
    }
    return seen;
}

test('7p has an independent painted map; source JSON and editable TMX agree', () => {
    assert.equal(maps.resolveMapSourceName(name), name);
    assert.equal(maps.resolveMapSourceName('gen_arene2'), 'gen_arene2');
    const map = maps.readMap(name);
    const xml = fs.readFileSync(path.join(__dirname,'../data/maps/ville5_arene.tmx'),'utf8');
    const layers = [...xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data encoding="csv">([\s\S]*?)<\/data>/g)];
    assert.equal(layers.length,map.layers.length);
    for (const [,name,data] of layers) assert.deepEqual(data.trim().split(/[,\s]+/).map(Number),map.layers.find(l=>l.name===name).data);
    const png = fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/assets/ville5_arene.png'));
    assert.equal(png.readUInt32BE(16), map.width*map.tilewidth);
    assert.equal(png.readUInt32BE(20), map.height*map.tileheight);
    assert(map.layers.find(l=>l.name==='sol interieur').data.every(Boolean));
    for (const layer of map.layers.filter(l=>l.name!=='sol interieur')) assert.equal(layer.visible,false);
});

test('arrival, champion conversation and both door tiles share one playable floor', () => {
    const seen = accessible(), collision = maps.loadCollisionData(name);
    assert(seen.has('13,5'));
    assert.deepEqual(pnjs.getPnjsForMap(name).map(p=>[p.name,p.x,p.y]),[['sevenp',13,4]]);
    for (let y=0;y<20;y++) for(let x=0;x<28;x++) {
        if (!collision[y][x] && !pnjs.isPnjBlockingTile(name,x,y)) assert(seen.has(`${x},${y}`));
    }
    for (const x of [13,14]) {
        assert(seen.has(`${x},17`));
        const exit = maps.getNextMap(name,x,17);
        assert.equal(exit.nextMap,'ville5');
        assert.equal(maps.loadCollisionData('ville5')[Math.floor(exit.nextY/32)][Math.floor(exit.nextX/32)],0);
    }
    for (const [x,y] of [[3,10],[24,10],[13,1],[12,17],[15,17]]) assert(collision[y][x]);
    assert(maps.readMap(name).layers.find(l=>l.name==='battle').data.every(v=>!v));
});

test('old saves inside new walls recover to nearby reachable terrain', () => {
    const seen = accessible(), collision = maps.loadCollisionData(name);
    for (const [x,y] of [[3,10],[24,10],[13,1],[13,4],[0,0],[13,16]]) {
        const p = nearestSafePosition(x*32+16,y*32+16,collision,name,{allowTransition:false});
        assert(seen.has(`${Math.floor(p.x/32)},${Math.floor(p.y/32)}`));
        assert.equal(maps.changeMapData(name)[Math.floor(p.y/32)][Math.floor(p.x/32)],0);
    }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { encounterChances, chooseOrdinarySpecies } = require('../server/game/world/wildEncounterPool');
const { maps } = require('../data/game/nextMap.json');
const wild = require('../server/game/world/wildPokemonFactory');
const legendary = require('../server/game/world/legendaryEncounters');
const route3 = maps.find(map => map.mapName === 'route3');
const close = (a,b) => assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const sequence = (...draws) => () => { assert(draws.length,'Unexpected extra random draw');return draws.shift(); };

test('Route 3 grants Magnemite 7% of ordinary encounters and shares 93% across all other species', () => {
    const chances = encounterChances(route3);
    assert.equal(chances.length,28);
    assert.equal(chances.find(([id])=>id===81)[1],7);
    close(chances.reduce((sum,[,rate])=>sum+rate,0),100);
    for (const [id,rate] of chances) if (id!==81) close(rate,93/27);
    assert.equal(new Set(chances.map(([id])=>id)).size,28);
});

test('10,000 equiprobable ordinary draws yield exactly 700 Magnemite and retain every other Route 3 species', () => {
    const counts = new Map();
    for (let i=0;i<10000;i++) {
        const id = chooseOrdinarySpecies(route3,sequence((i+.5)/10000));
        counts.set(id,(counts.get(id)||0)+1);
    }
    assert.equal(counts.get(81),700);
    assert.equal(counts.size,28);
    for (const [id,count] of counts) if (id!==81) assert(count===344||count===345);
});

test('each interval, both Magnemite boundaries and the upper rounding boundary remain reachable', () => {
    const chances = encounterChances(route3);
    let lower=0;
    for (const [id,rate] of chances) {
        assert.equal(chooseOrdinarySpecies(route3,sequence((lower+rate/2)/100)),id);
        if (id===81) {
            assert.notEqual(chooseOrdinarySpecies(route3,sequence((lower-1e-8)/100)),81);
            assert.equal(chooseOrdinarySpecies(route3,sequence((lower+1e-8)/100)),81);
            assert.equal(chooseOrdinarySpecies(route3,sequence((lower+rate-1e-8)/100)),81);
            assert.notEqual(chooseOrdinarySpecies(route3,sequence((lower+rate+1e-8)/100)),81);
        }
        lower+=rate;
    }
    assert.equal(chooseOrdinarySpecies(route3,sequence(1-Number.EPSILON)),route3.wildpokemon.at(-1));
});

test('all unconfigured maps retain the exact old draw, index, species and single RNG call', () => {
    for (const map of maps.filter(map=>!map.adventureEncounterRates&&map.wildpokemon.length)) {
        for (let i=0;i<1000;i++) {
            const value=(i+.5)/1000;
            assert.equal(chooseOrdinarySpecies(map,sequence(value)),map.wildpokemon[Math.floor(value*map.wildpokemon.length)],map.mapName);
        }
    }
});

test('invalid overrides fall back to uniform probabilities without dropping species', () => {
    for (const rates of [[],{}, {'999':7}, {'1':-1}, {'1':101}, {'1':'7'}, {'1':NaN}, {'1':Infinity}, {'1':60,'2':60}, {'1':20,'2':20,'3':20}]) {
        const map={wildpokemon:[1,2,3],adventureEncounterRates:rates};
        for (const [id,rate] of encounterChances(map)) {assert(map.wildpokemon.includes(id));close(rate,100/3);}
    }
});

test('empty pools do not consume RNG, and valid fully specified or zero-rate pools skip zero intervals', () => {
    assert.equal(chooseOrdinarySpecies({wildpokemon:[]},()=>{throw Error('Unexpected roll');}),null);
    const map={wildpokemon:[1,2,3],adventureEncounterRates:{1:0,2:100,3:0}};
    for (const value of [0,.5,1-Number.EPSILON]) assert.equal(chooseOrdinarySpecies(map,sequence(value)),2);
});

test('real Adventure factory uses the weighted pool, unchanged zone levels, natural moves and module bonus', async () => {
    const chances=encounterChances(route3),index=chances.findIndex(([id])=>id===81);
    const draw=(chances.slice(0,index).reduce((sum,[,rate])=>sum+rate,0)+3.5)/100;
    for (const active of [false,true]) for (const [levelDraw,expected] of [[0,19],[1-Number.EPSILON,23]]) {
        const p=await wild('route3',sequence(.5,draw,levelDraw),{experienceModuleActive:active});
        assert.equal(p.data.id,81);assert.equal(p.level,expected+(active?18:0));assert(p.currentHp>0&&p.abilities.length>0);
    }
});

test('the independent legendary roll still wins before the override and never draws an ordinary species', async () => {
    const p=await wild('route3',sequence(0,.5,0));
    assert.equal(p.data.id,legendary.species[Math.floor(.5*legendary.species.length)]);
    assert.equal(p.level,19);
    assert.equal(legendary.oneIn,3000);
});

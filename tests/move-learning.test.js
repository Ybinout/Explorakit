const test = require('node:test');
const assert = require('node:assert/strict');
const factory = require('../server/game/drift/pokemonFactory');
const { resolveMoveChoice } = require('../server/game/models/moveLearning');
const { getMaxMovePp, getMoveDefinition } = require('../server/game/battle/battleResources');
const codec = require('../server/game/drift/checkpointCodec');
const { pokemonToRow, rowToPokemon, POKEMON_COLUMNS } = require('../server/persistence/teamRepository');
const advance = (p, level) => p.gainExperience(p.getNextLevelExpForLevel(level) - p.experience);

test('level-up queues legal moves at crossed levels, including multiple moves, without replacing four known attacks', () => {
    const p = factory.create(1, 5), before = [...p.abilities];
    p.movePp = [1,2,3,4];
    advance(p, 14);
    assert.deepEqual(p.pendingMoves.map(c=>[c.level,c.move]), [[7,'Leech Seed'],[13,'Poison Powder'],[13,'Sleep Powder']]);
    assert.deepEqual(p.abilities, before);assert.deepEqual(p.movePp,[1,2,3,4]);
    const offers = JSON.stringify(p.pendingMoves);p.gainExperience(0);assert.equal(JSON.stringify(p.pendingMoves), offers);
    for (const c of p.pendingMoves) assert(getMoveDefinition(c.move));
});

test('replacement, free slot and decline preserve unrelated PP; forged, repeated and KO choices are refused', () => {
    const p = factory.create(1, 5);advance(p, 14);p.movePp = [1,2,3,4];
    const first = p.pendingMoves[0].id;
    for (const slot of [undefined, -1,4,1.2,'0']) assert.throws(()=>resolveMoveChoice(p,{choiceId:first,slot}));
    assert.throws(()=>resolveMoveChoice(p,{choiceId:'forged',slot:0}));
    Object.assign(p,resolveMoveChoice(p,{choiceId:first,slot:1}));
    assert.equal(p.abilities[1], 'Leech Seed');assert.deepEqual(p.movePp,[1,getMaxMovePp('Leech Seed'),3,4]);
    assert.throws(()=>resolveMoveChoice(p,{choiceId:first,slot:1}));
    const before = [...p.abilities];Object.assign(p,resolveMoveChoice(p,{choiceId:p.pendingMoves[0].id,slot:null}));
    assert.deepEqual(p.abilities, before);assert.equal(p.pendingMoves.length,1);
    p.abilities.pop();p.movePp.pop();Object.assign(p,resolveMoveChoice(p,{choiceId:p.pendingMoves[0].id,slot:3}));
    assert.equal(p.abilities[3],'Sleep Powder');assert.equal(p.abilities.length,4);assert.equal(p.pendingMoves.length,0);
    advance(p,20);p.currentHp=0;assert.throws(()=>resolveMoveChoice(p,{choiceId:p.pendingMoves[0].id,slot:0}));
});

test('unresolved offers persist identically through Adventure rows and Rift checkpoints; old saves remain readable', () => {
    const p = factory.create(1,5);advance(p,14);
    const row=Object.fromEntries(POKEMON_COLUMNS.map((key,i)=>[key,pokemonToRow(p,1,1)[i]]));
    const adventure=rowToPokemon(row), drift=codec.decode(codec.encode(p));
    for(const restored of [adventure,drift]) {
        assert.deepEqual(restored.pendingMoves,p.pendingMoves);
        Object.assign(restored,resolveMoveChoice(restored,{choiceId:p.pendingMoves[0].id,slot:0}));
        assert.equal(restored.abilities[0],'Leech Seed');
    }
    delete row.pending_moves;assert.deepEqual(rowToPokemon(row).pendingMoves,[]);
    const old=factory.create(1,5);delete old.pendingMoves;advance(old,7);assert.equal(old.pendingMoves[0].move,'Leech Seed');
});

test('evolution retains pending choices and adds its evolution move, with no duplicate', () => {
    const p=factory.create(4,5);advance(p,10);const previous=[...p.pendingMoves];
    p.updatePokemon(6);
    assert(previous.every(c=>p.pendingMoves.some(n=>n.id===c.id)));
    assert(p.pendingMoves.some(c=>c.move==='Wing Attack'));
    const size=p.pendingMoves.length;p.updatePokemon(6);assert.equal(p.pendingMoves.length,size);
});

test('offline learnsets contain only playable moves and the client comparisons match the engine', () => {
    const data=require('../data/game/level_up_moves.json');
    const ui=require('../vue-explorakit/src/data/moveLearning.json');
    for (const entries of Object.values(data.species)) for (const [level,name] of entries) {
        assert(Number.isInteger(level)&&level>=0&&level<=100);const m=getMoveDefinition(name);assert(m,name);
        assert.equal(ui[name].pp,m.pp);assert.equal(ui[name].power,m.power||0);
    }
});

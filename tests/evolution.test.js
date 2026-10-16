const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Pokemon = require('../server/game/models/Pokemon');
const evolution = require('../server/game/models/evolution');
const { getTotalExperienceForLevel, getExperienceRate } = require('../server/game/models/progression');
const { pokemonToRow, rowToPokemon, POKEMON_COLUMNS } = require('../server/persistence/teamRepository');
const codec = require('../server/game/drift/checkpointCodec');
const dex = require('../data/game/pokedex.json');
function specimen(id, level = 5) {
    const d = dex.find(p => p.id === id);
    return new Pokemon(id, d.name.french, level, getTotalExperienceForLevel(level, getExperienceRate(d.exp)), null, 'Bashful', 2);
}
const advance = (p, level) => p.gainExperience(p.getNextLevelExpForLevel(level) - p.experience);
const restore = p => rowToPokemon(Object.fromEntries(POKEMON_COLUMNS.map((key, i) => [key, pokemonToRow(p, 1, 1)[i]])));

test('species thresholds replace random evolution in Adventure and both expedition formats', () => {
    for (const expedition of [undefined, true]) for (const [id, level, target] of [[1,16,2],[4,16,5],[7,16,8],[10,7,11],[11,10,12],[129,20,130],[147,30,148],[148,55,149],[633,50,634],[634,64,635]]) {
        const p = specimen(id, level - 1);p.stoneEvolutions = expedition;
        p.gainExperience(1);assert.equal(p.data.id,id);
        advance(p, level);assert.equal(p.data.id,target,`${id} at ${level}`);
        assert.equal(p.name,p.truename);assert.equal(p.level,level);
    }
});
test('large XP awards traverse intermediate species and their learnsets in order', () => {
    const p = specimen(4), states = [], update = p.updatePokemon;
    p.updatePokemon = function(id) { states.push([id,this.level]);return update.call(this,id); };
    advance(p,40);assert.deepEqual(states,[[5,16],[6,36]]);assert.equal(p.data.id,6);
    assert(p.pendingMoves.some(m=>m.speciesId===5));assert(p.pendingMoves.some(m=>m.speciesId===6&&m.move==='Wing Attack'));
    const ids=p.pendingMoves.map(m=>m.id);p.gainExperience(0);assert.deepEqual(p.pendingMoves.map(m=>m.id),ids);
});
test('overlevelled legacy companions catch up with positive XP or one explicit choice at a time', () => {
    const p=specimen(4,50);assert.equal(p.data.id,4);p.gainExperience(0);assert.equal(p.data.id,4);
    evolution.evolve(p,{fromSpeciesId:4,targetId:5});assert.equal(p.data.id,5);assert.equal(p.level,50);
    assert.throws(()=>evolution.evolve(p,{fromSpeciesId:4,targetId:5}),/plus disponible/);
    p.gainExperience(1);assert.equal(p.data.id,6);assert.equal(p.level,50);
});
test('trade, friendship and special evolutions are accessible solo with documented levels', () => {
    for(const [id,level,to] of [[64,36,65],[93,36,94],[42,32,169],[113,30,242],[349,30,350],[215,40,461],[705,50,706],[686,30,687],[458,32,226],[808,40,809]]) {
        const p=specimen(id,level-1);advance(p,level);assert.equal(p.data.id,to);assert(evolution.options(specimen(id,level-1)).some(o=>o.adaptation));
    }
});
test('branch decisions never depend on rule order; stone branches cannot be bypassed', () => {
    const eevee=specimen(133,19);advance(eevee,20);assert.equal(eevee.data.id,133);
    assert(evolution.options(eevee).find(o=>o.targetId===196).ready);assert(evolution.options(eevee).find(o=>o.targetId===197).ready);
    assert(!evolution.options(eevee).find(o=>o.targetId===700).ready);
    assert.throws(()=>evolution.evolve(eevee,{fromSpeciesId:133,targetId:134}),/conditions/);
    eevee.abilities=['Baby-Doll Eyes'];assert(evolution.options(eevee).find(o=>o.targetId===700).ready);
    evolution.evolve(eevee,{fromSpeciesId:133,targetId:700});assert.equal(eevee.data.id,700);
    const slow=specimen(79,36);advance(slow,37);assert.equal(slow.data.id,79);assert(evolution.options(slow).find(o=>o.targetId===80).ready);assert(!evolution.options(slow).find(o=>o.targetId===199).ready);
    for(const id of [25,44,58,61,70,90,102,133]){const p=specimen(id,80);p.gainExperience(10);assert.equal(p.data.id,id);}
    const nincada=specimen(290,19);advance(nincada,20);assert.equal(nincada.data.id,290);evolution.evolve(nincada,{fromSpeciesId:290,targetId:292});assert.equal(nincada.data.id,292);
});
test('gender, actual known move, permanent stats and stable personality select correct branches', () => {
    const female=specimen(415,20);female.gender='female';advance(female,21);assert.equal(female.data.id,416);
    const male=specimen(415,20);male.gender='male';advance(male,30);assert.equal(male.data.id,415);
    const espurr=specimen(677,24);espurr.gender='female';advance(espurr,25);assert.equal(espurr.data.id,678);
    const yanma=specimen(193,40);yanma.abilities=['Tackle'];yanma.gainExperience(1);assert.equal(yanma.data.id,193);yanma.abilities=['Ancient Power'];yanma.gainExperience(1);assert.equal(yanma.data.id,469);
    const tyrogue=specimen(236,20);tyrogue.attack=20;tyrogue.defense=10;assert.equal(evolution.automatic(tyrogue).to,106);tyrogue.attack=10;tyrogue.defense=20;assert.equal(evolution.automatic(tyrogue).to,107);tyrogue.attack=20;assert.equal(evolution.automatic(tyrogue).to,237);
    const wurmple=specimen(265,7),branch=evolution.automatic(wurmple).to;assert([266,268].includes(branch));assert.equal(evolution.automatic(restore(wurmple)).to,branch);assert.equal(evolution.automatic(codec.decode(codec.encode(wurmple))).to,branch);
});
test('evolution preserves identity, nickname, wounds, moves/PP, item, XP curve and level after SQL/checkpoint reload', () => {
    for(const [id,to,level] of [[4,5,16],[183,184,18],[316,317,26],[318,319,30]]) {
        const p=specimen(id,level);p.name='Mon compagnon';p.abilities=['Tackle'];p.movePp=[3];p.heldItem='life_orb';p.status='burn';p.currentHp-=7;
        const before={uuid:p.uuid,xp:p.experience,rate:p.experienceRate,iv:{...p.iv},ev:{...p.ev}};
        evolution.evolve(p,{fromSpeciesId:id,targetId:to});
        for(const result of [p,restore(p),codec.decode(codec.encode(p))]){assert.equal(result.uuid,before.uuid);assert.equal(result.level,level);assert.equal(result.experience,before.xp);assert.equal(result.experienceRate,before.rate);assert.equal(result.name,'Mon compagnon');assert.equal(result.maxHp-result.currentHp,7);assert.equal(result.status,'burn');assert.equal(result.heldItem,'life_orb');assert.deepEqual(result.movePp,[3]);assert.deepEqual(result.iv,before.iv);assert.deepEqual(result.ev,before.ev);}
    }
});
test('KO and forged choices cannot evolve; old rows with no saved XP curve retain their existing level', () => {
    const p=specimen(4,16);p.currentHp=0;p.checkEvolution();assert.equal(p.data.id,4);assert.throws(()=>evolution.evolve(p,{fromSpeciesId:4,targetId:5}),/conditions/);
    p.currentHp=p.maxHp;for(const targetId of [6,150,'5',null])assert.throws(()=>evolution.evolve(p,{fromSpeciesId:4,targetId}));
    const row=Object.fromEntries(POKEMON_COLUMNS.map((key,i)=>[key,pokemonToRow(p,1,1)[i]]));delete row.experience_rate;assert.equal(rowToPokemon(row).level,16);
});
test('all 809 identifiers and all non-stone targets are valid, distinct and have front/back sprites', () => {
    assert.equal(new Set(dex.map(p=>p.id)).size,809);assert.equal(dex.find(p=>p.id===27).name.french,'Sabelette');
    const rules=require('../data/game/evolutions.json').rules;assert.equal(new Set(rules.map(r=>`${r.from}:${r.to}`)).size,rules.length);
    for(const r of rules){assert(dex.some(p=>p.id===r.from));assert(dex.some(p=>p.id===r.to));assert(r.level>=1&&r.level<=100);for(const folder of ['back','dp2'])assert(fs.existsSync(path.join(__dirname,`../vue-explorakit/src/assets/${folder}/${r.to}.png`)));}
});

const test=require('node:test'),assert=require('node:assert/strict');
const {calculateBattleExperience:xp,overlevelExperienceFactor:factor}=require('../server/game/models/progression');
const colosseum=require('../server/game/drift/colosseum');
const effects=require('../server/game/drift/driftEffects');
const factory=require('../server/game/drift/pokemonFactory');
const engine=require('../server/game/battle/battleEngine');
const codec=require('../server/game/drift/checkpointCodec');
const {DriftBattle}=require('../server/game/drift/driftBattle');

test('overlevel XP is smooth, bounded, ignores raw accumulated XP and preserves close fights',()=>{
    assert.equal(factor(40,45),1);assert.equal(factor(80,88),1);
    assert.equal(factor(40,50),.8);assert.equal(factor(40,65),.2);
    assert.equal(factor(40,100),.1);
    for(let enemy=1;enemy<=100;enemy++) {
        let previous=Infinity;
        for(let recipient=enemy;recipient<=100;recipient++) {
            const gain=xp({level:enemy,k:1,experience:99999999},2,{level:recipient});
            assert(gain<=previous && gain>=1);previous=gain;
            assert.equal(gain,xp({level:enemy,k:1,experience:0},2,{level:recipient}));
        }
    }
    assert.equal(xp({level:40,k:1},1,{level:40}),1452);
    assert(xp({level:40,k:1},1,{level:70})<xp({level:40,k:1},1,{level:40})*.1);
});
for(const mode of ['rift','colosseum'])test(`${mode}: an overlevel lead does not penalize a low reserve; KO and duplicate rewards stay excluded`,()=>{
    const low=factory.create(1,10),high=factory.create(94,60),dead=factory.create(7,10),enemy=factory.create(19,15);
    dead.currentHp=0;
    const drift={uuid:'share',definitionId:'DRF-050',rarity:'mythic'};
    const p={run:{mode},drifts:[drift],equipped:['share'],equipe:{pokemons:[high,low,dead]}};
    const before=[high.experience,low.experience,dead.experience];
    const b=Object.assign(Object.create(DriftBattle.prototype),{a:p,type:'wild',rewarded:new Set(),emit(){}});
    b.reward(enemy);b.reward(enemy);
    assert(low.experience-before[1]>high.experience-before[0]);assert.equal(dead.experience,before[2]);
    const base=xp(enemy,1.1,{level:10});
    assert.equal(low.experience-before[1],Math.floor((mode==='colosseum'?Math.floor(base*4.8):base*2)*(mode==='colosseum'?.75:.35)));
});

test('v4 guardians gain at most three levels, capped at 100; points, ordinary waves and legacy loadouts are stable',()=>{
    for(let wave=1;wave<=65;wave++) {
        const modern=colosseum.waveInfo(wave,4),legacy=colosseum.waveInfo(wave,3);
        assert.deepEqual(modern.preview,legacy.preview);assert.deepEqual(modern.difficulty,legacy.difficulty);
        assert.equal(modern.points,legacy.points);
        assert.equal(modern.level,Math.min(100,legacy.level+(wave%5===0?Math.min(3,Math.ceil(wave/10)):0)));
        assert(modern.drifts.length<=3);
        assert.equal(modern.drifts.length,wave%5===0?(wave>=20?3:wave>=10?2:1):0);
        assert.deepEqual(modern.drifts,colosseum.opponent(wave,4).drifts);
        assert.deepEqual(colosseum.opponent(wave,3).drifts,[]);
    }
    for(const version of [1,2,3])for(const wave of [5,10,15,20]) {
        const old=colosseum.opponent(wave,version);
        assert.deepEqual(old.equipped,[]);assert(old.equipe.pokemons.every(p=>p.level===10+(wave-1)*3));
    }
});

test('guardian Drifts actually mitigate damage and remove a boost, with loadouts retained in checkpoints',()=>{
    const owner=codec.decode(codec.encode({boss:colosseum.opponent(20)})).boss;
    assert.equal(owner.drifts.length,3);assert.deepEqual(owner.equipped,owner.drifts.map(d=>d.uuid));
    const foe=factory.create(94,70),guardian=owner.equipe.pokemons[0];
    engine.ensureBattleData(foe);engine.ensureBattleData(guardian);
    foe.__battle.statStages.specialAttack=4;
    effects.attach(owner.equipe.pokemons,owner,false,()=>0);
    effects.attach([foe],{drifts:[],equipped:[],chain:0},false,()=>0);
    const move=engine.getMoveByName('Tackle');
    assert.equal(effects.multiplier(foe,guardian,move,false),.95);
    effects.afterMove(guardian,foe,{move,success:true,damage:10},{stage:(p,key,delta)=>p.__battle.statStages[key]+=delta});
    assert.equal(foe.__battle.statStages.specialAttack,3);
    effects.detach([...owner.equipe.pokemons,foe]);
});

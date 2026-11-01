const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const model=require('../server/game/battle/humanTrainerModel'),factory=require('../server/game/drift/pokemonFactory');
const {machines,teachMachine}=require('../server/game/items/machines');
function mon(id,name='Splash',extra={}) {
    return Object.assign(factory.create(id,50,true),{uuid:`requested-${id}`,currentHp:500,maxHp:500,
        currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,
        passiveAbility:null,heldItem:null,status:'normal',abilities:[name],movePp:[resources.getMaxMovePp(name)],
        __battle:{statStages:{}}},extra);
}
function fixture(name,extra={},target={}) {
    const a=mon(7,name,extra),b=mon(143,'Splash',target),state=engine.createBattleState();
    return {a,b,state,cast:()=>engine.useattack(name,a,b,{battleState:state,attackerSide:state.sides.player,
        defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]})};
}
function fixed(work,roll=.5){const old=Math.random;Math.random=()=>roll;try{return work();}finally{Math.random=old;}}
test('requested moves have correct data, translations, descriptions and contact flags',()=>{
    const names=require('../vue-explorakit/src/data/gameNames.fr.json');
    const ref=require('../vue-explorakit/src/data/pokemonReference.fr.json');
    for(const [name,power,pp,type]of [['Wave Crash',120,10,'Water'],['Ice Spinner',80,15,'Ice']]){
        const m=engine.getMoveByName(name);assert.equal(m.power,power);assert.equal(m.pp,pp);
        assert.equal(m.type,type);assert.equal(m.accuracy,100);assert.equal(m.combat.damage_class,'physical');
        assert.equal(require('../server/game/abilities/abilityEngine').getMoveFlags(m).contact,true);
        assert(ref.moves[name].description.length>40);
    }
    assert(JSON.stringify(names).includes('Aquatacle'));assert(JSON.stringify(names).includes('Cryo-Pirouette'));
});
test('Aquatacle recoil uses damage actually dealt, including substitutes and low-HP targets',()=>fixed(()=>{
    for(const mode of['normal','substitute','low-hp']){
        const f=fixture('Wave Crash');if(mode==='substitute')f.b.__battle.substituteHp=20;if(mode==='low-hp')f.b.currentHp=10;
        const result=f.cast(),dealt=result.damage+result.substituteDamage;
        assert(dealt>0);assert.equal(500-f.a.currentHp,Math.max(1,Math.floor(dealt*.33)));
        assert.equal(f.a.movePp[0],9);
    }
}));
test('Aquatacle respects recoil immunity and its contact/recoil ability bonuses',()=>fixed(()=>{
    const base=fixture('Wave Crash').cast().damage;
    for(const talent of ['Rock Head','Magic Guard']){const f=fixture('Wave Crash',{passiveAbility:talent});assert(f.cast().damage>0);assert.equal(f.a.currentHp,500);}
    for(const talent of ['Reckless','Tough Claws'])assert(fixture('Wave Crash',{passiveAbility:talent}).cast().damage>base);
    const f=fixture('Wave Crash');f.b.__battle.protect=true;assert.equal(f.cast().damage,0);assert.equal(f.a.currentHp,500);
}));
for(const terrain of ['electric_terrain','grassy_terrain','misty_terrain','psychic_terrain'])test(`Cryo-Pirouette clears ${terrain} only, preserving weather, rooms, hazards and screens`,()=>fixed(()=>{
    const f=fixture('Ice Spinner');f.state.terrain={kind:terrain,turns:5};f.state.weather={kind:'rain',turns:4};
    f.state.field.trickRoomTurns=3;f.state.sides.enemy.hazards.spikes=2;f.state.sides.enemy.screens.reflectTurns=4;
    const before=structuredClone(f.state),result=f.cast();assert(result.damage>0);assert(result.messages.some(s=>s.includes('dissipe')));
    before.terrain={kind:null,turns:0};assert.deepEqual(f.state.terrain,before.terrain);
    assert.deepEqual(f.state.weather,before.weather);assert.deepEqual(f.state.field,before.field);assert.deepEqual(f.state.sides,before.sides);
}));
test('Cryo-Pirouette cannot clear terrain on Protect, miss or ability immunity',()=>{
    for(const mode of['protect','miss','immune'])fixed(()=>{
        const f=fixture('Ice Spinner');f.state.terrain={kind:'grassy_terrain',turns:5};
        if(mode==='protect')f.b.__battle.protect=true;
        if(mode==='miss')f.a.__battle.statStages.accuracy=-6;
        if(mode==='immune')f.b.passiveAbility='Wonder Guard';
        assert.equal(f.cast().damage,0);assert.equal(f.state.terrain.kind,'grassy_terrain');
    },.99);
});
test('Cryo-Pirouette clears through a substitute, does not count as a secondary and works without terrain',()=>fixed(()=>{
    for(const mode of['substitute','force','dust','no-terrain']){
        const f=fixture('Ice Spinner');if(mode!=='no-terrain')f.state.terrain={kind:'electric_terrain',turns:5};
        if(mode==='substitute')f.b.__battle.substituteHp=100;
        if(mode==='force')f.a.passiveAbility='Sheer Force';if(mode==='dust')f.b.passiveAbility='Shield Dust';
        const r=f.cast();assert(r.damage+r.substituteDamage>0);assert.equal(f.state.terrain.kind,null);
    }
}));
test('Cryo-Pirouette clears after a Rocky Helmet contact KOs its user',()=>fixed(()=>{
    const f=fixture('Ice Spinner',{currentHp:1},{heldItem:'rocky_helmet'});
    f.state.terrain={kind:'electric_terrain',turns:5};
    assert(f.cast().damage>0);assert.equal(f.a.currentHp,0);assert.equal(f.state.terrain.kind,null);
}));
test('CS use recorded learners/Sketch only, preserve other slots and teach correct PP',()=>{
    for(const [key,yes,no]of[['cs_wave_crash',[7,8,9,230,235,395,418,419],[25,130,132]],['cs_ice_spinner',[7,149,235,461,478],[4,132,215]]]){
        for(const id of yes){assert(machines[key].species.includes(id),`${key} #${id}`);const p=mon(id,'Tackle');p.movePp=[2];const r=teachMachine(p,key,{slot:1,expectedMoves:p.abilities});assert.deepEqual(r.abilities,['Tackle',machines[key].move]);assert.deepEqual(r.movePp,[2,resources.getMaxMovePp(machines[key].move)]);}
        for(const id of no)assert.throws(()=>teachMachine(mon(id,'Tackle'),key,{}),/compatible/);
    }
    assert.equal(machines.cs_wave_crash.price,5000);assert.equal(machines.cs_ice_spinner.price,4000);
});
test('AI projections include terrain removal and recoil without accessing intentions or mutating input',()=>{
    for(const name of['Wave Crash','Ice Spinner']){
        const f=fixture(name);if(name==='Ice Spinner')f.state.terrain={kind:'grassy_terrain',turns:5};
        const before=JSON.stringify(f),ctx={field:f.state,ownSide:f.state.sides.player,enemySide:f.state.sides.enemy,chance:()=>1,
            damage:(p,q,m,side,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side})};
        const old=Math.random;Math.random=()=>{throw Error('AI consumed combat RNG');};let out;
        try{out=model.project(f.a,f.b,engine.getMoveByName(name),engine.getMoveByName('Splash'),ctx,{first:true});}finally{Math.random=old;}
        assert.equal(JSON.stringify(f),before);
        if(name==='Ice Spinner')assert.equal(out.field.terrain.kind,null);
        else assert(out.own.currentHp<500);
    }
});

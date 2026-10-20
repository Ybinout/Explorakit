const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const c=require('../server/game/drift/colosseum'),ai=require('../server/game/drift/colosseumAI');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const codec=require('../server/game/drift/checkpointCodec');
const legal=require('../data/game/pokemonData.json');
const signature=p=>({id:p.data.id,level:p.level,k:p.k,hp:p.maxHp,moves:p.abilities,item:p.heldItem,ability:p.passiveAbility});
const snapshots=(version)=>[1,5,6,10,11,15,16,20,25,30,31,40,61].map(w=>({info:c.waveInfo(w,version),team:c.opponent(w,version).equipe.pokemons.map(signature)}));
// Captured from the pre-patch v4 colosseum module, without UUIDs/timestamps.
const legacyHashes=['4f71a72d1c43c75f3e9a477c85a2c31cb481f3b8c510250178607b1c51a11983','6f504726c145b720def4cf04c92fb6f513737c3d529d7e0bc9bb9a33bd9da6e4','2387c35c7440b8b38a54960ff3d6a65e3823651c534b9fb5f952efb1cad5981a','3811d41f126beedd3a13651c23d8ea425df93846c40bc4ec3cc8eec9dcc60818'];
for(const version of [1,2,3,4])test(`legacy v${version} retains the exact opponents, preview, levels, items, abilities and points`,()=>{
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(snapshots(version))).digest('hex'),legacyHashes[version-1]);
});

test('v5 circuit varies teams and strategies, with legal modest openings and an honest deterministic preview',()=>{
    assert.equal(c.initialState().version,5);
    const styles=new Set(),species=new Set(),teams=new Set();
    for(let wave=1;wave<=70;wave++) {
        const info=c.waveInfo(wave),opponent=c.opponent(wave),team=opponent.equipe.pokemons;
        styles.add(info.strategy.key);team.forEach(p=>species.add(p.data.id));
        if(wave<=40&&!info.guardian){const ids=team.map(p=>p.data.id).join(',');assert(!teams.has(ids),'Repeated complete ordinary team');teams.add(ids);}
        assert.equal(new Set(team.map(p=>p.data.id)).size,team.length);
        assert.deepEqual(team.map(signature),c.opponent(wave).equipe.pokemons.map(signature));
        assert.deepEqual(team.map(p=>p.abilities),info.preview.map(p=>p.moves));
        assert.deepEqual(opponent.drifts,c.opponent(wave,4).drifts);
        assert.equal(info.level,c.waveInfo(wave,4).level);assert.equal(info.points,c.waveInfo(wave,4).points);
        const support=team.filter(p=>p.abilities.some(n=>engine.getMoveByName(n).combat.damage_class==='status'));
        assert(support.length<=1,'Do not generate teams of repeated status/recovery specialists');
        if(wave>=6)assert.equal(support.length,1,`No actual specialist for ${wave}/${info.strategy.key}`);
        for(const p of team) {
            assert(!factory.legendary.has(p.data.id));
            assert(p.abilities.filter(n=>engine.getMoveByName(n).power>0).length>=2);
            for(const name of p.abilities)assert(legal[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')));
            if(wave<=9&&!info.guardian) {
                const bst=Object.values(p.data.base).reduce((s,n)=>s+n,0);
                assert(bst<=(wave<=4?340:460));
                assert(p.abilities.every(n=>!(engine.getMoveByName(n).power>(wave<=5?60:80))));
            }
        }
        const restored=codec.decode(codec.encode({opponent,next:info}));
        assert.deepEqual(restored.opponent.equipe.pokemons.map(signature),team.map(signature));
        assert.deepEqual(restored.next,info);
    }
    assert(styles.size>=8);assert(species.size>=90);
    const random=Math.random;Math.random=()=>{throw Error('Battle RNG used by preview');};
    try{assert(c.waveInfo(121).strategy.hint);}finally{Math.random=random;}
});

function mon(id,moves) {
    const p=factory.create(id,40,true);p.abilities=moves;p.movePp=moves.map(()=>20);p.passiveAbility=null;
    engine.ensureBattleData(p);p.maxHp=500;p.currentHp=500;return p;
}
function decide(a,b,extra={}) {
    const field=extra.field || engine.createBattleState();
    return ai.chooseAction({team:[a],opponent:b,field,ownSide:field.sides.enemy,enemySide:field.sides.player,
        version:5,wave:16,round:1,memory:{seen:{[b.uuid]:{moves:['Tackle']}}},...extra});
}

test('weather specialist creates a beneficial climate once and prefers a finishing blow',()=>{
    const a=mon(61,['Water Pulse','Rain Dance']),b=mon(19,['Tackle']),field=engine.createBattleState();
    const before=JSON.stringify({a,b,field});assert.equal(decide(a,b,{field}).number,1);
    assert.equal(JSON.stringify({a,b,field}),before,'Planning mutated live state');
    field.weather={kind:'rain',turns:5};assert.equal(decide(a,b,{field}).number,0);
    field.weather={kind:null,turns:0};b.currentHp=1;assert.equal(decide(a,b,{field}).number,0);
    const sun=mon(78,['Flamethrower','Sunny Day']);b.currentHp=500;
    assert.equal(decide(sun,b).number,1);
});

test('Haze is used against actual setup, not against a neutral rival or for an impossible rescue',()=>{
    const a=mon(110,['Tackle','Haze']),b=mon(94,['Tackle']);
    assert.equal(decide(a,b).number,0);
    b.__battle.statStages.specialAttack=4;assert.equal(decide(a,b).number,1);
    a.currentHp=1;assert.equal(decide(a,b,{memory:{seen:{[b.uuid]:{moves:['Psychic']}}}}).number,0);
});

test('seed, screens and interruption are situational and do not endlessly reapply',()=>{
    const a=mon(45,['Tackle','Leech Seed']),b=mon(19,['Tackle']);
    assert.equal(decide(a,b).number,1);b.__battle.leechSeedSource=a;assert.equal(decide(a,b).number,0);
    const grass=mon(1,['Tackle']);assert.equal(decide(a,grass).number,0);
    const screen=mon(196,['Tackle','Reflect']),field=engine.createBattleState();
    assert.equal(decide(screen,b,{field}).number,1);
    field.sides.enemy.screens.reflectTurns=5;assert.equal(decide(screen,b,{field}).number,0);
    const taunt=mon(169,['Tackle','Taunt']);
    assert.equal(decide(taunt,b,{memory:{seen:{}}}).number,0);
    const memory={seen:{[b.uuid]:{moves:['Swords Dance']}}};assert.equal(decide(taunt,b,{memory}).number,1);
    b.__battle.tauntTurns=2;assert.equal(decide(taunt,b,{memory}).number,0);
});

test('Haze clears both combatants through a Substitute, while field moves remain usable',()=>{
    const a=mon(110,['Haze','Rain Dance']),b=mon(94,['Tackle']),field=engine.createBattleState();
    a.__battle.statStages.defense=3;b.__battle.statStages.specialAttack=4;b.__battle.substituteHp=40;
    engine.useattack('Haze',a,b,{battleState:field});
    assert(Object.values(a.__battle.statStages).every(n=>n===0));assert(Object.values(b.__battle.statStages).every(n=>n===0));
    assert.equal(b.__battle.substituteHp,40);
    engine.useattack('Rain Dance',a,b,{battleState:field});assert.equal(field.weather.kind,'rain');
    const surf=engine.getMoveByName('Surf');const rainDamage=engine.estimateDamage(a,b,surf,{battleState:field});
    field.weather.kind=null;assert(rainDamage>engine.estimateDamage(a,b,surf,{battleState:field}));
});

test('the real v5 opponent installs rain during a battle and resumes the same team and weather',()=>{
    const a={userId:1,equipe:{pokemons:[mon(19,['Tackle'])]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
    const b=c.opponent(11);for(const p of b.equipe.pokemons)p.currentHp=p.maxHp=500;
    const {DriftBattle}=require('../server/game/drift/driftBattle');
    const battle=new DriftBattle(a,b,{type:'arena',npcKey:'colosseum_11',emit(){},now:()=>0,random:()=>.5,paceMs:0});
    assert.equal(b.equipe.pokemons[0].abilities[battle.pending.get(b).number],'Rain Dance');
    battle.action(a,{action:'attack',number:0,turnId:battle.token});
    assert.equal(battle.state.weather.kind,'rain');assert(!battle.finished);
    const restored=codec.decode(codec.encode({battle})).battle;
    assert.deepEqual(restored.b.equipe.pokemons.map(signature),b.equipe.pokemons.map(signature));
    assert.deepEqual(restored.state.weather,battle.state.weather);
    restored.emit=()=>{}; // Runtime callbacks are reattached after deserialization.
    restored.resume(restored.a);assert.deepEqual(restored.state.weather,battle.state.weather);
});

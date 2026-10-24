const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const ai = require('../server/game/drift/colosseumAI');
const factory = require('../server/game/drift/pokemonFactory');
const colosseum = require('../server/game/drift/colosseum');
const engine = require('../server/game/battle/battleEngine');
const { getMaxMovePp } = require('../server/game/battle/battleResources');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const codec = require('../server/game/drift/checkpointCodec');

function pokemon(id, moves, level=50) {
    const p=factory.create(id,level,true);p.passiveAbility=null;
    if(moves){p.abilities=moves;p.movePp=moves.map(getMaxMovePp);}
    return p;
}
function decision(team,opponent,wave=51,extra={}) {
    const field=engine.createBattleState();
    return ai.chooseAction({team,opponent,wave,field,ownSide:field.sides.enemy,enemySide:field.sides.player,
        memory:{seen:{}},round:5,version:2,...extra});
}
test('new Colosseum starts tactically, advances every five wins and reaches Expert at challenge 16',()=>{
    for(const [wave,tier,label] of [[1,1,'Tacticien'],[5,1,'Tacticien'],[6,2,'Stratège'],[10,2,'Stratège'],[11,3,'Maître'],[15,3,'Maître'],[16,4,'Expert'],[80,4,'Expert']]) {
        const info=colosseum.waveInfo(wave);
        assert.equal(info.difficulty.tier,tier);assert.equal(info.difficulty.label,label);
        assert.equal(info.difficulty.totalTiers,4);
        assert.equal(info.difficulty.nextWave,tier<4?tier*5+1:null);
    }
    const a=pokemon(25,['Thunderbolt','Iron Tail']),b=pokemon(112);
    assert.equal(decision([a],b,1,{version:3}).number,1,'avoid Ground immunity from the first challenge');
    const attacker=pokemon(6,['Fire Blast','Flamethrower']),target=pokemon(3);target.currentHp=1;
    assert.equal(decision([attacker],target,1,{version:3}).number,1,'prefer the accurate finishing move immediately');
    const wall=pokemon(112,['Rock Slide']),reserve=pokemon(3,['Razor Leaf']),water=pokemon(9);
    const memory={seen:{[water.uuid]:{moves:['Surf'],immuneMoves:[]}}};
    assert.equal(decision([wall,reserve],water,5,{version:3,memory}).action,'attack');
    assert.deepEqual(decision([wall,reserve],water,6,{version:3,memory}),{action:'change',number:1});
    const healer=pokemon(9,['Tackle','Recover']);healer.currentHp=60;
    assert.equal(decision([healer],water,11,{version:3,memory:{seen:{[water.uuid]:{moves:['Tackle']}}}}).number,1);
});

test('announced items match deterministic legal sets and their Pokemon roles, from the opening onward',()=>{
    const legal=require('../data/game/pokemonData.json'),items=require('../server/game/items/heldItems');
    const evolvable=new Set(require('../data/game/stone_evolutions.json').evolvable),types=new Set();
    for(let wave=1;wave<=60;wave++) {
        const preview=colosseum.waveInfo(wave).preview,team=colosseum.opponent(wave).equipe.pokemons;
        assert.deepEqual(team.map(p=>p.heldItem),preview.map(p=>p.heldItem));
        assert.deepEqual(team.map(p=>[p.passiveAbility,p.gender,p.heldItem,p.abilities]),colosseum.opponent(wave).equipe.pokemons.map(p=>[p.passiveAbility,p.gender,p.heldItem,p.abilities]));
        for(const p of team) {
            const moves=p.abilities.map(engine.getMoveByName),damaging=moves.filter(m=>m.power>0);
            assert(items.enabled(p,engine.createBattleState()));types.add(p.heldItem);
            assert(damaging.length>=2);assert(p.abilities.length<=4);
            for(const name of p.abilities)assert(legal[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')),`${p.data.id}: ${name}`);
            if(p.heldItem==='eviolite')assert(evolvable.has(p.data.id));
            if(p.heldItem==='choice_band')assert(damaging.filter(m=>m.combat.damage_class==='physical').length>=3);
            if(p.heldItem==='choice_specs')assert(damaging.filter(m=>m.combat.damage_class==='special').length>=3);
            if(p.heldItem.startsWith('choice_')||p.heldItem==='assault_vest')assert.equal(damaging.length,moves.length,'no unusable support move');
            if(p.heldItem==='expert_belt')assert(new Set(damaging.map(m=>m.type)).size>=3);
        }
    }
    assert(types.size>=8,'roles should not all receive the same berry');
    const random=Math.random;Math.random=()=>{throw Error('Preview consumed battle RNG');};
    try { assert(colosseum.waveInfo(121).preview.every(p=>p.itemName&&p.itemReason)); } finally {Math.random=random;}
});

test('generated held items affect real damage and consume berries; item restrictions guide the AI',()=>{
    const field=engine.createBattleState(),opening=colosseum.opponent(1).equipe.pokemons[0],foe=pokemon(7);
    opening.currentHp=1;
    engine.processEndOfRound(opening,foe,field.sides.player,field.sides.enemy,field);
    assert.equal(opening.currentHp,11);assert.equal(opening.heldItem,null,'Oran berry was really consumed');
    const armored=colosseum.opponent(3).equipe.pokemons[0],attack=engine.getMoveByName('Tackle');
    const protectedDamage=engine.estimateDamage(foe,armored,attack,{battleState:field});
    armored.heldItem=null;assert(engine.estimateDamage(foe,armored,attack,{battleState:field})>protectedDamage);
    const choice=colosseum.opponent(10,4).equipe.pokemons.find(p=>p.heldItem==='choice_specs');
    const move=engine.getMoveByName(choice.abilities[0]),item=choice.heldItem;
    const boosted=engine.estimateDamage(choice,foe,move,{battleState:field});
    choice.heldItem=null;assert(boosted>engine.estimateDamage(choice,foe,move,{battleState:field}));choice.heldItem=item;
    choice.__battle={choiceMove:choice.abilities[1]};
    assert.deepEqual(ai.legalIndexes(choice,field),[1]);
    assert.equal(decision([choice],foe,16,{version:3,field}).number,1);
    field.field.magicRoomTurns=3;
    assert.equal(ai.legalIndexes(choice,field).length,choice.abilities.length,'Magic Room really suspends Choice restriction');
    choice.movePp.fill(0);assert.deepEqual(decision([choice],foe,16,{version:3,field}),{action:'attack',number:-1});
});

test('legacy intelligence increases exactly after every ten victories and stats continue after expert',()=>{
    for(const [wave,tier] of [[1,1],[10,1],[11,2],[20,2],[21,3],[30,3],[31,4],[40,4],[41,5],[50,5],[51,6],[100,6]]) {
        assert.equal(ai.difficulty(wave,2).tier,tier);assert.equal(colosseum.waveInfo(wave,2).difficulty.tier,tier);
    }
    assert.equal(ai.difficulty(51,2).nextWave,null);
    assert(colosseum.waveInfo(61).potential>colosseum.waveInfo(51).potential);
    assert.equal(colosseum.waveInfo(1).points,300);
});
test('type-aware tier avoids an immune attack and novice still delegates to the original random policy',()=>{
    const a=pokemon(25,['Thunderbolt','Iron Tail']),b=pokemon(112);
    assert.equal(decision([a],b,10),null);
    assert.deepEqual(decision([a],b,11),{action:'attack',number:1});
});
test('tactician chooses a reliable finishing move, priorities and the appropriate damage class',()=>{
    const a=pokemon(6,['Fire Blast','Flamethrower']),b=pokemon(3);b.currentHp=1;
    assert.equal(decision([a],b,21).number,1);
    const slow=pokemon(764,['Magical Leaf','Draining Kiss']),fast=pokemon(65);fast.currentHp=1;
    slow.passiveAbility='Triage';slow.currentSpeed=1;assert.equal(decision([slow],fast,21).number,1);
    const mixed=pokemon(149,['Dragon Claw','Dragon Pulse']),blissey=pokemon(242);
    assert.equal(decision([mixed],blissey,21).number,0);
});
test('strategist switches out of a bad matchup, but respects traps, hazards and switch cooldown',()=>{
    const a=pokemon(112,['Rock Slide']),reserve=pokemon(3,['Razor Leaf']),enemy=pokemon(9);
    const field=engine.createBattleState(),memory={seen:{[enemy.uuid]:{moves:['Surf'],immuneMoves:[]}}};
    assert.equal(decision([a,reserve],enemy,21,{memory}).action,'attack');
    assert.deepEqual(decision([a,reserve],enemy,31,{memory}),{action:'change',number:1});
    a.__battle={trappedTurns:2};assert.equal(decision([a,reserve],enemy,31,{memory}).action,'attack');delete a.__battle;
    assert.equal(decision([a,reserve],enemy,31,{memory:{...memory,lastSwitchRound:4}}).action,'attack');
    reserve.currentHp=1;field.sides.enemy.hazards.stealthRock=true;
    assert.equal(decision([a,reserve],enemy,31,{memory,field,ownSide:field.sides.enemy}).action,'attack');
});
test('master heals when safe and uses setup instead of wasting turns at the stat cap',()=>{
    const a=pokemon(9,['Tackle','Recover']),b=pokemon(9,['Tackle']);a.currentHp=60;
    const memory={seen:{[b.uuid]:{moves:['Tackle'],immuneMoves:[]}}};
    assert.equal(decision([a],b,41,{memory}).number,1);
    const c=pokemon(445,['Dragon Claw','Swords Dance']),d=pokemon(376,['Tackle']);
    const seen={seen:{[d.uuid]:{moves:['Tackle'],immuneMoves:[]}}};
    assert.equal(decision([c],d,41,{memory:seen}).number,1);
    c.__battle={statStages:{attack:6}};assert.equal(decision([c],d,41,{memory:seen}).number,0);
});
test('PP, Taunt, Disable and Encore restrict choices; Struggle remains available',()=>{
    const a=pokemon(9,['Surf','Tackle','Recover']),b=pokemon(6);a.currentHp=40;
    a.movePp=[0,10,10];assert.notEqual(decision([a],b,51).number,0);
    a.__battle={tauntTurns:2,disableTurns:2,disabledMove:'Tackle'};
    assert.deepEqual(decision([a],b,51),{action:'attack',number:-1});
    a.__battle={encoreTurns:2,encoreMove:'Tackle'};assert.equal(decision([a],b,51).number,1);
});
test('expert sees only public state and revealed moves, without mutating combat or consuming RNG',()=>{
    const a=pokemon(6,['Flamethrower','Air Slash']),b=pokemon(3),field=engine.createBattleState();
    a.__battle={chargeElectric:true,helpingHand:true,statStages:{attack:1}};
    const memory={seen:{}};const before=JSON.stringify({a,b,field,memory});
    const random=Math.random;Math.random=()=>{throw Error('AI consumed battle RNG');};
    let result;
    try { result=decision([a],b,51,{field,memory}); } finally { Math.random=random; }
    assert.equal(JSON.stringify({a,b,field,memory}),before);
    for(const field of ['abilities','movePp','iv','ev','heldItem','passiveAbility','attack','defense','speed','k'])
        Object.defineProperty(b,field,{get(){throw Error(`Hidden information read: ${field}`);},configurable:true});
    assert.deepEqual(decision([a],b,51,{field,memory}),result);
    ai.observe(memory,b,'Vine Whip');assert.deepEqual(memory.seen[b.uuid].moves,['Vine Whip']);
    ai.observe(memory,b,'Flamethrower',{effectiveness:0});
    assert.equal(decision([a],b,51,{field,memory}).number,1);
});
test('expert sets are legal, reproducible and carry useful moves and items',()=>{
    const legal=require('../data/game/pokemonData.json');
    const signature=p=>({id:p.data.id,moves:p.abilities,ability:p.passiveAbility,item:p.heldItem,hp:p.maxHp});
    for(const wave of [21,31,41,51,61]) {
        const team=colosseum.opponent(wave,2).equipe.pokemons;
        assert.deepEqual(team.map(signature),colosseum.opponent(wave,2).equipe.pokemons.map(signature));
        for(const p of team) {
            assert.equal(new Set(p.abilities).size,p.abilities.length);
            assert(p.abilities.length>=3 && p.abilities.length<=4);
            for(const name of p.abilities)assert(legal[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')),name);
            if(wave>=41)assert(p.abilities.some(name=>engine.getMoveByName(name).combat.damage_class==='status'));
            if(wave>=51)assert.equal(p.heldItem,'leftovers');
        }
    }
});
test('AI decisions and memory survive checkpoint restore; selected action is fixed before the player acts',()=>{
    const a={userId:1,equipe:{pokemons:[pokemon(9)]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
    const b=colosseum.opponent(31);
    const battle=new DriftBattle(a,b,{type:'arena',npcKey:'colosseum_31',emit(){},now:()=>1000,random:()=>.1,paceMs:0});
    ai.observe(battle.aiMemory,a.equipe.pokemons[0],'Surf');battle.aiMemory.lastSwitchRound=3;
    const selected={...battle.pending.get(b)};
    const restored=codec.decode(codec.encode({battle})).battle;
    assert.deepEqual(restored.aiMemory,battle.aiMemory);assert.deepEqual(restored.pending.get(restored.b),selected);
    battle.resume(a);assert.deepEqual(battle.pending.get(b),selected);
});
test('expert evaluation stays bounded for a full team',()=>{
    const team=colosseum.opponent(51).equipe.pokemons,enemy=pokemon(9);
    const start=performance.now();for(let i=0;i<100;i++)decision(team,enemy,51);
    assert(performance.now()-start<2000,'Expert evaluation blocks the game loop');
});

test('modern generated opponents finish real battles across guardians and every intelligence boundary',()=>{
    const original=Math.random;
    try {
        for(const wave of [1,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,25,30,31,51]) {
            let seed=wave*7919;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
            const b=colosseum.opponent(wave),level=colosseum.waveInfo(wave).level;
            const a={userId:1,equipe:{pokemons:[pokemon(9,null,level),pokemon(3,null,level),pokemon(6,null,level)]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
            const battle=new DriftBattle(a,b,{type:'arena',npcKey:`colosseum_${wave}`,emit(){},now:()=>0,random:Math.random,paceMs:0});
            const saved=codec.decode(codec.encode({battle})).battle;
            assert.equal(saved.b.colosseumVersion,5);
            assert.deepEqual(saved.pending.get(saved.b),battle.pending.get(b));
            for(let turn=0;turn<600&&!battle.finished;turn++){battle.action(a,{...battle.defaultAction(a),turnId:battle.token});battle.tick();}
            assert(battle.finished,`Modern battle stalled at wave ${wave}`);
            for(const p of battle.originals)assert(Number.isFinite(p.currentHp)&&p.currentHp<=p.maxHp);
        }
    } finally {Math.random=original;}
});

test('real battles finish at every intelligence boundary, and expert choices outperform random attacks on fixed matchups',()=>{
    const original=Math.random;
    const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const wins={novice:0,tactician:0,expert:0};let completed=0;
    try {
        for(const wave of [10,11,20,21,30,31,40,41,50,51,61]) {
            Math.random=seeded(wave);
            const a={userId:1,equipe:{pokemons:[pokemon(9),pokemon(3),pokemon(6)]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
            const b={npc:true,colosseumWave:wave,colosseumVersion:2,equipe:{pokemons:[pokemon(149),pokemon(248),pokemon(376)]},drifts:[],equipped:[]};
            b.equipe.pokemons.forEach((p,index)=>ai.preparePokemon(p,wave,index,2));
            const battle=new DriftBattle(a,b,{type:'arena',npcKey:`colosseum_${wave}`,emit(){},now:()=>0,random:Math.random,paceMs:0});
            for(let turn=0;turn<600&&!battle.finished;turn++) {battle.action(a,{...battle.defaultAction(a),turnId:battle.token});battle.tick();}
            assert(battle.finished,`Battle stalled at wave ${wave}`);completed++;
            for(const p of battle.originals)assert(Number.isFinite(p.currentHp)&&p.currentHp<=p.maxHp);
        }
        for(const enemy of [3,9,112,130,242])for(let seed=1;seed<=8;seed++)for(const [policy,wave,version] of [['novice',1,2],['tactician',1,3],['expert',16,3]]) {
            Math.random=seeded(seed*971+enemy);
            const a={userId:1,equipe:{pokemons:[pokemon(enemy,['Tackle','Body Slam'])]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
            const b={npc:true,colosseumWave:wave,colosseumVersion:version,equipe:{pokemons:[pokemon(25,['Thunderbolt','Iron Tail','Brick Break','Quick Attack'])]},drifts:[],equipped:[]};
            const battle=new DriftBattle(a,b,{type:'arena',npcKey:`colosseum_${wave}`,emit(){},now:()=>0,random:Math.random,paceMs:0,onFinish:(_b,winner)=>{if(winner===b)wins[policy]++;}});
            // This historical benchmark targets the legacy scorer, retained for set-generation compatibility.
            const legacyDefault=battle.defaultAction.bind(battle);battle.defaultAction=p=>p===b?(ai.chooseAction({team:b.equipe.pokemons,opponent:battle.active(0),field:battle.state,ownSide:battle.sides[1],enemySide:battle.sides[0],memory:battle.aiMemory,round:battle.round,wave,version})||{action:'attack',number:Math.floor(Math.random()*4)}):legacyDefault(p);
            battle.pending.set(b,battle.defaultAction(b));
            for(let turn=0;turn<200&&!battle.finished;turn++){battle.action(a,{...battle.defaultAction(a),turnId:battle.token});battle.tick();}
            assert(battle.finished);completed++;
        }
        assert(wins.tactician>wins.novice,JSON.stringify(wins));
        assert(wins.expert>=wins.tactician,JSON.stringify(wins));
        console.log(JSON.stringify({colosseumAIBattles:completed,wins,policyComparisonMatches:40}));
    } finally {Math.random=original;}
});

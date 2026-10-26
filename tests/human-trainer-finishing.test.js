const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id,names,label=String(id)){const p=factory.create(id,50,true);p.uuid=label;p.passiveAbility=null;p.heldItem=null;p.abilities=names;p.movePp=names.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
function fixture(){const a=mon(26,['Thunderbolt','Surf']),b=mon(51,['Earthquake']),reserve=mon(130,['Tackle']);a.currentHp=40;const field=engine.createBattleState();return {a,b,reserve,o:{team:[a],opponentTeam:[b,reserve],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{habits:{turns:10,switches:10,moves:{}}},round:1,skill:1}};}
const probability=o=>ai.analyse(o).predictions.filter(p=>p.action==='change').reduce((n,p)=>n+p.probability,0);
test('immediate KO opportunity outweighs switch habits: Raichu uses Surf rather than Thunderbolt into Dugtrio',()=>{
    const {a,b,o}=fixture();assert(engine.estimateDamage(ai.publicPokemon(b),a,engine.getMoveByName('Earthquake'),{battleState:o.field,defenderSide:o.ownSide})>=a.currentHp);
    assert(probability(o)>0 && probability(o)<.04);
    for(const skill of [.55,.7,.85,1])for(let round=1;round<=20;round++){
        a.uuid=`raichu-${round}`;assert.deepEqual(ai.chooseAction({...o,skill,round}),{action:'attack',number:1});
    }
});
test('switch prediction stays possible and is stronger when the visible player cannot finish the active trainer',()=>{
    const {b,o}=fixture(),threat=probability(o);b.abilities=['Tackle'];b.movePp=[35];const safe=probability(o);assert(safe>threat*8);assert(safe>.1&&safe<.6);
});
test('priority and Trick Room matter: a faster guaranteed counter-KO removes the incentive to stay, but not against priority',()=>{
    const {a,b,o}=fixture();a.currentSpeed=300;b.currentHp=1;
    const fastCounter=probability(o);assert(fastCounter>.1);
    o.field.field.trickRoomTurns=5;assert(probability(o)<.04);o.field.field.trickRoomTurns=0;
    a.currentHp=1;b.abilities=['Quick Attack','Earthquake'];b.movePp=[30,10];assert(probability(o)<.04);
});
test('a damaging move still in preparation is not an immediate finishing opportunity',()=>{
    const {a,b,o}=fixture();b.abilities=['Dig'];b.movePp=[10];assert(engine.movePhase(ai.publicPokemon(b),'Dig',o.field,a)==='prepare');assert(probability(o)>.1);
});
test('uncertain status and accuracy do not turn a possible KO into certainty',()=>{
    const {b,o}=fixture(),awake=probability(o);b.status='sleep';const asleep=probability(o);assert(asleep>awake*5);assert(asleep<.58);
    b.status='normal';b.abilities=['Fissure'];b.movePp=[5];assert(probability(o)>awake);
});
test('fixed damage can finish too, and known own type conversion is respected when judging immunities',()=>{
    const {a,b,o}=fixture();b.abilities=['Seismic Toss'];b.movePp=[20];assert(probability(o)<.04);assert.equal(ai.chooseAction(o).number,1);
    a.abilities=['Hyper Voice','Surf'];a.movePp=[10,15];b.abilities=['Earthquake'];b.movePp=[10];o.field.field.ionDelugeTurns=1;assert.equal(ai.chooseAction(o).number,1);o.field.field.ionDelugeTurns=0;
    const fly=mon(127,['Quick Attack','Seismic Toss']),ghost=mon(94,['Sludge Bomb']);fly.passiveAbility='Refrigerate';fly.currentHp=10;
    assert.equal(ai.chooseAction({...o,team:[fly],opponentTeam:[ghost]}).number,0,'Refrigerate makes Quick Attack able to hit Ghost, and its priority is useful');
});
test('a previously revealed immunity is also avoided under lethal pressure, without consulting the hidden ability',()=>{
    const {b,o}=fixture();b.type1='Water';b.type2=null;o.memory.seen={[b.uuid]:{immuneMoves:['Thunderbolt']}};
    b.abilities=['Earthquake'];b.movePp=[10];Object.defineProperty(b,'passiveAbility',{get(){throw Error('Hidden ability read');}});
    assert.equal(ai.chooseAction(o).number,1);
});
test('a viable defensive switch remains available; no effective alternative still yields a legal move',()=>{
    const {a,b,o}=fixture();const flying=mon(130,['Waterfall']);assert.deepEqual(ai.chooseAction({...o,team:[a,flying]}),{action:'change',number:1});
    a.abilities=['Thunderbolt'];a.movePp=[15];assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
});
test('lethal-pressure decisions remain deterministic, read-only and blind to pending commands and private stats',()=>{
    const {b,reserve,o}=fixture(),before=JSON.stringify(o),expected=ai.analyse(o),original=Math.random;
    Math.random=()=>{throw Error('Combat RNG consumed');};try{assert.deepEqual(ai.analyse(o),expected);}finally{Math.random=original;}
    assert.equal(JSON.stringify(o),before);
    for(const p of[b,reserve])for(const key of['heldItem','passiveAbility','iv','ev','k','currentAttack','currentDefense','currentSpeed','currentSpecialAttack','currentSpecialDefense'])Object.defineProperty(p,key,{get(){throw Error('Private property read: '+key);}});
    Object.defineProperty(o.field,'turnActions',{get(){throw Error('Submitted action read');}});assert.deepEqual(ai.analyse(o),expected);
});
test('type-changing previews do not contaminate the other candidate moves',()=>{
    const {a,o}=fixture();a.passiveAbility='Protean';const original=JSON.stringify(o),first=ai.analyse(o);
    assert.equal(JSON.stringify(o),original);const scores=new Map(first.candidates.map(c=>[a.abilities[c.number],c.score]));
    a.abilities.reverse();a.movePp.reverse();const second=ai.analyse(o);
    for(const c of second.candidates)assert(Math.abs(c.score-scores.get(a.abilities[c.number]))<1e-9);
});
for(const mode of ['rift','colosseum'])test(`${mode}: effective move committed before the human command survives a checkpoint and is never rerolled`,()=>{
    const {a,b,reserve}=fixture(),p={userId:1,currentmap:'route2',run:{mode},equipe:{pokemons:[b,reserve]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0},npc={npc:true,equipe:{pokemons:[a]},drifts:[],equipped:[]};
    const battle=new DriftBattle(p,npc,{type:'trainer',emit(){},paceMs:0});const chosen={...battle.pending.get(npc)};assert.deepEqual(chosen,{action:'attack',number:1});assert.equal(battle.pending.has(p),false);
    assert.equal(battle.action(p,{action:'change',number:99,turnId:battle.token}),false);assert.deepEqual(battle.pending.get(npc),chosen);
    const saved=codec.decode(codec.encode(battle));saved.emit=()=>{};saved.resume(saved.a);assert.deepEqual(saved.pending.get(saved.b),chosen);battle.finished=saved.finished=true;
});

const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
function mon(id,names,extra={}) {
    const p=factory.create(id,50,true);
    return Object.assign(p,{uuid:`item-planner-${id}`,maxHp:400,currentHp:400,attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,
        currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,
        passiveAbility:null,heldItem:null,abilities:names,movePp:names.map(resources.getMaxMovePp),__battle:{statStages:{},sleepTurns:1}},extra);
}
function options(team,foes,extra={}) { const field=engine.createBattleState();return {team,opponentTeam:foes,field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1,...extra}; }
test('Life Orb: always prefer a draining KO over an equally effective suicidal KO',()=>{
    const a=mon(68,['Close Combat','Drain Punch'],{currentHp:30,heldItem:'life_orb'}),b=mon(143,['Splash'],{currentHp:30}),o=options([a],[b]);
    for(let round=1;round<=12;round++) assert.deepEqual(ai.chooseAction({...o,round}),{action:'attack',number:1});
});
test('Chesto Rest: recognize the immediate full heal instead of spending two turns asleep',()=>{
    const a=mon(143,['Rest','Recover'],{currentHp:80,currentSpeed:999,heldItem:'chesto_berry'}),b=mon(143,['Tackle']);
    assert.equal(ai.chooseAction(options([a],[b])).number,0);
    a.heldItem=null;assert.equal(ai.chooseAction(options([a],[b])).number,1,'ordinary Recover stays awake without a sleep-curing berry');
});
test('Focus Sash: recognize a slower Counter KO after surviving a physical attack',()=>{
    const a=mon(65,['Counter','Psychic'],{maxHp:300,currentHp:300,currentDefense:1,currentSpecialAttack:1,currentSpeed:1,heldItem:'focus_sash'}),b=mon(68,['Close Combat']);
    for(let round=1;round<=8;round++)assert.equal(ai.chooseAction({...options([a],[b]),round}).number,0);
});
test('the real consecutive-protection counter discourages a risky repeated Protect',()=>{
    const a=mon(143,['Protect','Recover'],{currentHp:100,currentDefense:40,currentSpeed:999,heldItem:'leftovers',__battle:{statStages:{},protectionStreak:1,protectionTurn:1}}),b=mon(143,['Tackle'],{status:'poison'}),o=options([a],[b]);
    o.field.turn=2;assert.equal(ai.chooseAction(o).number,1);
});
test('known immunity, Substitute and maxed boosts do not turn a failed support move into a good decision',()=>{
    const a=mon(3,['Toxic','Sludge Bomb']),b=mon(9,['Tackle']);b.__battle.substituteHp=100;
    assert.equal(ai.chooseAction(options([a],[b])).number,1);
    const setup=mon(212,['Swords Dance','Bullet Punch']);setup.__battle.statStages.attack=6;
    assert.equal(ai.chooseAction(options([setup],[mon(143,['Splash'])])).number,1);
});
test('variable-power moves are valued with their actual power instead of zero damage',()=>{
    const a=mon(68,['Low Kick','Pound']),b=mon(143,['Splash']);
    assert.equal(ai.chooseAction(options([a],[b])).number,0);
    const gyro=mon(205,['Gyro Ball','Tackle'],{currentSpeed:10}),fast=mon(101,['Tackle']);
    assert.equal(ai.chooseAction(options([gyro],[fast])).number,0);
});
test('choice-locked options remain legal while item suppression frees the other moves',()=>{
    const a=mon(9,['Surf','Ice Beam'],{heldItem:'choice_specs'}),b=mon(3,['Splash']);a.__battle.choiceMove='Surf';
    assert.equal(ai.chooseAction(options([a],[b])).number,0);
    const o=options([a],[b]);o.field.field.magicRoomTurns=3;assert.equal(ai.chooseAction(o).number,1);
});
test('a hidden opposing record cannot leak through an own or public volatile reference',()=>{
    const a=mon(9,['Surf','Ice Beam']),b=mon(3,['Tackle']),o=options([a],[b]);
    const secret={};Object.defineProperty(secret,'submittedAction',{enumerable:true,get(){throw Error('Private action reached through a reference');}});
    a.__battle.leechSeedSource=secret;b.__battle.leechSeedSource=secret;
    Object.defineProperty(o.field.field,'pendingAction',{enumerable:true,get(){throw Error('Private field action read');}});
    Object.defineProperty(a.__battle,'targetRecord',{enumerable:true,get(){throw Error('Unknown volatile inspected');}});
    const original=Math.random;Math.random=()=>{throw Error('Live combat RNG consumed');};
    try { assert(ai.chooseAction(o)); } finally { Math.random=original; }
});
test('forced replacement picks a safe useful matchup rather than the next slot, while retaining the reserved ace',()=>{
    const tactics=require('../server/game/battle/trainerTactics');
    const rock=mon(112,['Rock Slide']),grass=mon(3,['Razor Leaf']),ace=mon(25,['Thunderbolt']),foe=mon(9,['Surf']);
    const team={pokemons:[rock,grass,ace],__trainerPlan:{aceUuid:ace.uuid}},o=options(team.pokemons,[foe]);
    assert.equal(tactics.replacementIndex(team),0,'authored initial lead is preserved');
    assert.equal(tactics.replacementIndex(team,o),1,'Razor Leaf resists Surf and threatens the live foe');
    rock.currentHp=grass.currentHp=0;assert.equal(tactics.replacementIndex(team,o),2,'the ace enters after ordinary reserves are gone');
});
test('known own immunities, attack preparation and multiple hits are included in the estimates',()=>{
    const levitate=mon(94,['Shadow Ball']),grass=mon(3,['Razor Leaf']),foe=mon(112,['Earthquake']);levitate.passiveAbility='Levitate';
    assert.equal(ai.chooseAction(options([levitate,grass],[foe])).action,'attack','the NPC knows its own Ground immunity');
    const flyer=mon(6,['Fly','Wing Attack'],{currentSpeed:999}),target=mon(3,['Splash'],{currentHp:1});
    assert.equal(ai.chooseAction(options([flyer],[target])).number,1,'a charge turn is not an immediate KO');
    const multi=mon(424,['Double Hit','Tackle']);
    assert.equal(ai.chooseAction(options([multi],[mon(143,['Splash'])])).number,0,'two hits are worth more than one 35-power hit');
});
test('a poisoned own snapshot never traverses unknown stage properties',()=>{
    const a=mon(9,['Surf']),b=mon(3,['Tackle']),o=options([a],[b]);
    for(const p of[a,b])Object.defineProperty(p.__battle.statStages,'pendingAction',{enumerable:true,get(){throw Error('Unknown stage read');}});
    assert(ai.chooseAction(o));
});

test('an unusable Fake Out never beats a useful priority attack under lethal pressure',()=>{
    const a=mon(392,['Fake Out','Mach Punch'],{currentHp:1}),b=mon(143,['Body Slam']);a.__battle.activeMoveActions=1;
    for(let round=1;round<=8;round++)assert.equal(ai.chooseAction({...options([a],[b]),round}).number,1);
});

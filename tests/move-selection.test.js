const test=require('node:test'),assert=require('node:assert/strict');
const selection=require('../server/game/battle/moveSelection'),engine=require('../server/game/battle/battleEngine');
const ai=require('../server/game/battle/humanTrainerAI'),resources=require('../server/game/battle/battleResources'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id=53,moves=['Fake Out','Scratch']){const p=factory.create(id,30,true);p.passiveAbility=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
function options(a,b,team=[a]){const field=engine.createBattleState();return {team,opponentTeam:[b],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:2};}
for(const name of['Fake Out','First Impression','Mat Block'])test(`${name}: no repeat, old history supported and real switch-in resets eligibility`,()=>{
 const p=mon(53,[name,'Scratch']),foe=mon(143,['Splash']),field=engine.createBattleState();
 assert.deepEqual(selection.preferMoves(p,field),[0,1]);
 p.__battle.lastActionTurn=1;assert.deepEqual(selection.preferMoves(p,field),[1]);
 p.__battle.activeMoveActions=0;assert.deepEqual(selection.preferMoves(p,field),[0,1],'an explicit fresh entry wins over old action history');
 p.__battle.activeMoveActions=1;assert.deepEqual(selection.preferMoves(p,field),[1]);
 engine.applySwitchInEffects(foe,field.sides.player,field.sides.enemy,field,p);assert.deepEqual(selection.preferMoves(p,field),[1],'an opposing replacement is not our own entry');
 engine.applySwitchInEffects(p,field.sides.enemy,field.sides.player,field,foe);assert.deepEqual(selection.preferMoves(p,field),[0,1]);
});
test('trainer repeats of obsolete Bluff history are excluded for every later decision, without mutation or live RNG',()=>{
 const a=mon(),b=mon(143,['Splash']),o=options(a,b);a.__battle.lastActionTurn=1;
 const before=JSON.stringify(o),random=Math.random;Math.random=()=>{throw Error('Live RNG read');};
 try{for(let round=2;round<=30;round++){const result=ai.analyse({...o,round});assert(!result.candidates.some(c=>c.action==='attack'&&c.number===0));assert.deepEqual(ai.chooseAction({...o,round}),{action:'attack',number:1});}}
 finally{Math.random=random;}
 assert.equal(JSON.stringify(o),before);
});
test('own conditions: no awake Snore/Sleep Talk, empty stockpile/item/berry, wrong Burn Up type or trainer Teleport if alternatives exist',()=>{
 for(const name of['Snore','Sleep Talk','Spit Up','Swallow','Fling','Natural Gift','Burn Up','Teleport']){
  const p=mon(9,[name,'Tackle']),field=engine.createBattleState();assert.deepEqual(selection.preferMoves(p,field),[1],name);
 }
 const p=mon(9,['Snore','Tackle']),field=engine.createBattleState();p.status='sleep';assert.deepEqual(selection.preferMoves(p,field),[0,1]);p.status='normal';p.passiveAbility='Comatose';assert.deepEqual(selection.preferMoves(p,field),[0,1]);
 p.abilities=['Natural Gift','Tackle'];p.movePp=[15,35];p.heldItem='oran_berry';assert.deepEqual(selection.preferMoves(p,field),[0,1]);
 p.abilities=['Spit Up','Tackle'];p.__battle.stockpileCount=1;assert.deepEqual(selection.preferMoves(p,field),[0,1]);
 p.abilities=['Burn Up','Tackle'];p.passiveAbility='Protean';assert.deepEqual(selection.preferMoves(p,field),[0,1]);p.__battle.abilitySuppressed=true;assert.deepEqual(selection.preferMoves(p,field),[1]);
 p.abilities=['Teleport','Tackle'];field.battleType='wild';assert.deepEqual(selection.preferMoves(p,field),[0,1]);
});
test('public forecasts never assume an unknown opposing held item/ability is absent',()=>{
 const p=mon(9,['Natural Gift','Snore']);delete p.heldItem;delete p.passiveAbility;const field=engine.createBattleState();
 for(const name of p.abilities)assert.equal(selection.failureReason(p,engine.getMoveByName(name),field,{privateKnown:false}),null);
 const a=mon(),b=mon(143,['Fling','Snore']),o=options(a,b);for(const key of['heldItem','passiveAbility','movePp'])Object.defineProperty(b,key,{get(){throw Error('Private opponent read '+key);}});
 Object.defineProperty(o.field,'turnActions',{get(){throw Error('Pending action read');}});assert(ai.chooseAction(o));
});
test('taunt, disabled, encore and throat-chop restrictions improve the automated fallback',()=>{
 for(const [moves,state]of[[['Growl','Tackle'],{tauntTurns:2}],[['Fake Out','Tackle'],{disabledMove:'Fake Out',disableTurns:2}],[['Fake Out','Tackle'],{encoreMove:'Tackle',encoreTurns:2}],[['Hyper Voice','Tackle'],{soundBlockedTurns:2}]]){
  const p=mon(53,moves);Object.assign(p.__battle,state);assert.deepEqual(selection.preferMoves(p,engine.createBattleState()),[1]);
 }
});
test('Choice-locked expired Bluff switches if possible; trapped/sole-move cases retain PP rules and never get free Struggle',()=>{
 const a=mon(),b=mon(143,['Splash']),reserve=mon(9,['Surf']);a.__battle.activeMoveActions=1;a.heldItem='choice_band';a.__battle.choiceMove='Fake Out';
 const o=options(a,b,[a,reserve]);assert.deepEqual(selection.preferMoves(a,o.field),[0]);assert.deepEqual(ai.chooseAction(o),{action:'change',number:1});
 a.__battle.trappedTurns=2;assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 a.__battle.trappedTurns=0;o.team=[a];a.abilities=['Fake Out'];a.movePp=[5];assert.deepEqual(selection.preferMoves(a,o.field),[0]);assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 a.movePp=[0];assert.deepEqual(ai.chooseAction(o),{action:'attack',number:-1});
});
test('forced charge/recharge/Bide stays forced; checkpoint preserves the remaining PP and history',()=>{
 const p=mon(53,['Hyper Beam','Tackle']);p.__battle.rechargeMove='Hyper Beam';assert.deepEqual(selection.preferMoves(p,engine.createBattleState()),[0]);
 p.__battle={activeMoveActions:1,lastActionTurn:3,statStages:{}};p.abilities=['Fake Out','Scratch'];p.movePp=[7,12];const restored=codec.decode(codec.encode(p));assert.deepEqual(selection.preferMoves(restored,engine.createBattleState()),[1]);assert.deepEqual(restored.movePp,[7,12]);
});
for(const mode of['rift','colosseum'])for(const type of['wild','trainer'])test(`${mode} ${type}: after a real first turn, subsequent NPC plans cannot repeat Bluff`,()=>{
 const ally=mon(143,['Splash']);ally.currentHp=ally.maxHp=10000;
 const a={userId:1,socketId:'owner',alive:true,currentmap:'route1',run:{mode,phase:'exploration'},items:{},money:0,equipe:{pokemons:[ally]},drifts:[],equipped:[],defeated:new Set()},foe=mon(),b={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};
 const battle=new DriftBattle(a,b,{type,emit(){},random:()=>0,paceMs:0});
 for(let n=0;n<5;n++){
  if(n>0){delete foe.__battle.activeMoveActions;assert(foe.__battle.lastActionTurn>0);if(type==='trainer'){battle.pending.delete(b);battle.pending.set(b,battle.defaultAction(b));}assert.equal(battle.pending.get(b).number,1);}
  battle.action(a,{action:'attack',number:0,turnId:battle.token});assert(!battle.finished);battle.tick();
 }
 battle.finish(null,'closed');
});

const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const model=require('../server/game/battle/humanTrainerModel'),turns=require('../server/game/battle/turnActions');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id,names){const p=factory.create(id,50,true);Object.assign(p,{uuid:`sucker-${id}`,passiveAbility:null,heldItem:null,abilities:names,movePp:names.map(resources.getMaxMovePp),__battle:{statStages:{},sleepTurns:1}});return p;}
function fixture(status='Recover') {
 const a=mon(51,['Sucker Punch','Knock Off','Swords Dance']),b=mon(94,[status,'Shadow Ball']);b.maxHp=b.currentHp=150;
 const field=engine.createBattleState();return {a,b,o:{team:[a],opponentTeam:[b],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:3}};
}
const statusProbability=o=>ai.analyse(o).predictions.filter(p=>engine.getMoveByName(p.move)?.combat.damage_class==='status').reduce((n,p)=>n+p.probability,0);
for(const status of ['Recover','Calm Mind'])test(`Sucker Punch: observes completed ${status} and takes the reliable hit instead of repeating`,()=>{
 const {a,b,o}=fixture(status);assert.equal(ai.chooseAction(o).number,0,'priority is initially a reasonable prediction');
 const before=statusProbability(o);ai.observeMove(o.memory,b.uuid,status);
 for(let round=4;round<=12;round++)assert.deepEqual(ai.chooseAction({...o,round}),{action:'attack',number:1});
 assert(statusProbability(o)>before+.15);
 assert.equal(a.movePp[0],resources.getMaxMovePp('Sucker Punch'),'evaluation spends no PP');
});
test('Sucker Punch has no imaginary next-turn damage or finishing bonus against status-only moves',()=>{
 const {a,b,o}=fixture();b.abilities=['Recover','Calm Mind'];b.movePp=[10,20];
 assert.notEqual(ai.chooseAction(o).number,0);
 a.abilities=['Sucker Punch'];a.movePp=[5];
 assert(ai.analyse(o).candidates.find(c=>c.number===0).score<=0);
});
test('Sucker Punch remains a valuable priority KO after a failure when an attack is now forced',()=>{
 const {a,b,o}=fixture();a.currentHp=1;a.currentSpeed=1;b.currentHp=1;
 Object.assign(a.__battle,{lastMoveUsed:'Sucker Punch',lastMoveFailed:true,lastMoveResultTurn:2});
 for(let i=0;i<4;i++)ai.observeMove(o.memory,b.uuid,'Recover');
 b.__battle.tauntTurns=3;
 for(let round=3;round<15;round++)assert.deepEqual(ai.chooseAction({...o,round}),{action:'attack',number:0});
 assert.equal(statusProbability(o),0,'illegal status moves and their old observations are excluded');
});
test('faster opposing priority and switches do not grant Sucker Punch guaranteed future damage',()=>{
 const {a,b,o}=fixture();a.currentSpeed=1;a.maxHp=a.currentHp=500;b.abilities=['Quick Attack'];b.movePp=[30];
 assert.notEqual(ai.chooseAction(o).number,0);
 a.abilities=['Sucker Punch'];a.movePp=[5];
 assert(ai.analyse(o).candidates.find(c=>c.number===0).score<=0);
 const reserve=mon(143,['Recover']);o.opponentTeam.push(reserve);b.abilities=['Recover'];b.movePp=[10];
 o.memory.habits={turns:10,switches:10,moves:{}};
 const switched=ai.analyse(o);assert(switched.predictions.some(p=>p.action==='change'));assert(switched.candidates.find(c=>c.number===0).score<=0);
});
test('Choice lock and a single Sucker Punch keep a legal move, never a free Struggle',()=>{
 const {a,b,o}=fixture();b.abilities=['Recover'];b.movePp=[10];
 a.heldItem='choice_band';a.__battle.choiceMove='Sucker Punch';assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 a.heldItem=null;delete a.__battle.choiceMove;a.abilities=['Sucker Punch'];a.movePp=[5];assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 a.movePp=[0];assert.deepEqual(ai.chooseAction(o),{action:'attack',number:-1});
});
test('recent observations are bounded, uncertain, expire, and accept old memory',()=>{
 const {b,o}=fixture();const baseline=statusProbability(o);
 for(let i=0;i<20;i++)ai.observeMove(o.memory,b.uuid,'Recover');
 assert.equal(o.memory.habits.recentMoves[b.uuid].length,4);assert(statusProbability(o)>baseline+.4);assert(statusProbability(o)<.6);
 for(let i=0;i<4;i++)ai.observeMove(o.memory,b.uuid,'Shadow Ball');assert(statusProbability(o)<.1);
 o.memory={habits:{turns:4,switches:0,moves:{[b.uuid]:{Recover:4}}}};assert(ai.chooseAction(o));
});
test('Sucker Punch adaptation is deterministic, read-only, and blind to current commands and private data',()=>{
 const {b,o}=fixture();ai.observeMove(o.memory,b.uuid,'Recover');const before=JSON.stringify(o),expected=ai.analyse(o);
 for(const key of ['heldItem','movePp','iv','ev','k','attack','defense','speed','currentAttack','currentDefense','currentSpeed'])
  Object.defineProperty(b,key,{get(){throw Error('Read private '+key);}});
 Object.defineProperty(o.field,'turnActions',{get(){throw Error('Read submitted move');}});
 const random=Math.random;Math.random=()=>{throw Error('Used live RNG');};
 try{assert.deepEqual(ai.analyse(o),expected);}finally{Math.random=random;}
 assert.equal(JSON.stringify({...o,opponentTeam:[],field:undefined}),JSON.stringify({...JSON.parse(before),opponentTeam:[],field:undefined}));
});
for(const action of ['Tackle','Recover','Quick Attack','Me First','recharge',null])test(`Sucker Punch projection agrees with real engine for ${action||'switch'}`,()=>{
 const reply=action==='recharge'?'Hyper Beam':action;
 const a=mon(51,['Sucker Punch']),b=mon(143,[reply||'Tackle']),field=engine.createBattleState();a.currentSpeed=a.speed=1;b.currentSpeed=b.speed=300;
 if(action==='recharge')b.__battle.rechargeMove='Hyper Beam';
 a.maxHp=a.currentHp=b.maxHp=b.currentHp=500;const first=reply!=='Quick Attack';
 const ctx={field,ownSide:field.sides.enemy,enemySide:field.sides.player,chance:()=>1,
  damage:(p,q,m,side,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side})};
 const projected=model.project(a,b,engine.getMoveByName('Sucker Punch'),reply&&engine.getMoveByName(reply),ctx,{first,switched:!reply});
 const actual=structuredClone(field),own=structuredClone(a),foe=structuredClone(b),random=Math.random;Math.random=()=>.5;
 try {
  turns.planTurnActions(actual,[{pokemon:own,action:'attack',moveName:'Sucker Punch'},{pokemon:foe,action:reply?'attack':'change',moveName:reply}]);
  if(!first)turns.spendTurnAction(actual,foe);
  engine.useattack('Sucker Punch',own,foe,{battleState:actual,attackerSide:actual.sides.enemy,defenderSide:actual.sides.player});
 }finally{Math.random=random;}
 assert(Math.abs(projected.foe.currentHp-foe.currentHp)<=1);
 assert.equal(projected.foe.currentHp<500,['Tackle','Me First'].includes(reply));
});
for(const mode of ['rift','colosseum'])test(`${mode}: completed failed Sucker Punch leads to another move; checkpoint preserves history and committed choice`,()=>{
 const {a,b}=fixture(),player={userId:1,currentmap:'route2',run:{mode},equipe:{pokemons:[b]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0},npc={npc:true,equipe:{pokemons:[a]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(player,npc,{type:'trainer',emit:(p,name,payload)=>events.push({name,payload}),paceMs:0,random:()=>.5});
 assert.deepEqual(battle.pending.get(npc),{action:'attack',number:0});
 assert(battle.action(player,{action:'attack',number:0,turnId:battle.token}));battle.tick();
 assert.equal(b.currentHp,150,'Sucker Punch really failed against recovery');assert.equal(a.movePp[0],4);
 assert.deepEqual(battle.aiMemory.habits.recentMoves[b.uuid],['Recover']);
 const committed={...battle.pending.get(npc)};assert.deepEqual(committed,{action:'attack',number:1});
 const saved=codec.decode(codec.encode(battle));saved.emit=()=>{};saved.resume(saved.a);
 assert.deepEqual(saved.aiMemory.habits.recentMoves,battle.aiMemory.habits.recentMoves);assert.deepEqual(saved.pending.get(saved.b),committed);
 assert.equal(saved.action(saved.a,{action:'change',number:99,turnId:saved.token}),false);assert.deepEqual(saved.pending.get(saved.b),committed);
 battle.finished=saved.finished=true;
});

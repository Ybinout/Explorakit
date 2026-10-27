const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const factory=require('../server/game/drift/pokemonFactory'),{DriftBattle}=require('../server/game/drift/driftBattle');
const {clearSwitchOutState}=require('../server/game/battle/battleTeam');
const {clearBattleTransientState}=require('../server/game/battle/battleOutcome');
function mon(item=null){const p=factory.create(143,50,true);p.passiveAbility=null;p.heldItem=item;p.abilities=['Tackle','Crunch'];p.movePp=[35,15];p.maxHp=p.currentHp=10000;return p;}
function fixed(work){const old=Math.random;Math.random=()=>.5;try{return work();}finally{Math.random=old;}}
for(const item of ['choice_band','choice_specs','choice_scarf']){
 test(`${item}: real attack locks the choice, opposing replacement does not unlock it, switch-out does`,()=>{
  const p=mon(item),q=mon(),field=engine.createBattleState();fixed(()=>engine.useattack('Tackle',p,q,{battleState:field}));
  assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0]);const before=[...p.movePp];
  const denied=fixed(()=>engine.useattack('Crunch',p,mon(),{battleState:field}));assert(denied.blocked);assert.equal(denied.damage,0);assert.deepEqual(p.movePp,before);
  clearSwitchOutState(p);assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0,1]);fixed(()=>engine.useattack('Crunch',p,q,{battleState:field}));assert.deepEqual(resources.getUsableMoveIndexes(p,field),[1]);
  clearBattleTransientState([p]);assert.equal(p.heldItem,item);assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0,1]);
 });
 test(`${item}: exhausted locked move gives Struggle even when other slots still have PP`,()=>{
  const p=mon(item),q=mon(),field=engine.createBattleState();fixed(()=>engine.useattack('Crunch',p,q,{battleState:field}));p.movePp[1]=0;
  assert.deepEqual(resources.getUsableMoveIndexes(p,field),[]);const before=[...p.movePp];
  const preview=require('../server/game/battle/battleEvents').prepareMoveAnimation(p,q,'Tackle',field);assert.equal(preview.moveName,'Struggle');
  const result=fixed(()=>engine.useattack('Tackle',p,q,{battleState:field}));assert.equal(result.moveName,'Struggle');assert(result.damage>0);assert.deepEqual(p.movePp,before);
 });
 for(const mode of ['rift','colosseum'])test(`${mode} ${item}: synchronized buttons and rejected selection do not advance the round`,()=>{
  const a={userId:1,socketId:'owner',alive:true,currentmap:'route1',run:{mode,phase:'exploration'},equipe:{pokemons:[mon(item)]},items:{},money:1000,drifts:[],equipped:[],defeated:new Set()};
  const foe=mon();foe.abilities=['Splash'];foe.movePp=[40];const b={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]},events=[];
  const battle=new DriftBattle(a,b,{emit:(p,event,data)=>events.push({event,data}),paceMs:0,random:()=>.5});
  fixed(()=>battle.action(a,{action:'attack',number:0,turnId:battle.token}));battle.tick();
  assert.deepEqual(events.filter(e=>e.event==='introAnimation').at(-1).data.usableMoveIndexes,[0]);
  const round=battle.round,pp=[...a.equipe.pokemons[0].movePp],pending=battle.pending.get(b),beforeEvents=events.length;
  assert.equal(battle.action(a,{action:'attack',number:1,turnId:battle.token}),false);assert.equal(battle.round,round);assert.deepEqual(a.equipe.pokemons[0].movePp,pp);assert.equal(battle.pending.get(b),pending);
  assert.equal(events.length,beforeEvents+1);assert.equal(events.at(-1).event,'requestAction');assert.equal(events.at(-1).data.turnId,battle.token);
  fixed(()=>battle.action(a,{action:'attack',number:0,turnId:battle.token}));battle.finish(null,'fled');assert.equal(a.equipe.pokemons[0].heldItem,item);
 });
}
test('selection validates slot bounds and exposes only slot zero for Struggle',()=>{
 const p=mon('choice_band');engine.ensureBattleData(p).choiceMove='Crunch';p.movePp[1]=0;
 assert(resources.isMoveSelectionValid(p,0));for(const i of [1,-1,4,'0',null,undefined])assert(!resources.isMoveSelectionValid(p,i));
});
test('Knock Off and Magic Room suspend the Choice restriction; the held item and lock are not lost permanently',()=>{
 const p=mon('choice_band'),q=mon(),field=engine.createBattleState();fixed(()=>engine.useattack('Tackle',p,q,{battleState:field}));
 engine.knockOffHeldItem(q,p);assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0,1]);clearBattleTransientState([p]);assert.equal(p.heldItem,'choice_band');
 fixed(()=>engine.useattack('Tackle',p,q,{battleState:field}));field.field.magicRoomTurns=2;assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0,1]);field.field.magicRoomTurns=0;assert.deepEqual(resources.getUsableMoveIndexes(p,field),[0]);
});

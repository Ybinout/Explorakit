const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const selection=require('../server/game/battle/moveSelection'),ai=require('../server/game/battle/humanTrainerAI');
const legacy=require('../server/game/drift/colosseumAI'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id,moves){const p=factory.create(id,50,true);Object.assign(p,{passiveAbility:null,heldItem:null,abilities:moves,movePp:moves.map(resources.getMaxMovePp),currentHp:2000,maxHp:2000,__battle:{statStages:{},sleepTurns:1}});return p;}
function fixture(name){const a=mon(51,[name,'Tackle']),b=mon(143,['Splash']),field=engine.createBattleState();return{a,b,field,context:{opponent:b,ownSide:field.sides.enemy,enemySide:field.sides.player}};}
const repeatable=['Encore','Rain Dance','Sunny Day','Sandstorm','Hail','Electric Terrain','Grassy Terrain','Misty Terrain','Psychic Terrain','Reflect','Light Screen','Aurora Veil','Safeguard','Mist','Tailwind','Lucky Chant','Gravity','Mud Sport','Water Sport','Taunt','Disable','Torment','Heal Block','Embargo','Leech Seed','Aqua Ring','Ingrain','Substitute','Magnet Rise','Telekinesis','Wish','Laser Focus','Lock-On','Foresight','Miracle Eye','Toxic','Confuse Ray'];
test('completed effects are skipped by automated selectors after the real engine installs them',()=>{
 const random=Math.random;Math.random=()=>.5;
 try{for(const name of repeatable){const f=fixture(name);f.b.__battle.lastMoveUsed='Splash';if(name==='Aurora Veil')f.field.weather={kind:'hail',turns:5};
  const result=engine.useattack(name,f.a,f.b,{battleState:f.field,attackerSide:f.context.ownSide,defenderSide:f.context.enemySide});assert.notEqual(result.success,false,name);
  assert(selection.redundantReason(f.a,engine.getMoveByName(name),f.field,f.context),name);assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[1],name);
 }}finally{Math.random=random;}
});
test('expired effects, partial boosts and hazards remain useful; damaging attacks and room cancellation are preserved',()=>{
 const f=fixture('Rain Dance');f.field.weather={kind:'rain',turns:1};assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[1]);f.field.weather.kind=null;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0,1]);
 f.a.abilities=['Encore','Tackle'];f.b.__battle.lastMoveUsed='Splash';f.b.__battle.encoreTurns=2;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[1]);f.b.__battle.encoreTurns=0;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0,1]);
 f.a.abilities=['Calm Mind','Tackle'];f.a.__battle.statStages={specialAttack:6,specialDefense:0};assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Calm Mind'),f.field,f.context),null);f.a.__battle.statStages.specialDefense=6;assert(selection.redundantReason(f.a,engine.getMoveByName('Calm Mind'),f.field,f.context));
 f.a.abilities=['Spikes','Tackle'];f.context.enemySide.hazards.spikes=2;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0,1]);f.context.enemySide.hazards.spikes=3;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[1]);assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Crunch'),f.field,f.context),null);
 f.a.abilities=['Trick Room','Tackle'];f.field.field.trickRoomTurns=3;assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0,1]);
 assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Encore'),f.field,{...f.context,opponent:{...f.b,__battle:{}}}),null,'slower Encore can anticipate a first move');
 assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Recover'),f.field,{...f.context,incomingDamage:100}),null,'recovery may follow incoming damage');
 f.a.__battle.substituteHp=100;assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Substitute'),f.field,{...f.context,incomingDamage:120}),null,'a clone may be renewed after it breaks');
});
test('capped stages respect Contrary, suppression and Mold Breaker; Rest can still cure a status at full HP',()=>{
 const f=fixture('Swords Dance');f.a.passiveAbility='Contrary';f.a.__battle.statStages.attack=-6;assert(selection.redundantReason(f.a,engine.getMoveByName('Swords Dance'),f.field,f.context));f.a.__battle.abilitySuppressed=true;assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Swords Dance'),f.field,f.context),null);
 f.a.passiveAbility='Mold Breaker';f.a.__battle.abilitySuppressed=false;f.b.passiveAbility='Contrary';f.b.__battle.statStages.attack=6;assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Growl'),f.field,f.context),null);
 assert(selection.redundantReason(f.a,engine.getMoveByName('Rest'),f.field,f.context));f.a.status='paralyze';assert.equal(selection.redundantReason(f.a,engine.getMoveByName('Rest'),f.field,f.context),null);f.a.__battle.statStages.critical=4;assert(selection.redundantReason(f.a,engine.getMoveByName('Focus Energy'),f.field,f.context));
});
test('legacy difficulty levels also avoid existing weather; forced locks never grant free Struggle',()=>{
 const f=fixture('Rain Dance');f.field.weather={kind:'rain',turns:5};
 for(const version of[2,3,5])for(const wave of[1,6,11,16,51]){const action=legacy.chooseAction({team:[f.a],opponent:f.b,field:f.field,ownSide:f.context.ownSide,enemySide:f.context.enemySide,wave,version,memory:{seen:{}},round:3});if(action)assert.equal(action.number,1,`${version}:${wave}`);}
 f.a.heldItem='choice_specs';f.a.__battle.choiceMove='Rain Dance';assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0]);f.a.abilities=['Rain Dance'];f.a.movePp=[5];assert.deepEqual(selection.preferMoves(f.a,f.field,undefined,f.context),[0]);
});
test('trainer candidates exclude active effects under lethal pressure; all-bad moves can yield to a legal switch',()=>{
 const f=fixture('Rain Dance');f.a.currentHp=1;f.field.weather={kind:'rain',turns:5};f.b.abilities=['Quick Attack'];f.b.movePp=[30];const options={team:[f.a],opponentTeam:[f.b],field:f.field,ownSide:f.context.ownSide,enemySide:f.context.enemySide,memory:{},round:3};
 assert(!ai.analyse(options).candidates.some(c=>c.action==='attack'&&c.number===0));assert.deepEqual(ai.chooseAction(options),{action:'attack',number:1});const reserve=mon(143,['Body Slam']);f.a.heldItem='choice_specs';f.a.__battle.choiceMove='Rain Dance';assert.equal(ai.chooseAction({...options,team:[f.a,reserve]}).action,'change');
});
test('Sucker Punch failures learn only completed matchups, remain bounded and reset after success',()=>{
 const a=mon(51,['Sucker Punch','Knock Off']),b=mon(94,['Recover','Shadow Ball']),memory={};b.currentHp=b.maxHp=150;
 for(let i=0;i<10;i++){ai.observeMove(memory,b.uuid,'Recover');ai.observeOutcome(memory,a,b,'Sucker Punch',{success:false,damage:0});}assert.equal(memory.suckerPressure.failures,4);const before=structuredClone(memory);ai.observeOutcome(memory,a,b,'Sucker Punch',{actionPrevented:true,damage:0});assert.deepEqual(memory,before);
 const field=engine.createBattleState(),options={team:[a],opponentTeam:[b],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory,round:11};for(let round=11;round<25;round++)assert.deepEqual(ai.chooseAction({...options,round}),{action:'attack',number:1});
 const snapshot=JSON.stringify(options);Object.defineProperty(field,'turnActions',{get(){throw Error('Read current command');}});assert(ai.chooseAction(options));assert.equal(JSON.stringify({...options,field:null}),JSON.stringify({...JSON.parse(snapshot),field:null}));ai.observeOutcome(memory,a,b,'Sucker Punch',{success:true,damage:0,substituteDamage:10});assert.equal(memory.suckerPressure,null);
});
test('public snapshots expose only presence of random confusion/infatuation timers',()=>{
 const f=fixture('Encore');f.a.__battle.confusionTurns=4;f.b.__battle.confusionTurns=3;f.b.__battle.infatuationTurns=5;const visible=ai.publicPokemon(f.b);assert.equal(visible.__battle.confusionTurns,1);assert.equal(visible.__battle.infatuationTurns,1);assert.equal(f.a.__battle.confusionTurns,4);
});
for(const mode of['rift','colosseum'])for(const type of['trainer','wild'])test(`${mode} ${type}: installed Encore and rain cannot loop; checkpoints retain decisions`,()=>{
 const lead=mon(143,['Splash']),foe=mon(51,['Rain Dance','Encore','Tackle','Swords Dance']);lead.maxHp=lead.currentHp=10000;
 const a={userId:1,socketId:'test',currentmap:'route1',run:{mode},equipe:{pokemons:[lead]},items:{},drifts:[],equipped:[],defeated:new Set(),chain:0,money:0},b={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};const battle=new DriftBattle(a,b,{type,emit(){},random:()=>0,paceMs:0});
 try{foe.__battle.statStages.attack=6;lead.__battle.lastMoveUsed='Splash';engine.useattack('Encore',foe,lead,{battleState:battle.state,attackerSide:battle.sides[1],defenderSide:battle.sides[0]});battle.request();assert.equal(battle.pending.get(b).number,2);
  const saved=codec.decode(codec.encode(battle));saved.emit=()=>{};saved.resume(saved.a);assert.deepEqual(saved.pending.get(saved.b),battle.pending.get(b));saved.finished=true;
  for(let i=0;i<2;i++){if(lead.__battle.encoreTurns>0)assert.equal(battle.pending.get(b).number,2);assert(battle.action(a,{action:'attack',number:0,turnId:battle.token}));battle.tick();assert(!battle.finished);}
 }finally{battle.finished=true;}
});

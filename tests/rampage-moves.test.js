const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const rampage=require('../server/game/battle/rampageMoves'),factory=require('../server/game/drift/pokemonFactory');
const ai=require('../server/game/battle/humanTrainerAI'),model=require('../server/game/battle/humanTrainerModel');
const team=require('../server/game/battle/battleTeam'),outcome=require('../server/game/battle/battleOutcome');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id=149,names=['Outrage','Tackle']){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.abilities=names;p.movePp=names.map(resources.getMaxMovePp);p.maxHp=p.currentHp=5000;return p;}
const fixed=(roll,fn)=>{const before=Math.random;Math.random=()=>roll;try{return fn();}finally{Math.random=before;}};
const hit=(a,b,field,name='Outrage')=>engine.useattack(name,a,b,{battleState:field,attackerSide:field.sides.player,defenderSide:field.sides.enemy});
for(const name of Object.keys(rampage.NAMES))for(const [roll,length]of[[.4,2],[.9,3]])test(`${name}: ${length} real hits, only initial PP, no alternate move/switch and fatigue only at the end`,()=>fixed(roll,()=>{
 const a=mon(149,[name,'Tackle']),b=mon(143,['Splash']),f=engine.createBattleState();a.movePp[0]=1;
 for(let turn=0;turn<length;turn++){
  const result=hit(a,b,f,turn===0?name:'Tackle');assert.equal(result.moveName,name);assert(result.damage>0);assert.equal(result.hits,1);
  assert.deepEqual(a.movePp,[0,35]);
  if(turn<length-1){assert.equal(resources.getForcedMove(a),name);assert.deepEqual(resources.getUsableMoveIndexes(a,f),[0]);assert.equal(engine.canSwitchOut(a,b,f),false);assert.equal(a.__battle.confusionTurns,0);}
  f.turn++;
 }
 assert.equal(resources.getForcedMove(a),null);assert(a.__battle.confusionTurns>0);assert(engine.canSwitchOut(a,b,f));
 assert.deepEqual(resources.getUsableMoveIndexes(a,f),[1]);assert.equal(hit(a,b,f,'Tackle').moveName,'Tackle');
}));
for(const interrupt of ['Protect','fairy','miss','flinch','paralyze','disabled','sleep'])for(const [roll,length]of[[.4,2],[.9,3]])test(`Outrage: ${interrupt} interrupts ${length===2?'final':'middle'} action; only final fatigue and sleep never confuses`,()=>fixed(roll,()=>{
 const a=mon(),b=mon(143,['Splash']),f=engine.createBattleState();hit(a,b,f);f.turn++;
 if(interrupt==='Protect')engine.ensureBattleData(b).protect=true;
 if(interrupt==='fairy'){b.type1='Fairy';b.type2=null;}
 if(interrupt==='miss')Object.assign(engine.ensureBattleData(b),{semiInvulnerable:'underground',chargeMove:'Dig',chargeTurns:1});
 if(interrupt==='flinch')a.__battle.flinch=true;
 if(interrupt==='paralyze')a.status='paralyze';
 if(interrupt==='disabled')Object.assign(a.__battle,{disabledMove:'Outrage',disableTurns:2});
 if(interrupt==='sleep'){a.status='sleep';a.__battle.sleepTurns=3;}
 const result=interrupt==='paralyze'?fixed(.1,()=>hit(a,b,f)):hit(a,b,f);
 assert.equal(result.damage,0);assert.equal(resources.getForcedMove(a),null);assert.equal(a.__battle.confusionTurns>0,length===2&&interrupt!=='sleep');
 assert.equal(a.movePp[0],resources.getMaxMovePp('Outrage')-1);
}));
test('an initial failure never starts a rampage, and Pressure consumes PP only on activation',()=>fixed(.9,()=>{
 const a=mon(),b=mon(143,['Splash']),f=engine.createBattleState();b.passiveAbility='Pressure';engine.ensureBattleData(b).protect=true;
 hit(a,b,f);assert.equal(resources.getForcedMove(a),null);assert.equal(a.__battle.confusionTurns,0);assert.equal(a.movePp[0],13);
 b.__battle.protect=false;hit(a,b,f);assert.equal(a.movePp[0],11);f.turn++;hit(a,b,f);assert.equal(a.movePp[0],11);
}));
for(const protection of ['Own Tempo','Misty Terrain','Lum Berry','Persim Berry','Unnerve'])test(`Outrage fatigue respects ${protection}`,()=>fixed(.4,()=>{
 const a=mon(),b=mon(143,['Splash']),f=engine.createBattleState();a.type1='Normal';a.type2=null;
 if(protection==='Own Tempo')a.passiveAbility='Own Tempo';
 if(protection==='Misty Terrain')f.terrain={kind:'misty_terrain',turns:4};
 if(['Lum Berry','Unnerve'].includes(protection))a.heldItem='lum_berry';
 if(protection==='Persim Berry')a.heldItem='persim_berry';
 if(protection==='Unnerve')b.passiveAbility='Unnerve';
 hit(a,b,f);f.turn++;hit(a,b,f);assert.equal(resources.getForcedMove(a),null);
 assert.equal(a.__battle.confusionTurns>0,protection==='Unnerve');
 if(protection.endsWith('Berry'))assert.equal(a.heldItem,null);if(protection==='Unnerve')assert.equal(a.heldItem,'lum_berry');
}));
test('last target KO retains the lock for its replacement; forced switch, sleep, KO and battle cleanup remove it',()=>fixed(.9,()=>{
 const a=mon(),b=mon(143,['Splash']),f=engine.createBattleState();b.currentHp=1;hit(a,b,f);assert(resources.getForcedMove(a));
 const replacement=mon(143,['Splash']);f.turn++;assert.equal(hit(a,replacement,f,'Tackle').moveName,'Outrage');
 const reserve=mon(6,['Tackle']);team.switchPokemonByIndex([a,reserve],1);assert.equal(resources.getForcedMove(a),null);
 hit(a,replacement,f);a.status='sleep';a.__battle.sleepTurns=3;engine.processEndOfRound(a,replacement,f.sides.player,f.sides.enemy,f);assert.equal(resources.getForcedMove(a),null);assert.equal(a.__battle.confusionTurns,0);
 a.status='normal';hit(a,replacement,f);a.currentHp=1;const attacker=mon(143,['Dragon Claw']);attacker.currentAttack=99999;hit(attacker,a,f,'Dragon Claw');assert.equal(a.currentHp,0);assert.equal(a.__battle.rampageMove,undefined);
 a.currentHp=5000;hit(a,replacement,f);outcome.clearBattleTransientState([a]);assert.equal(a.__battle,undefined);assert.equal(resources.getForcedMove(a),null);
}));
test('Copycat can initiate a rampage without a known slot; Sleep Talk and Dancer cannot lock their caller',()=>fixed(.4,()=>{
 const a=mon(149,['Copycat','Tackle']),b=mon(143,['Outrage']),f=engine.createBattleState();engine.ensureBattleData(b).lastMoveUsed='Outrage';
 const copied=hit(a,b,f,'Copycat');assert(copied.damage>0);assert.equal(resources.getForcedMove(a),'Outrage');assert.deepEqual(resources.getUsableMoveIndexes(a,f),[-1]);f.turn++;
 const continued=hit(a,b,f,'Tackle');assert.equal(continued.moveName,'Outrage');assert(continued.damage>0);assert.equal(a.movePp[0],19);assert.equal(a.movePp[1],35);assert.equal(resources.getForcedMove(a),null);
 const sleeper=mon(149,['Outrage','Sleep Talk']);sleeper.status='sleep';engine.ensureBattleData(sleeper).sleepTurns=3;
 const asleep=fixed(0,()=>hit(sleeper,b,f,'Sleep Talk'));assert(asleep.damage>0);assert.equal(resources.getForcedMove(sleeper),null);assert.equal(sleeper.movePp[0],resources.getMaxMovePp('Outrage'));
 const dancer=mon(143,['Tackle']),flower=mon(3,['Petal Dance']);dancer.passiveAbility='Dancer';assert(hit(flower,dancer,f,'Petal Dance').damage>0);assert.equal(resources.getForcedMove(flower),'Petal Dance');assert.equal(resources.getForcedMove(dancer),null);
}));
test('AI follows its own lock and sees the opposing lock without reading its private random remaining duration',()=>fixed(.9,()=>{
 const a=mon(),b=mon(143,['Outrage']),f=engine.createBattleState();hit(a,b,f);
 const o={team:[a],opponentTeam:[b],field:f,ownSide:f.sides.player,enemySide:f.sides.enemy,memory:{}};
 assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});assert.equal(ai.publicPokemon(a).__battle.rampageTurns,1);
 Object.defineProperty(a.__battle,'rampageTurns',{get(){throw Error('Private random duration read');},configurable:true});
 const visible=ai.publicPokemon(a);assert.equal(visible.__battle.rampageTurns,1);assert.equal(resources.getForcedMove(visible),'Outrage');
}));
for(const stage of ['first','last','protected','own-tempo','lum'])test(`deterministic trainer model agrees with actual Outrage lock/PP/fatigue: ${stage}`,()=>fixed(.9,()=>{
 const a=mon(),b=mon(143,['Splash']),f=engine.createBattleState();
 if(stage!=='first')Object.assign(engine.ensureBattleData(a),{rampageMove:'Outrage',rampageTurns:1});
 if(stage==='protected')engine.ensureBattleData(b).protect=true;
 if(stage==='own-tempo')a.passiveAbility='Own Tempo';if(stage==='lum')a.heldItem='lum_berry';
 const ctx={field:f,ownSide:f.sides.player,enemySide:f.sides.enemy,chance:()=>1,damage:(p,q,m,s,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:s})};
 const ownView={...ai.publicPokemon(a),heldItem:a.heldItem,movePp:[...a.movePp],__battle:structuredClone(a.__battle||{statStages:{}})};
 const reply=stage==='protected'?'Protect':'Splash';
 const before=JSON.stringify([a,b,f]);const original=Math.random;Math.random=()=>{throw Error('Model consumed combat RNG');};let projection;
 try{projection=model.project(ownView,ai.publicPokemon(b),engine.getMoveByName('Outrage'),engine.getMoveByName(reply),ctx,{first:stage!=='protected'});}finally{Math.random=original;}
 assert.equal(JSON.stringify([a,b,f]),before);
 const actual=hit(a,b,f);assert(actual);const predicted=projection.own;
 if(stage==='first')assert.deepEqual(rampage.current(predicted),rampage.current(a));
 else {assert.equal(resources.getForcedMove(predicted),null);assert.equal(resources.getForcedMove(a),null);}
 assert.equal(predicted.__battle.confusionTurns>0,a.__battle.confusionTurns>0);assert.equal(predicted.heldItem,a.heldItem);
 assert.equal(predicted.movePp[0],a.movePp[0]);if(stage==='protected')assert.equal(projection.foe.currentHp,b.currentHp);
}));
for(const mode of ['rift','colosseum'])test(`${mode}: automatic last-PP Outrage resumes its full chain after checkpoint and returns the action prompt`,()=>fixed(.9,()=>{
 const a=mon(),b=mon(143,['Splash']);a.movePp[0]=1;const player={userId:1,currentmap:'route2',run:{mode},equipe:{pokemons:[a]},items:{},drifts:[],equipped:[],money:0,defeated:new Set()},npc={npc:true,equipe:{pokemons:[b]},drifts:[],equipped:[]};const events=[];
 const battle=new DriftBattle(player,npc,{type:'trainer',emit:(p,name,payload)=>events.push({name,payload}),paceMs:0,random:()=>.9});
 assert(battle.action(player,{action:'attack',number:0,turnId:battle.token}));assert.equal(a.movePp[0],0);assert.equal(a.__battle.rampageTurns,2);
 const saved=codec.decode(codec.encode(battle));saved.emit=(p,name,payload)=>events.push({name,payload});saved.random=()=>.9;saved.now=Date.now;saved.resume(saved.a);battle.finished=true;
 assert.equal(saved.a.equipe.pokemons[0].__battle.rampageTurns,2);const prompts=events.filter(e=>e.name==='requestAction').length;
 saved.tick();assert.equal(saved.a.equipe.pokemons[0].__battle.rampageTurns,1);assert.equal(events.filter(e=>e.name==='requestAction').length,prompts);
 saved.tick();assert.equal(resources.getForcedMove(saved.a.equipe.pokemons[0]),null);assert(saved.a.equipe.pokemons[0].__battle.confusionTurns>0);saved.tick();
 assert.equal(events.filter(e=>e.name==='requestAction').length,prompts+1);assert.equal(saved.a.equipe.pokemons[0].movePp[0],0);saved.finished=true;
}));

const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const sequences=require('../server/game/battle/moveSequences'),pursuit=require('../server/game/battle/pursuit');
const ai=require('../server/game/battle/humanTrainerAI'),model=require('../server/game/battle/humanTrainerModel');
const {planTurnActions,pendingMove}=require('../server/game/battle/turnActions');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const {DriftBattle}=require('../server/game/drift/driftBattle');
function mon(id=143,moves=['Splash']){
 const p=factory.create(id,50,true);Object.assign(p,{uuid:'sequence-'+id,abilities:moves,movePp:moves.map(resources.getMaxMovePp),
  type1:'Normal',type2:null,maxHp:10000,currentHp:10000,status:'normal',passiveAbility:null,heldItem:null,
  attack:100,currentAttack:100,defense:100,currentDefense:100,specialAttack:100,currentSpecialAttack:100,specialDefense:100,currentSpecialDefense:100,speed:100,currentSpeed:100});
 engine.ensureBattleData(p);return p;
}
function fixed(fn,roll=.5){const original=Math.random;Math.random=()=>roll;try{return fn();}finally{Math.random=original;}}
function board(name,side='player'){
 const a=mon(143,[name,'Splash']),b=mon(9,['Splash']),field=engine.createBattleState();
 const other=side==='player'?'enemy':'player';
 const cast=(move=name,p=a,q=b)=>engine.useattack(move,p,q,{battleState:field,attackerSide:field.sides[p===a?side:other],defenderSide:field.sides[p===a?other:side],attackerTeam:[p],defenderTeam:[q]});
 return {a,b,field,cast,side:field.sides[side],otherSide:field.sides[other]};
}
function oracle(a,b,name,power){return engine.calculateDamage(structuredClone(a),structuredClone(b),{...engine.getMoveByName(name),ename:'Independent fixed-power reference',power});}
for(const side of ['player','enemy'])for(const name of ['Rollout','Ice Ball'])test(`${side} ${name}: five escalating turns, one PP, forced choice, then a fresh chain`,()=>fixed(()=>{
 const f=board(name,side);f.a.movePp[0]=1;
 for(let turn=1;turn<=5;turn++){
  f.field.turn=turn;const expected=oracle(f.a,f.b,name,30*2**(turn-1)),result=f.cast(turn===1?name:'Splash');
  assert.equal(result.moveName,name);assert.equal(result.damage,expected);assert.equal(f.a.movePp[0],0);
  assert.equal(resources.getForcedMove(f.a),turn===5?null:name);
  assert.equal(engine.canSwitchOut(f.a,f.b,f.field),turn===5);
 }
 f.field.turn++;f.a.movePp[0]=1;assert.equal(f.cast().damage,oracle(f.a,f.b,name,30));
}));
for(const name of ['Rollout','Ice Ball'])for(const cause of ['protect','miss','sleep','flinch','paralyze','disable','ability','immune'])test(`${name}: ${cause} ends the lock and resets power without extra PP`,()=>fixed(()=>{
 const f=board(name);f.cast();f.field.turn++;
 if(cause==='protect')f.b.__battle.protect=true;
 if(cause==='miss')f.b.__battle.statStages.evasion=6;
 if(cause==='sleep'){f.a.status='sleep';f.a.__battle.sleepTurns=3;}
 if(cause==='flinch')f.a.__battle.flinch=true;
 if(cause==='paralyze')f.a.status='paralyze';
 if(cause==='disable')Object.assign(f.a.__battle,{disabledMove:name,disableTurns:2});
 if(cause==='ability')f.b.passiveAbility='Wonder Guard';
 if(cause==='immune'){f.a.passiveAbility='Normalize';f.b.type1='Ghost';}
 const result=cause==='paralyze'?fixed(()=>f.cast(),.1):f.cast();
 assert.equal(result.damage,0);assert.equal(resources.getForcedMove(f.a),null);assert.equal(f.a.movePp[0],19);
}));
for(const name of ['Rollout','Ice Ball'])test(`${name}: Defense Curl doubles the chain; switching and battle cleanup remove it`,()=>fixed(()=>{
 const f=board(name);f.a.abilities.push('Defense Curl');f.a.movePp.push(40);f.cast('Defense Curl');f.field.turn++;
 assert.equal(f.cast().damage,oracle(f.a,f.b,name,60));f.field.turn++;
 f.b.currentHp=1;f.cast();assert(resources.getForcedMove(f.a));
 const next=mon(25);assert.equal(f.cast('Splash',f.a,next).moveName,name);
 switchPokemonByIndex([f.a,mon(3)],1);assert.equal(resources.getForcedMove(f.a),null);assert.equal(f.a.__battle,undefined);
}));
for(const side of ['player','enemy'])test(`${side} Fury Cutter reaches 160 and keeps spending one PP per use`,()=>fixed(()=>{
 const f=board('Fury Cutter',side);
 for(const[turn,power]of [[1,40],[2,80],[3,160],[4,160]]){f.field.turn=turn;assert.equal(f.cast().damage,oracle(f.a,f.b,'Fury Cutter',power));assert.equal(f.a.movePp[0],20-turn);}
}));
for(const cause of ['different','skip','protect','miss','flinch','switch'])test(`Fury Cutter resets after ${cause}`,()=>fixed(()=>{
 const f=board('Fury Cutter');f.cast();f.field.turn++;
 if(cause==='different')f.cast('Splash');
 if(cause==='protect'){f.b.__battle.protect=true;f.cast();f.b.__battle.protect=false;}
 if(cause==='miss'){f.b.__battle.statStages.evasion=6;f.cast();f.b.__battle.statStages.evasion=0;}
 if(cause==='flinch'){f.a.__battle.flinch=true;f.cast();}
 if(cause==='switch')switchPokemonByIndex([f.a,mon(25)],1);
 f.field.turn++;assert.equal(f.cast().damage,oracle(f.a,f.b,'Fury Cutter',40));
}));
test('Echoed Voice is shared by both sides, increases once per turn up to 200 and resets after an unused turn',()=>fixed(()=>{
 const f=board('Echoed Voice');f.b.abilities=['Echoed Voice'];f.b.movePp=[15];
 for(let turn=1;turn<=6;turn++){
  f.field.turn=turn;const power=Math.min(200,turn*40);
  assert.equal(f.cast().damage,oracle(f.a,f.b,'Echoed Voice',power));
  assert.equal(f.cast('Echoed Voice',f.b,f.a).damage,oracle(f.b,f.a,'Echoed Voice',power));
 }
 f.field.turn+=2;assert.equal(f.cast().damage,oracle(f.a,f.b,'Echoed Voice',40));
}));
for(const cause of ['protect','miss','immune','soundproof'])test(`Echoed Voice attempted against ${cause} still builds its field chain`,()=>fixed(()=>{
 const f=board('Echoed Voice');
 if(cause==='protect')f.b.__battle.protect=true;if(cause==='miss')f.b.__battle.statStages.evasion=6;
 if(cause==='immune')f.b.type1='Ghost';if(cause==='soundproof')f.b.passiveAbility='Soundproof';
 assert.equal(f.cast().damage,0);f.field.turn++;f.b.__battle.protect=false;f.b.__battle.statStages.evasion=0;f.b.type1='Normal';f.b.passiveAbility=null;
 assert.equal(f.cast().damage,oracle(f.a,f.b,'Echoed Voice',80));
}));
for(const source of ['hit','poison','recoil','hazard'])test(`Retaliate doubles only in the turn following an ally's ${source} KO`,()=>fixed(()=>{
 const f=board('Retaliate'),ally=mon(25,['Splash']);ally.currentHp=1;
 if(source==='poison'){ally.status='poison';engine.processEndOfRound(ally,f.b,f.side,f.otherSide,f.field);}
 if(source==='hit')f.cast('Tackle',f.b,ally);
 if(source==='recoil'){ally.abilities=['Double-Edge'];ally.movePp=[15];engine.useattack('Double-Edge',ally,f.b,{battleState:f.field,attackerSide:f.side,defenderSide:f.otherSide});}
 if(source==='hazard'){f.side.hazards.stealthRock=true;engine.applySwitchInEffects(ally,f.side,f.otherSide,f.field,f.b);}
 assert.equal(ally.currentHp,0);assert.equal(f.side.lastFaintTurn,1);f.field.turn=2;
 assert.equal(f.cast().damage,oracle(f.a,f.b,'Retaliate',140));f.field.turn=3;
 assert.equal(f.cast().damage,oracle(f.a,f.b,'Retaliate',70));
}));
test('Retaliate retains the previous-round KO when a second ally faints to hazards during the current round',()=>fixed(()=>{
 const f=board('Retaliate'),first=mon(25),second=mon(4);first.currentHp=0;sequences.recordFaint(first,f.side,f.field);
 f.field.turn=2;second.currentHp=1;f.side.hazards.stealthRock=true;engine.applySwitchInEffects(second,f.side,f.otherSide,f.field,f.b);
 assert.equal(f.side.previousFaintTurn,1);assert.equal(f.side.lastFaintTurn,2);assert.equal(f.cast().damage,oracle(f.a,f.b,'Retaliate',140));
 f.field.turn=3;assert.equal(f.cast().damage,oracle(f.a,f.b,'Retaliate',140));f.field.turn=4;assert.equal(f.cast().damage,oracle(f.a,f.b,'Retaliate',70));
}));
test('Fling cannot revive a target knocked out by the impact or consume its own equipment instead',()=>fixed(()=>{
 const f=board('Fling');f.a.heldItem='sitrus_berry';f.b.heldItem='leftovers';f.b.currentHp=1;
 f.cast();assert.equal(f.b.currentHp,0);assert.equal(f.b.heldItem,'leftovers');assert.equal(f.a.heldItem,null);assert(!f.field.berryEaters?.includes(f.b.uuid));
}));
for(const name of ['Fusion Bolt','Fusion Flare'])for(const cause of ['same-turn','previous-turn','protected','intervening'])test(`${name} combo history: ${cause}`,()=>fixed(()=>{
 const f=board(name),other=name==='Fusion Bolt'?'Fusion Flare':'Fusion Bolt';f.b.abilities=[other,'Growl'];f.b.movePp=[5,40];
 if(cause==='protected')f.a.__battle.protect=true;
 f.cast(other,f.b,f.a);f.a.__battle.protect=false;
 if(cause==='previous-turn')f.field.turn++;
 if(cause==='intervening')f.cast('Growl',f.b,f.a);
 assert.equal(f.cast().damage,oracle(f.a,f.b,name,cause==='same-turn'?200:100));
}));
for(const side of ['player','enemy'])test(`${side} Pursuit intercepts the outgoing Pokémon, doubles and consumes its queued action exactly once`,()=>fixed(()=>{
 const f=board('Pursuit',side),next=mon(25);planTurnActions(f.field,[{pokemon:f.a,action:'attack',moveName:'Pursuit'},{pokemon:f.b,action:'change'}]);
 f.a.__battle.statStages.accuracy=-6;f.b.__battle.statStages.evasion=6;
 const expected=oracle(f.a,f.b,'Pursuit',80);let result;
 assert(pursuit.intercept(f.field,f.b,f.a,()=>{result=f.cast();}));assert.equal(result.damage,expected);
 assert.equal(next.currentHp,10000);assert.equal(f.a.movePp[0],19);assert.equal(pendingMove(f.field,f.a),null);assert.equal(f.field.pursuitSwitching,undefined);
 assert.equal(pursuit.intercept(f.field,f.b,f.a,()=>assert.fail('attacked twice')),false);
}));
test('Pursuit normal hits use 40 power; interrupted interception still spends the action and removes Destiny Bond',()=>fixed(()=>{
 const f=board('Pursuit');assert.equal(f.cast().damage,oracle(f.a,f.b,'Pursuit',40));
 f.field.turn++;planTurnActions(f.field,[{pokemon:f.a,action:'attack',moveName:'Pursuit'}]);f.a.__battle.flinch=true;f.b.__battle.destinyBond=true;
 pursuit.intercept(f.field,f.b,f.a,()=>f.cast());assert.equal(pendingMove(f.field,f.a),null);assert.equal(f.a.movePp[0],19);assert.equal(f.b.__battle.destinyBond,false);
}));
test('Pursuit interception is not saved mid-animation and is removed after asynchronous failure',async()=>{
 const f=board('Pursuit');planTurnActions(f.field,[{pokemon:f.a,action:'attack',moveName:'Pursuit'}]);
 await assert.rejects(pursuit.intercept(f.field,f.b,f.a,async()=>{
  assert(pursuit.switching(f.field,f.b));assert(!JSON.stringify(f.field).includes('pursuitSwitching'));
  assert.equal(pursuit.switching(codec.decode(codec.encode(f.field)),f.b),false);throw Error('interrupted animation');
 }),/interrupted animation/);assert.equal(f.field.pursuitSwitching,undefined);
});
for(const item of ['oran_berry','sitrus_berry','lum_berry','persim_berry','leppa_berry','salac_berry'])test(`Fling ${item} applies the berry to its target without taking the target's equipment`,()=>fixed(()=>{
 const f=board('Fling');f.a.heldItem=item;f.b.heldItem='leftovers';f.b.maxHp=10000;f.b.currentHp=5000;f.b.status='burn';f.b.__battle.confusionTurns=3;f.b.movePp=[0];
 const before=f.b.currentHp,result=f.cast();assert(result.damage>0);assert.equal(f.a.heldItem,null);assert.equal(f.b.heldItem,'leftovers');
 if(item==='oran_berry')assert.equal(f.b.currentHp,before-result.damage+10);
 if(item==='sitrus_berry')assert.equal(f.b.currentHp,before-result.damage+2500);
 if(item==='lum_berry'){assert.equal(f.b.status,'normal');assert.equal(f.b.__battle.confusionTurns,0);}
 if(item==='persim_berry'){assert.equal(f.b.status,'burn');assert.equal(f.b.__battle.confusionTurns,0);}
 if(item==='leppa_berry')assert.equal(f.b.movePp[0],10);
 if(item==='salac_berry')assert.equal(f.b.__battle.statStages.speed,1);
 assert(f.field.berryEaters.includes(f.b.uuid));assert(!f.field.berryEaters.includes(f.a.uuid));
}));
for(const defense of ['protect','immune','substitute','heal-block','cheek-pouch','unnerve'])test(`Fling berry interaction with ${defense}`,()=>fixed(()=>{
 const f=board('Fling');f.a.heldItem='oran_berry';f.b.currentHp=5000;const before=f.b.currentHp;
 if(defense==='protect')f.b.__battle.protect=true;if(defense==='immune')f.b.passiveAbility='Wonder Guard';
 if(defense==='substitute')f.b.__battle.substituteHp=1000;
 if(defense==='heal-block')f.b.__battle.healBlockTurns=2;
 if(defense==='cheek-pouch')f.b.passiveAbility='Cheek Pouch';
 if(defense==='unnerve')f.a.passiveAbility='Unnerve';
 const r=f.cast(),healing=defense==='heal-block'||defense==='protect'||defense==='immune'||defense==='substitute'?0:10+(defense==='cheek-pouch'?Math.floor(f.b.maxHp/3):0);
 assert.equal(f.b.currentHp,before-r.damage+healing);assert.equal(f.a.heldItem,['protect','immune'].includes(defense)?'oran_berry':null);
 assert.equal(Boolean(f.field.berryEaters?.includes(f.b.uuid)),!['protect','immune','substitute'].includes(defense));
}));
test('Aqua Jet is a 40-power physical Water priority move with 20 PP; CS teaches only native compatible species',()=>fixed(()=>{
 const f=board('Aqua Jet');f.a.currentSpeed=1;f.b.currentSpeed=999;
 const move=engine.getMoveByName('Aqua Jet');assert.equal(move.power,40);assert.equal(move.type,'Water');assert.equal(move.combat.damage_class,'physical');assert.equal(move.pp,20);
 assert.equal(engine.orderBattleActions([{pokemon:f.b,moveName:'Tackle'},{pokemon:f.a,moveName:'Aqua Jet'}],f.field)[0].pokemon,f.a);
 assert.equal(f.cast().damage,oracle(f.a,f.b,'Aqua Jet',40));assert.equal(f.a.movePp[0],19);
 const {machines,teachMachine}=require('../server/game/items/machines'),machine=machines.cs_aqua_jet;assert.equal(machine.name,'CS Aqua-Jet');assert.equal(machine.price,3000);
 for(const id of machine.species){assert(id<=493);const p=mon(id,['Tackle']);assert.equal(teachMachine(p,'cs_aqua_jet',{slot:1,expectedMoves:p.abilities}).abilities[1],'Aqua Jet');}
 for(const id of [25,129,130])assert(!machine.species.includes(id));assert(machine.species.includes(7));assert(machine.species.includes(395));
}));
test('sequence histories survive checkpoints; planner copies only completed public events and never reads live intentions',()=>fixed(()=>{
 const f=board('Rollout');f.cast();f.field.echoedVoice={turn:1,count:2};f.field.lastSuccessfulMove={turn:1,name:'Fusion Flare'};f.side.lastFaintTurn=1;
 const saved=codec.decode(codec.encode(f));assert.equal(resources.getForcedMove(saved.a),'Rollout');
 for(const key of ['turnActions','pursuitSwitching','trainerTeam'])Object.defineProperty(f.field,key,{get(){throw Error('Read private '+key);},configurable:true});
 const before=JSON.stringify([f.a,f.b]);const random=Math.random;Math.random=()=>{throw Error('AI consumed combat RNG');};
 try{const safe=ai.publicField(f.field);assert.deepEqual(safe.echoedVoice,{turn:1,count:2});assert.equal(safe.sides.player.lastFaintTurn,1);assert.equal(safe.pursuitSwitching,undefined);assert.equal(ai.publicPokemon(f.a).__battle.rollingHits,1);assert.deepEqual(ai.chooseAction({team:[f.a],opponentTeam:[f.b],field:f.field,ownSide:f.side,enemySide:f.otherSide,memory:{}}),{action:'attack',number:0});}
 finally{Math.random=random;}
 assert.equal(JSON.stringify([f.a,f.b]),before);
}));
function participant(userId,team,mode='rift') {return {userId,username:'Sequence '+userId,currentmap:'route2',run:{mode},equipe:{pokemons:team},items:{},money:0,drifts:[],equipped:[],defeated:new Set()};}
for(const mode of ['rift','colosseum','super-tournament'])for(const kind of ['manual','u-turn','baton-pass','ko','already-moved'])test(`${mode}: Pursuit ${kind} hits the right sprite, precedes withdrawal and is never repeated`,()=>fixed(()=>{
 const pursuer=mon(149,['Pursuit']),outgoing=mon(143,[kind==='u-turn'?'U-turn':kind==='baton-pass'?'Baton Pass':kind==='already-moved'?'Teleport':'Splash']),reserve=mon(25);
 pursuer.currentSpeed=1;outgoing.currentSpeed=999;if(kind==='ko')outgoing.currentHp=1;
 const a=participant(1,[pursuer],mode),b=participant(2,[outgoing,reserve],mode),events=[];
 const battle=new DriftBattle(a,b,{type:mode==='rift'?'pvp':'trainer',emit:(p,event,data)=>events.push({viewer:p.userId,event,data:structuredClone(data)}),paceMs:0,
  rules:{rewards:false,report:false,permanentDeaths:false},random:()=>.5});
 const power=kind==='already-moved'?40:80,damage=oracle(pursuer,outgoing,'Pursuit',power),before=outgoing.currentHp;
 assert(battle.action(a,{action:'attack',number:0,turnId:battle.token}));
 assert(battle.action(b,{action:kind==='manual'||kind==='ko'?'change':'attack',number:kind==='manual'||kind==='ko'?1:0,turnId:battle.token}));
 assert.equal(outgoing.currentHp,Math.max(0,before-damage));assert.equal(reserve.currentHp,10000);assert.equal(pursuer.movePp[0],19);
 if(battle.replacementPhase)assert(battle.action(b,{action:'change',number:1,turnId:battle.token}));
 const hits=events.filter(e=>e.viewer===1&&e.event==='battleMoveResult'&&e.data.moveName==='Pursuit');assert.equal(hits.length,1);
 assert.equal(battle.state.turn,2);assert.equal(battle.state.pursuitSwitching,undefined);
 if(kind!=='ko')assert.equal(b.equipe.pokemons[0].uuid,reserve.uuid);else assert.equal(outgoing.currentHp,0);
 battle.finished=true;require('../server/game/battle/battleOutcome').clearBattleTransientState(battle.originals);
}));
for(const mode of ['rift','colosseum','super-tournament'])test(`${mode}: rolling move locks its next action after restoring a checkpoint, then unlocks after five`,()=>fixed(()=>{
 const rolling=mon(149,['Rollout','Splash']),other=mon(143,['Splash']),a=participant(1,[rolling],mode),b=participant(2,[other],mode),events=[];
 let battle=new DriftBattle(a,b,{type:'trainer',emit:(p,event,data)=>events.push({event,data}),paceMs:0,rules:{rewards:false,report:false,permanentDeaths:false}});
 rolling.movePp[0]=1;battle.action(a,{action:'attack',number:0,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});
 const snapshot=codec.encode(battle);battle.finished=true;battle=codec.decode(snapshot);battle.emit=(p,event,data)=>events.push({event,data});battle.now=Date.now;battle.random=()=>.5;
 for(let turn=2;turn<=5;turn++){battle.tick();assert(battle.pending.has(battle.a));assert(battle.action(battle.b,{action:'attack',number:0,turnId:battle.token}));assert.equal(battle.active(0).movePp[0],0);}
 assert.equal(resources.getForcedMove(battle.active(0)),null);assert.equal(battle.state.turn,6);battle.finished=true;require('../server/game/battle/battleOutcome').clearBattleTransientState(battle.originals);
}));
for(const name of ['Rollout','Ice Ball','Fury Cutter','Echoed Voice','Retaliate','Fusion Bolt','Fling'])test(`AI ${name}: deterministic projection updates history/PP without changing its inputs`,()=>fixed(()=>{
 const f=board(name);if(name==='Fling')f.a.heldItem='oran_berry';
 if(name==='Rollout'||name==='Ice Ball')Object.assign(f.a.__battle,{rollingMove:name,rollingHits:2});
 if(name==='Fury Cutter'){f.field.turn=2;Object.assign(f.a.__battle,{furyCutterHits:1,furyCutterTurn:1});}
 if(name==='Echoed Voice'){f.field.turn=2;f.field.echoedVoice={turn:1,count:2};}
 if(name==='Retaliate'){f.field.turn=2;f.side.lastFaintTurn=1;}
 if(name==='Fusion Bolt')f.field.lastSuccessfulMove={turn:1,name:'Fusion Flare'};
 const a={...ai.publicPokemon(f.a),heldItem:f.a.heldItem,movePp:[...f.a.movePp],__battle:structuredClone(f.a.__battle)},b=ai.publicPokemon(f.b),before=JSON.stringify([a,b,f.field]);
 const damage=(p,q,m,s,state,extra={})=>{
  const own=model.copy(p),target=model.copy(q),special=m.combat.power_type==='special_case'?engine.getSpecialMoveResolution(m,own,target,{battleState:state}):null;
  if(special?.consumeHeldItem)own.heldItem=null;
  return engine.estimateDamage(own,target,special?.power?{...m,power:special.power}:m,{battleState:state,attackerSide:s===state.sides.enemy?state.sides.player:state.sides.enemy,defenderSide:s,...extra});
 };
 const old=Math.random;Math.random=()=>{throw Error('projection consumed live RNG');};let projection;
 try{projection=model.project(a,b,engine.getMoveByName(name),engine.getMoveByName('Splash'),{field:f.field,ownSide:f.side,enemySide:f.otherSide,chance:()=>1,damage});}finally{Math.random=old;}
 assert.equal(JSON.stringify([a,b,f.field]),before);const actual=f.cast();assert(actual.damage>0);
 assert.equal(projection.own.movePp[0],f.a.movePp[0]);assert.equal(resources.getForcedMove(projection.own),resources.getForcedMove(f.a));
 assert.equal(projection.field.lastSuccessfulMove.name,f.field.lastSuccessfulMove.name);
 if(name==='Fling')assert.equal(projection.field.berryEaters[0],f.b.uuid);
}));
for(const knockout of [false,true])test(`AI Pursuit models both sides' hypothetical withdrawal against the outgoing Pokémon, KO=${knockout}`,()=>{
 const f=board('Pursuit'),next=mon(25),outgoing=model.copy(f.b);if(knockout)outgoing.currentHp=1;
 const ctx={field:f.field,ownSide:f.side,enemySide:f.otherSide,chance:()=>1,damage:(p,q,m,s,state)=>engine.estimateDamage(p,q,m,{battleState:state,attackerSide:s===state.sides.enemy?state.sides.player:state.sides.enemy,defenderSide:s})};
 const before=JSON.stringify([f.a,f.b,next,outgoing,f.field]);
 const attacking=model.project(f.a,next,engine.getMoveByName('Pursuit'),null,ctx,{switched:true,foeOutgoing:outgoing});
 assert.equal(attacking.foe.uuid,knockout?outgoing.uuid:next.uuid);assert.equal(attacking.foe.currentHp,knockout?0:10000);assert(attacking.score>0);assert.equal(attacking.own.movePp[0],19);
 const leaving=model.project(next,f.a,null,engine.getMoveByName('Pursuit'),ctx,{first:false,ownSwitched:true,ownOutgoing:outgoing});
 assert.equal(leaving.own.uuid,knockout?outgoing.uuid:next.uuid);assert.equal(leaving.own.currentHp,knockout?0:10000);assert(leaving.score<0);
 assert.equal(JSON.stringify([f.a,f.b,next,outgoing,f.field]),before);
});
test('AI assesses sequence moves without live commands, opposing private items/PP/IV, RNG or input mutations',()=>{
 const f=board('Fury Cutter');f.a.abilities=['Fury Cutter','Echoed Voice','Retaliate','Pursuit'];f.a.movePp=[20,15,5,20];f.field.turn=2;Object.assign(f.a.__battle,{furyCutterTurn:1,furyCutterHits:1});f.field.echoedVoice={turn:1,count:2};f.side.lastFaintTurn=1;
 const own=JSON.stringify(f.a),foeHp=f.b.currentHp;
 for(const key of ['turnActions','pursuitSwitching','trainerTeam'])Object.defineProperty(f.field,key,{get(){throw Error('Private intent '+key);}});
 for(const key of ['heldItem','movePp','iv','ev'])Object.defineProperty(f.b,key,{get(){throw Error('Opposing private '+key);}});
 const original=Math.random;Math.random=()=>{throw Error('Combat RNG consumed');};
 try{const result=ai.analyse({team:[f.a],opponentTeam:[f.b],field:f.field,ownSide:f.side,enemySide:f.otherSide,memory:{}});assert(result.candidates.length);assert(result.candidates.every(c=>Number.isFinite(c.score)));}
 finally{Math.random=original;}
 assert.equal(JSON.stringify(f.a),own);assert.equal(f.b.currentHp,foeHp);
});
test('AI Fling preserves a berry behind Protect and never grants its effects through a substitute',()=>{
 for(const protection of ['protect','substitute']){
  const f=board('Fling');f.a.heldItem='oran_berry';f.b.currentHp=5000;if(protection==='substitute')f.b.__battle.substituteHp=1000;
  const ctx={field:f.field,ownSide:f.side,enemySide:f.otherSide,chance:()=>1,damage:(p,q,m,s,state)=>engine.estimateDamage({...p,heldItem:null},q,{...m,power:10},{battleState:state,defenderSide:s})};
  const projected=model.project(f.a,f.b,engine.getMoveByName('Fling'),engine.getMoveByName(protection==='protect'?'Protect':'Splash'),ctx,{first:protection!=='protect'});
  assert.equal(projected.own.heldItem,protection==='protect'?'oran_berry':null);assert.equal(projected.foe.currentHp,5000);assert(!projected.field.berryEaters?.includes(f.b.uuid));
 }
});

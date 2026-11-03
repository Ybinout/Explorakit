const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const resources=require('../server/game/battle/battleResources'),codec=require('../server/game/drift/checkpointCodec');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const {emitDelayedMoveEvents}=require('../server/game/battle/battleEvents');
function mon(id=143,moves=['Splash']){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=2000;p.abilities=[];p.movePp=[];for(const name of moves)p.addAbility(name);engine.ensureBattleData(p);return p;}
function fixed(work,value=.5){const old=Math.random;Math.random=()=>value;try{return work();}finally{Math.random=old;}}
function hit(name,a,b,f,reverse=false){return engine.useattack(name,a,b,{battleState:f,attackerSide:reverse?f.sides.enemy:f.sides.player,defenderSide:reverse?f.sides.player:f.sides.enemy});}
function end(a,b,f){return engine.processEndOfRound(a,b,f.sides.player,f.sides.enemy,f);}

test('False Swipe deals ordinary damage and cannot KO, even on a critical hit with offensive boosts',()=>fixed(()=>{
 const a=mon(212,['False Swipe']),b=mon(),f=engine.createBattleState();
 const weak=hit('False Swipe',a,b,f);assert(weak.damage>0&&b.currentHp>1,'Not a forced reduction to 1 HP');
 a.currentAttack=9999;a.heldItem='choice_band';a.passiveAbility='Technician';a.__battle.laserFocusTurns=2;b.currentHp=70;
 const strong=hit('False Swipe',a,b,f);assert(strong.critical);assert.equal(strong.damage,69);assert.equal(b.currentHp,1);
 const pp=a.movePp[0],again=hit('False Swipe',a,b,f);assert.equal(again.damage,0);assert.equal(b.currentHp,1);assert.equal(a.movePp[0],pp-1);
}));
test('False Swipe breaks substitutes at full power without consuming survival gear, and respects immunity/protection',()=>fixed(()=>{
 const a=mon(212,['False Swipe']),b=mon(),f=engine.createBattleState();a.currentAttack=9999;b.currentHp=1;b.__battle.substituteHp=5;
 const clone=hit('False Swipe',a,b,f);assert.equal(clone.substituteDamage,5);assert.equal(b.currentHp,1);assert.equal(b.__battle.substituteHp,0);
 b.currentHp=b.maxHp=10;b.heldItem='focus_sash';hit('False Swipe',a,b,f);assert.equal(b.currentHp,1);assert.equal(b.heldItem,'focus_sash');
 b.currentHp=10;b.__battle.protect=true;assert(hit('False Swipe',a,b,f).blocked);assert.equal(b.currentHp,10);
 const ghost=mon(94);assert.equal(hit('False Swipe',a,ghost,f).damage,0);assert.equal(ghost.currentHp,2000);
 b.__battle.protect=false;b.currentHp=1;b.status='poison';end(a,b,f);assert.equal(b.currentHp,0,'The move is non-lethal, not a poison shield');
}));
for(const name of ['Future Sight','Doom Desire'])test(name+' hits only at end of turn 3, costs one PP and does not lock the caster',()=>fixed(()=>{
 const a=mon(65,[name,'Tackle']),b=mon(),f=engine.createBattleState(),hp=b.currentHp,pp=a.movePp[0];
 const cast=hit(name,a,b,f);assert(cast.success);assert.equal(cast.phase,'prepare');assert.equal(cast.damage,0);assert.equal(b.currentHp,hp);assert.equal(a.movePp[0],pp-1);assert.equal(resources.getForcedMove(a),null);
 assert.equal(end(a,b,f).delayedAttacks.length,0);assert.equal(b.currentHp,hp);
 const ordinary=hit('Tackle',a,b,f);assert(ordinary.damage>0);const afterTackle=b.currentHp;end(a,b,f);assert.equal(b.currentHp,afterTackle);
 const delayed=end(a,b,f);assert.equal(delayed.delayedAttacks.length,1);assert(delayed.delayedAttacks[0].result.damage>0);assert(b.currentHp<afterTackle);assert.equal(a.movePp[0],pp-1);assert.equal(f.sides.enemy.futureMove,null);
 const after=b.currentHp;end(a,b,f);assert.equal(b.currentHp,after);
}));
test('Future Sight and Doom Desire share one opposing slot; a failed repeat spends PP without replacing the pending attack',()=>fixed(()=>{
 const a=mon(65,['Future Sight','Doom Desire']),b=mon(65,['Future Sight']),f=engine.createBattleState();
 hit('Future Sight',a,b,f);const pending=f.sides.enemy.futureMove,pp=a.movePp[1];assert(hit('Doom Desire',a,b,f).blocked);assert.equal(a.movePp[1],pp-1);assert.equal(f.sides.enemy.futureMove,pending);
 assert(hit('Future Sight',b,a,f,true).success);assert(f.sides.player.futureMove);end(a,b,f);end(a,b,f);assert.equal(end(a,b,f).delayedAttacks.length,2);
 assert(hit('Doom Desire',a,b,f).success);
}));
test('the future attack follows the opposing position after switches and survives a fainted caster',()=>fixed(()=>{
 const a=mon(65,['Future Sight']),b=mon(),reserve=mon(9),ally=mon(3),f=engine.createBattleState();
 hit('Future Sight',a,b,f);end(a,b,f);const party={pokemons:[b,reserve]},own={pokemons:[a,ally]};switchPokemonByIndex(party,1);switchPokemonByIndex(own,1);a.currentHp=0;
 end(ally,reserve,f);const messages=end(ally,reserve,f);assert(reserve.currentHp<2000);assert.equal(b.currentHp,2000);assert.equal(messages.delayedAttacks[0].source.uuid,a.uuid);assert.equal(messages.delayedAttacks[0].target.uuid,reserve.uuid);
}));
test('future attacks can be prepared against Dark types, bypass Protect on impact, but retain impact-time immunity and substitutes',()=>fixed(()=>{
 for(const targetKind of ['dark','protect','clone','dig']){
  const a=mon(65,['Future Sight']),b=mon(197),f=engine.createBattleState();assert(hit('Future Sight',a,b,f).success);end(a,b,f);const target=targetKind==='dark'?b:mon();end(a,target,f);
  if(targetKind==='protect')target.__battle.protect=true;if(targetKind==='clone')target.__battle.substituteHp=999;if(targetKind==='dig')target.__battle.semiInvulnerable='underground';
  const impact=end(a,target,f).delayedAttacks[0].result;
  if(targetKind==='protect')assert(impact.damage>0);else assert.equal(target.currentHp,2000);
  if(targetKind==='dark')assert.equal(impact.effectiveness,0);if(targetKind==='clone')assert(impact.substituteDamage>0);if(targetKind==='dig')assert(impact.missed);
 }
}));
test('damage uses current active stats, natural off-field stats, and Life Orb recoil happens only when an active caster hits',()=>fixed(()=>{
 const losses=[];
 for(const active of [false,true]){
  const a=mon(65,['Future Sight']),ally=mon(),b=mon(),f=engine.createBattleState();a.heldItem='life_orb';a.__battle.statStages.specialAttack=4;hit('Future Sight',a,b,f);assert.equal(a.currentHp,2000);end(a,b,f);end(active?a:ally,b,f);const impact=end(active?a:ally,b,f).delayedAttacks[0].result;losses.push(impact.damage);assert.equal(a.currentHp,active?1800:2000);assert.equal(a.heldItem,'life_orb');
 }assert(losses[1]>losses[0]*2);
}));
test('checkpoint preserves the source reference and due turn, with one impact after restore and no extra PP cost',()=>fixed(()=>{
 const a=mon(65,['Future Sight']),b=mon(),f=engine.createBattleState();hit('Future Sight',a,b,f);end(a,b,f);
 const saved=codec.decode(codec.encode({a,b,f}));assert.equal(saved.f.sides.enemy.futureMove.source,saved.a);end(saved.a,saved.b,saved.f);assert.equal(saved.b.currentHp,2000);assert.equal(end(saved.a,saved.b,saved.f).delayedAttacks.length,1);assert.equal(saved.a.movePp[0],9);assert.equal(end(saved.a,saved.b,saved.f).delayedAttacks.length,0);
}));
test('delayed animation/results are emitted at impact, on the correct side, without exposing caster records',()=>fixed(()=>{
 const a=mon(65,['Future Sight']),b=mon(),f=engine.createBattleState();hit('Future Sight',a,b,f);let events=[];emitDelayedMoveEvents(end(a,b,f),(event,data)=>events.push({event,data}),f.sides.player);assert.equal(events.length,0);end(a,b,f);
 const messages=end(a,b,f);for(const [side,actor]of [[f.sides.player,'player'],[f.sides.enemy,'opponent']]){events=[];emitDelayedMoveEvents(messages,(event,data)=>events.push({event,data}),side);assert.equal(events.length,2);assert(events.every(e=>e.data.actor===actor));assert.equal(events[0].data.phase,'strike');assert(events[1].data.damage>0);assert(!JSON.stringify(events).includes(a.uuid));}
}));
for(const mode of ['rift','colosseum'])test(mode+': real battle keeps False Swipe non-lethal and resolves future attacks exactly once on turn 3',()=>fixed(()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle');
 for(const move of ['False Swipe','Future Sight','Doom Desire']){
  const hero=mon(65,[move,'Splash']),foe=mon(),events=[];foe.currentHp=1;
  const a={userId:1,socketId:'future-a',currentmap:'route1',run:{mode},equipe:{pokemons:[hero]},drifts:[],equipped:[],items:{}},b={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};
  const battle=new DriftBattle(a,b,{type:'arena',emit:(_p,event,data)=>events.push({event,data:structuredClone(data)}),paceMs:0,random:()=>.5,rules:{rewards:false,report:false,permanentDeaths:false}});
  assert(battle.action(a,{action:'attack',number:0,turnId:battle.token}));assert.equal(foe.currentHp,1);
  if(move!=='False Swipe'){
   for(let round=2;round<=3;round++){battle.tick();assert(battle.action(a,{action:'attack',number:1,turnId:battle.token}));assert.equal(foe.currentHp,round===2?1:0);}
   assert(battle.finished);assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName===move&&e.data.phase==='strike').length,1);
  }else assert(!battle.finished);
  battle.finish(null,'closed');
 }
}));
test('AI projects delayed damage without an immediate KO, does not spam a pending future attack and reads no human intention',()=>fixed(()=>{
 const ai=require('../server/game/battle/humanTrainerAI'),model=require('../server/game/battle/humanTrainerModel');
 const a=mon(65,['Future Sight','Psychic']),b=mon(),f=engine.createBattleState();
 const context=field=>({field,ownSide:field.sides.player,enemySide:field.sides.enemy,party:[a],damage:(s,t,m,side,state)=>engine.estimateDamage(s,t,m,{battleState:state,defenderSide:side}),chance:()=>1});
 let p=model.project(a,b,engine.getMoveByName('Future Sight'),null,context(f));assert.equal(p.foe.currentHp,2000);assert(p.field.sides.enemy.futureMove);assert.equal(p.own.movePp[0],9);
 p=model.project(p.own,p.foe,null,null,context(p.field));assert.equal(p.foe.currentHp,2000);p=model.project(p.own,p.foe,null,null,context(p.field));assert(p.foe.currentHp<2000);
 hit('Future Sight',a,b,f);const before=codec.encode(f);const o={team:[a],opponentTeam:[b],field:f,ownSide:f.sides.player,enemySide:f.sides.enemy,round:1,skill:1};Object.defineProperty(f,'turnActions',{get(){throw Error('Read a human command');},configurable:true});
 assert.equal(ai.chooseAction(o).number,1);delete f.turnActions;assert(before.equals(codec.encode(f)));
 const view=ai.publicField(f);assert.equal(view.sides.enemy.futureMove.source.heldItem,undefined);
 const blade=mon(212,['False Swipe']),clone=mon();blade.currentAttack=9999;clone.currentHp=1;clone.__battle.substituteHp=5;const empty=engine.createBattleState();
 const forecast=model.project(blade,clone,engine.getMoveByName('False Swipe'),null,context(empty));assert.equal(forecast.foe.currentHp,1);assert.equal(forecast.foe.__battle.substituteHp,0);
}));

const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),{DriftBattle}=require('../server/game/drift/driftBattle');
const codec=require('../server/game/drift/checkpointCodec'),{resolveMoveSwitches,canChooseMoveSwitch}=require('../server/game/battle/battleTeam');
const moves=['U-turn','Volt Switch','Parting Shot','Baton Pass'];
function mon(id=143,move='Splash'){const p=factory.create(id,30,true);p.passiveAbility=null;p.heldItem=null;p.abilities=[move];p.movePp=[engine.getMoveByName(move).pp];p.maxHp=p.currentHp=500;return p;}
function fixture(type='trainer',move='U-turn'){
 const lead=mon(25,move),unused=mon(7),chosen=mon(4),dead=mon(19),enemy=mon(143);lead.currentSpeed=999;enemy.currentSpeed=1;dead.currentHp=0;
 const a={userId:1,socketId:'owner',alive:true,currentmap:type==='arena'?'super_tournament_room':'route1',run:{mode:'colosseum'},equipe:{pokemons:[lead,unused,chosen,dead]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()},b={userId:2,npc:type!=='pvp',alive:true,equipe:{pokemons:[enemy]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()},events=[];let time=0;
 const battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>events.push({id:p.userId,event,data:structuredClone(data)}),now:()=>time,random:()=>.5,paceMs:0,rules:{rewards:false,report:false,permanentDeaths:false}});battle.pending.set(b,{action:'attack',number:0});
 return{a,b,battle,events,lead,unused,chosen,dead,enemy,advance(){time+=60001;battle.tick();}};
}
for(const move of moves)test(`${move}: the result requires an explicit reserve, with no first-reserve fallback`,()=>{
 const a=mon(25,move),b=mon(),team=[a,mon(7),mon(4)],state=engine.createBattleState({battleType:'trainer'}),result=engine.useattack(move,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:team,defenderTeam:[b]});
 assert(result.switchSelf&&result.chooseSwitch);assert(canChooseMoveSwitch(result,team,[b]));assert.equal(resolveMoveSwitches(result,team,[b]).attacker,null);assert.equal(team[0],a);const chosen=team[2];assert.equal(resolveMoveSwitches(result,team,[b],{attackerIndex:2}).attacker.incoming,chosen);
});
for(const type of['wild','trainer','arena','pvp'])for(const move of moves)test(`${type}/${move}: owner chooses reserve 2 before the remaining action and the turn resumes once`,()=>{
 const f=fixture(type,move),oldToken=f.battle.token;assert(f.battle.action(f.a,{action:'attack',number:0,turnId:oldToken}));assert(f.battle.replacementPhase&&!f.battle.finished);assert.equal(f.battle.active(0),f.lead);assert.equal(f.enemy.movePp[0],40);assert.equal(f.lead.movePp[0],engine.getMoveByName(move).pp-1);
 const prompt=f.events.filter(e=>e.id===1&&e.event==='requestAction'&&e.data.replacement).at(-1).data;assert.deepEqual(prompt.allowedPokemonIndexes,[1,2]);assert.equal(f.battle.state.turn,1);
 for(const payload of[{action:'attack',number:0},{action:'change',number:0},{action:'change',number:3},{action:'change',number:99}])assert.equal(f.battle.action(f.a,{...payload,turnId:f.battle.token}),false);assert.equal(f.battle.action(f.a,{action:'change',number:2,turnId:oldToken}),false);
 assert(f.battle.action(f.a,{action:'change',number:2,turnId:f.battle.token}));assert.equal(f.battle.active(0),f.chosen);assert(f.a.equipe.pokemons.includes(f.lead));assert.equal(f.chosen.movePp[0],40);assert.equal(f.enemy.movePp[0],39);assert.equal(f.battle.state.turn,2);assert(!f.battle.replacementPhase);assert.equal(f.events.filter(e=>e.id===1&&e.event==='battleMoveAnimation'&&e.data.moveName===move).length,1);f.battle.finish(null,'closed');
});
for(const move of moves)test(`${move}: checkpoint/reconnect retains the choice and Baton Pass transfers only its allowed effects`,()=>{
 const f=fixture('arena',move);engine.ensureBattleData(f.lead).statStages.attack=2;f.lead.__battle.statStages.speed=1;f.lead.__battle.substituteHp=22;f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});
 const restored=codec.decode(codec.encode(f.battle)),events=[];restored.emit=(p,event,data)=>events.push({id:p.userId,event,data});restored.random=()=>.5;restored.now=()=>0;for(const p of[restored.a,restored.b])require('../server/game/drift/driftEffects').attach(p.equipe.pokemons,p,true,()=>.5);restored.resume(restored.a);assert(events.some(e=>e.event==='requestAction'&&e.data.replacement));
 const chosen=restored.a.equipe.pokemons[2];restored.action(restored.a,{action:'change',number:2,turnId:restored.token});assert.equal(restored.active(0),chosen);assert.equal(chosen.__battle.statStages.attack,move==='Baton Pass'?2:0);assert.equal(chosen.__battle.substituteHp,move==='Baton Pass'?22:0);assert.equal(restored.state.turn,2);assert.equal(restored.pivotSwitch,undefined);assert.equal(restored.turnContinuation,undefined);restored.finish(null,'closed');f.battle.finish(null,'closed');
});
test('a pivot without a living reserve or after the last enemy KO does not open an unusable choice',()=>{
 for(const lastEnemy of[false,true]){const f=fixture();if(lastEnemy)f.enemy.currentHp=1;else f.a.equipe.pokemons=[f.lead,f.dead];f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});assert(!f.events.some(e=>e.event==='requestAction'&&e.data.replacement));assert(!f.battle.replacementPhase);assert.equal(f.battle.active(0),f.lead);assert.equal(f.battle.state.turn,2);if(lastEnemy)assert(f.battle.finished);else f.battle.finish(null,'closed');}
});
test('Volt Switch into Ground, a protected U-turn and a missed Parting Shot never ask for a reserve',()=>{
 for(const condition of['ground','protect','miss']){const move=condition==='ground'?'Volt Switch':condition==='protect'?'U-turn':'Parting Shot',p=mon(25,move),q=mon(),team=[p,mon(7)],s=engine.createBattleState({battleType:'trainer'});if(condition==='ground'){q.type1='Ground';q.type2=null;}if(condition==='protect')engine.ensureBattleData(q).protect=true;if(condition==='miss')engine.ensureBattleData(p).statStages.accuracy=-6;
  const random=Math.random;Math.random=()=>.9;try{const result=engine.useattack(move,p,q,{battleState:s,attackerSide:s.sides.player,defenderSide:s.sides.enemy,attackerTeam:team,defenderTeam:[q]});assert(!canChooseMoveSwitch(result,team,[q]),condition);assert(!result.switchSelf,condition);}finally{Math.random=random;}
 }
});
test('a pivot against Substitute still asks; forced Roar remains an imposed switch',()=>{
 const f=fixture();engine.ensureBattleData(f.enemy).substituteHp=200;f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});assert(f.battle.replacementPhase);assert.equal(f.enemy.currentHp,500);f.battle.action(f.a,{action:'change',number:2,turnId:f.battle.token});assert.equal(f.battle.active(0),f.chosen);f.battle.finish(null,'closed');
 const p=mon(25,'Roar'),q=mon(),replacement=mon(4),s=engine.createBattleState(),r=engine.useattack('Roar',p,q,{battleState:s,attackerTeam:[p],defenderTeam:[q,replacement]});assert(r.forceSwitch&&!r.chooseSwitch);assert.equal(resolveMoveSwitches(r,[p],[q,replacement]).defender.incoming,replacement);
});
test('slow pivots consume the enemy action before asking, and a KO on entry asks again without replaying the move',()=>{
 const f=fixture('arena','U-turn');f.lead.currentSpeed=1;f.enemy.currentSpeed=999;f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});assert.equal(f.enemy.movePp[0],39);f.chosen.currentHp=1;f.battle.sides[0].hazards.stealthRock=true;
 f.battle.action(f.a,{action:'change',number:2,turnId:f.battle.token});assert.equal(f.chosen.currentHp,0);assert.equal(f.battle.state.turn,2);f.battle.tick();assert(f.battle.replacementPhase);const pp=f.lead.movePp[0];f.battle.action(f.a,{action:'change',number:1,turnId:f.battle.token});assert.equal(f.lead.movePp[0],pp);assert.equal(f.enemy.movePp[0],39);assert.equal(f.battle.state.turn,2);f.battle.finish(null,'closed');
});
test('NPC pivots choose their own reserve without opening the owner selection panel',()=>{
 const f=fixture(),npc=f.enemy,reserve=mon(7);f.lead.abilities=['Splash'];f.lead.movePp=[40];npc.abilities=['U-turn'];npc.movePp=[20];f.b.equipe.pokemons.push(reserve);f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});assert.equal(f.battle.active(1),reserve);assert(!f.events.some(e=>e.event==='requestAction'&&e.data.replacement));assert(f.b.equipe.pokemons.includes(npc));f.battle.finish(null,'closed');
});
test('two PvP pivots in one turn ask each owner once without sharing the Relais state',()=>{
 const f=fixture('pvp','Baton Pass');f.enemy.abilities=['U-turn'];f.enemy.movePp=[20];engine.ensureBattleData(f.lead).statStages.attack=2;
 const enemyReserve=mon(143);f.b.equipe.pokemons.push(enemyReserve);
 assert(f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token}));assert.equal(f.battle.pivotSwitch.index,0);
 assert(f.battle.action(f.a,{action:'change',number:2,turnId:f.battle.token}));assert.equal(f.battle.active(0),f.chosen);assert.equal(f.chosen.__battle.statStages.attack,2);assert(f.battle.replacementPhase);assert.equal(f.battle.pivotSwitch.index,1);assert.equal(f.battle.pivotSwitch.batonPass,false);assert.equal(f.enemy.movePp[0],19);
 assert(f.battle.action(f.b,{action:'change',number:1,turnId:f.battle.token}));assert.equal(f.battle.active(1),enemyReserve);assert.equal(enemyReserve.__battle.statStages.attack,0);assert.equal(f.battle.state.turn,2);assert.equal(f.battle.pivotSwitch,undefined);assert.equal(f.battle.turnContinuation,undefined);assert.equal(f.events.filter(e=>e.event==='requestAction'&&e.data.replacement).length,2);f.battle.finish(null,'closed');
});

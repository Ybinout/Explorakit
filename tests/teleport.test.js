const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const codec=require('../server/game/drift/checkpointCodec');
const {resolveMoveSwitches}=require('../server/game/battle/battleTeam');
function mon(id,move){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];p.addAbility(move);return p;}
function pivotFixture(type='arena',foeMove='Splash'){
 const a={socketId:'owner',userId:1,alive:true,currentmap:'ville1_shop',run:{mode:'colosseum',phase:'exploration'},money:1000,items:{},equipe:{pokemons:[mon(63,'Teleport'),mon(7,'Splash'),mon(4,'Splash')]},drifts:[],equipped:[],defeated:new Set()};
 const b={userId:2,npc:type!=='pvp',money:0,items:{},alive:true,defeated:new Set(),equipe:{pokemons:[mon(63,foeMove),mon(19,'Splash')]},drifts:[],equipped:[]},events=[];
 let time=0;
 const battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>events.push({id:p.userId,event,data:structuredClone(data)}),random:()=>.9,now:()=>time,paceMs:0});
 battle.pending.set(b,{action:'attack',number:0});
 return {a,b,battle,events,advance:()=>{time+=60001;battle.tick();}};
}

test('modern Teleport has priority -6, requires a living reserve and bypasses trapping for a pivot',()=>{
 assert.equal(engine.getMoveByName('Teleport').combat.priority,-6);
 const a=mon(63,'Teleport'),b=mon(19,'Splash'),reserve=mon(7,'Splash'),state=engine.createBattleState({battleType:'trainer'});
 b.passiveAbility='Shadow Tag';
 assert.equal(engine.orderBattleActions([{pokemon:a,moveName:'Teleport'},{pokemon:b,moveName:'Splash'}],state)[0].pokemon,b);
 assert.equal(engine.useattack('Teleport',a,b,{battleState:state,attackerTeam:[a,{...reserve,currentHp:0}]}).success,false);
 a.__battle.statStages={speed:2};
 const result=engine.useattack('Teleport',a,b,{battleState:state,attackerTeam:[a,reserve]});
 assert(result.chooseSwitch&&!result.escape);
 const team=[a,reserve];assert.equal(resolveMoveSwitches(result,team,[b]).attacker,null,'never auto-select a human reserve');
 assert(resolveMoveSwitches(result,team,[b],{attackerIndex:1}).attacker);
 assert.equal(team[0],reserve);assert(!reserve.__battle?.statStages?.speed,'not Baton Pass');assert(!a.__battle);
});
for(const type of['trainer','arena','pvp'])test(`${type}: Teleport waits for the chosen live teammate, retains the outgoing Pokémon and resumes the same turn`,()=>{
 const {a,b,battle,events}=pivotFixture(type),out=a.equipe.pokemons[0],chosen=a.equipe.pokemons[2],round=battle.round;
 const oldToken=battle.token;
 assert(battle.action(a,{action:'attack',number:0,turnId:oldToken}));
 assert(battle.replacementPhase&&!battle.finished);assert.equal(battle.active(0),out);assert.equal(b.equipe.pokemons[0].movePp[0],39);
 assert.equal(out.movePp[0],19);assert(events.some(e=>e.event==='requestAction'&&e.data.replacement&&e.id===1));
 assert(!battle.action(a,{action:'change',number:2,turnId:oldToken}));
 assert(!battle.action(a,{action:'change',number:0,turnId:battle.token}));
 assert(battle.action(a,{action:'change',number:2,turnId:battle.token}));
 assert.equal(battle.active(0),chosen);assert(a.equipe.pokemons.includes(out));assert.equal(chosen.movePp[0],40);assert.equal(battle.round,round);assert.equal(battle.state.turn,2);
 assert(!events.some(e=>e.event==='endbattle'));battle.finish(null,'closed');
});
test('Teleport choice survives checkpoint/reconnect; the slower Trick Room executes after the chosen entrant, once',()=>{
 const {a,battle}=pivotFixture('arena','Trick Room');battle.action(a,{action:'attack',number:0,turnId:battle.token});
 assert(battle.replacementPhase);assert.equal(battle.state.field.trickRoomTurns,0);
 const restored=codec.decode(codec.encode(battle)),events=[];
 restored.emit=(p,event,data)=>events.push({event,data});restored.random=()=>.9;restored.now=()=>0;
 for(const p of[restored.a,restored.b])require('../server/game/drift/driftEffects').attach(p.equipe.pokemons,p,true,()=>.9);
 restored.resume(restored.a);assert(events.some(e=>e.event==='requestAction'&&e.data.replacement));
 const chosen=restored.a.equipe.pokemons[2];restored.action(restored.a,{action:'change',number:2,turnId:restored.token});
 assert.equal(restored.active(0),chosen);assert.equal(restored.b.equipe.pokemons[0].movePp[0],4);assert.equal(restored.state.field.trickRoomTurns,4);assert.equal(restored.state.turn,2);
 assert.equal(events.filter(e=>e.event==='battleMoveAnimation'&&e.data.moveName==='Trick Room').length,1);
 restored.finish(null,'closed');battle.finish(null,'closed');
});
test('Teleport timeout chooses a reserve; entry hazard KO asks again without replaying the move or losing the outgoing member',()=>{
 const f=pivotFixture(),out=f.a.equipe.pokemons[0];f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});
 f.a.equipe.pokemons[1].currentHp=1;f.battle.sides[0].hazards.stealthRock=true;
 f.advance();assert(f.battle.replacementPhase);assert(f.a.equipe.pokemons.includes(out));
 const prompt=f.events.filter(e=>e.event==='requestAction'&&e.data.replacement).at(-1).data;
 const idx=prompt.allowedPokemonIndexes.find(i=>f.a.equipe.pokemons[i]!==out);assert(Number.isInteger(idx));
 f.battle.action(f.a,{action:'change',number:idx,turnId:f.battle.token});
 assert(!f.battle.replacementPhase);assert.equal(out.movePp[0],19);assert.equal(f.battle.state.turn,2);f.battle.finish(null,'closed');
});
test('being knocked out before priority -6 prevents Teleport and its replacement prompt',()=>{
 const f=pivotFixture('arena','Dragon Rage');f.a.equipe.pokemons[0].currentHp=1;
 f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});
 assert(!f.battle.turnContinuation);assert(!f.events.some(e=>e.event==='battleMoveAnimation'&&e.data.moveName==='Teleport'));
 assert(!f.battle.replacementPhase);f.battle.finish(null,'closed');
});
test('NPC Teleport selects its own living reserve, without requesting a human choice or ending the encounter',()=>{
 const f=pivotFixture(),old=f.b.equipe.pokemons[0],chosen=f.b.equipe.pokemons[1];
 f.a.equipe.pokemons[0].abilities=['Splash'];f.a.equipe.pokemons[0].movePp=[40];old.abilities=['Teleport'];old.movePp=[20];
 f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});
 assert.equal(f.battle.active(1),chosen);assert(f.b.equipe.pokemons.includes(old));assert.equal(old.movePp[0],19);
 assert(!f.battle.finished&&!f.battle.replacementPhase);assert(!f.events.some(e=>e.event==='requestAction'&&e.data.replacement));f.battle.finish(null,'closed');
});
test('two PvP Teleports collect successive choices and neither incoming Pokémon attacks for its predecessor',()=>{
 const f=pivotFixture('pvp','Teleport');f.a.equipe.pokemons[0].currentSpeed=999;f.b.equipe.pokemons[0].currentSpeed=1;
 f.battle.action(f.a,{action:'attack',number:0,turnId:f.battle.token});
 assert.deepEqual([...f.battle.replacementPlayers],[f.a]);const first=f.a.equipe.pokemons[2];
 f.battle.action(f.a,{action:'change',number:2,turnId:f.battle.token});
 assert.deepEqual([...f.battle.replacementPlayers],[f.b]);const second=f.b.equipe.pokemons[1];
 f.battle.action(f.b,{action:'change',number:1,turnId:f.battle.token});
 assert.equal(f.battle.active(0),first);assert.equal(f.battle.active(1),second);assert.equal(first.movePp[0],40);assert.equal(second.movePp[0],40);assert.equal(f.battle.state.turn,2);f.battle.finish(null,'closed');
});
test('Teleport escapes wild battles, chooses a reserve in trainer/arena/PvP, and fails without a supported battle context',()=>{
 for(const battleType of['wild','trainer','arena','pvp',undefined]){
  const a=mon(63,'Teleport'),b=mon(19,'Splash'),state=engine.createBattleState({battleType});
  const hp=[a.currentHp,b.currentHp],result=engine.useattack('Teleport',a,b,{battleState:state,attackerTeam:[a,mon(7,'Splash')]});
  assert.equal(Boolean(result.escape),battleType==='wild');assert.equal(result.success,battleType!==undefined);assert.equal(Boolean(result.chooseSwitch),['trainer','arena','pvp'].includes(battleType));assert.equal(a.movePp[0],19);assert.deepEqual([a.currentHp,b.currentHp],hp);
 }
});
test('sleep, flinch and trapping prevent Teleport; a Ghost retains the existing ability to escape a trap',()=>{
 for(const condition of['sleep','flinch','trap','ghost']){
  const a=mon(63,'Teleport'),b=mon(19,'Splash'),state=engine.createBattleState({battleType:'wild'});
  if(condition==='sleep'){a.status='sleep';a.__battle={sleepTurns:2};}
  if(condition==='flinch')a.__battle={flinch:true};
  if(['trap','ghost'].includes(condition)){b.passiveAbility='Arena Trap';if(condition==='ghost'){a.type1='Ghost';a.type2=null;}}
  const result=engine.useattack('Teleport',a,b,{battleState:state});assert.equal(Boolean(result.escape),condition==='ghost',condition);
 }
});
for(const mode of['rift','colosseum'])for(const who of['player','opponent'])test(`${mode}: ${who} Teleport ends the wild turn immediately without rewards or a defeat`,()=>{
 const a={socketId:'owner',userId:1,alive:true,currentmap:'route1',run:{mode,phase:'exploration'},money:1000,items:{},equipe:{pokemons:[mon(63,who==='player'?'Teleport':'Splash')]},drifts:[],equipped:[],defeated:new Set()};
 const b={npc:true,equipe:{pokemons:[mon(63,who==='opponent'?'Teleport':'Splash')]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(a,b,{emit:(_p,event,data)=>events.push({event,data}),random:()=>.5,paceMs:0});
 delete battle.state.battleType; // Existing checkpoints predate this metadata.
 const first=who==='player'?a.equipe.pokemons[0]:b.equipe.pokemons[0],second=who==='player'?b.equipe.pokemons[0]:a.equipe.pokemons[0];first.currentSpeed=999;second.currentSpeed=1;
 const hp=[first.currentHp,second.currentHp],xp=a.equipe.pokemons[0].experience;
 battle.action(a,{action:'attack',number:0,turnId:battle.token});assert(battle.finished);assert.equal(second.movePp[0],39,'priority -6 lets Splash execute before the escape');assert.equal(a.money,1000);assert.deepEqual(a.items,{});assert.equal(a.equipe.pokemons[0].experience,xp);assert.deepEqual([first.currentHp,second.currentHp],hp);
 const result=events.filter(e=>e.event==='endbattle');assert.equal(result.length,1);assert.equal(result[0].data.escapeActor,who);assert.equal(result[0].data.reason,'fled');assert.equal(result[0].data.summary.outcome,'fled');assert.equal(result[0].data.summary.money,0);assert.deepEqual(result[0].data.summary.loot,[]);assert.deepEqual(result[0].data.summary.experience,[]);assert.equal(battle.state.turn,1);
});
for(const type of['trainer','arena'])test(`${type}: an NPC Teleport cannot abort an expedition fight`,()=>{
 const a={socketId:'owner',userId:1,alive:true,currentmap:'route1',run:{mode:'colosseum',phase:'exploration'},money:1000,items:{},equipe:{pokemons:[mon(19,'Splash')]},drifts:[],equipped:[],defeated:new Set()};
 const b={npc:true,equipe:{pokemons:[mon(63,'Teleport')]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(a,b,{type,emit:(_p,event,data)=>events.push({event,data}),random:()=>.5,paceMs:0});battle.action(a,{action:'attack',number:0,turnId:battle.token});assert(!battle.finished);assert(!events.some(e=>e.event==='endbattle'));assert.equal(b.equipe.pokemons[0].movePp[0],19);assert(events.some(e=>e.event==='battleText'&&e.data.message.includes('Téléport échoue')));battle.finish(null,'closed');
});

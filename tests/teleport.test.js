const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
function mon(id,move){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];p.addAbility(move);return p;}
test('Teleport requests escape only in a wild battle; trainer, arena, PvP and unspecified contexts fail and still spend PP',()=>{
 for(const battleType of['wild','trainer','arena','pvp',undefined]){
  const a=mon(63,'Teleport'),b=mon(19,'Splash'),state=engine.createBattleState({battleType});
  const hp=[a.currentHp,b.currentHp],result=engine.useattack('Teleport',a,b,{battleState:state});
  assert.equal(Boolean(result.escape),battleType==='wild');assert.equal(result.success,battleType==='wild');assert.equal(a.movePp[0],19);assert.deepEqual([a.currentHp,b.currentHp],hp);
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
 battle.action(a,{action:'attack',number:0,turnId:battle.token});assert(battle.finished);assert.equal(second.movePp[0],40,'later Splash must not execute');assert.equal(a.money,1000);assert.deepEqual(a.items,{});assert.equal(a.equipe.pokemons[0].experience,xp);assert.deepEqual([first.currentHp,second.currentHp],hp);
 const result=events.filter(e=>e.event==='endbattle');assert.equal(result.length,1);assert.equal(result[0].data.escapeActor,who);assert.equal(result[0].data.reason,'fled');assert.equal(result[0].data.summary.outcome,'fled');assert.equal(result[0].data.summary.money,0);assert.deepEqual(result[0].data.summary.loot,[]);assert.deepEqual(result[0].data.summary.experience,[]);assert.equal(battle.state.turn,1);
});
for(const type of['trainer','arena'])test(`${type}: an NPC Teleport cannot abort an expedition fight`,()=>{
 const a={socketId:'owner',userId:1,alive:true,currentmap:'route1',run:{mode:'colosseum',phase:'exploration'},money:1000,items:{},equipe:{pokemons:[mon(19,'Splash')]},drifts:[],equipped:[],defeated:new Set()};
 const b={npc:true,equipe:{pokemons:[mon(63,'Teleport')]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(a,b,{type,emit:(_p,event,data)=>events.push({event,data}),random:()=>.5,paceMs:0});battle.action(a,{action:'attack',number:0,turnId:battle.token});assert(!battle.finished);assert(!events.some(e=>e.event==='endbattle'));assert.equal(b.equipe.pokemons[0].movePp[0],19);assert(events.some(e=>e.event==='battleText'&&e.data.message.includes('Téléport échoue')));battle.finish(null,'closed');
});

const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory'),tactics=require('../server/game/battle/trainerTactics');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function p(id,names){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.abilities=names;p.movePp=names.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
function options(team,foes,extra={}){const field=engine.createBattleState();return {team,opponentTeam:foes,field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1,...extra};}
test('open sheets include the opposing roster and attacks, but exclude pending intentions and private stats/items/PP',()=>{
 const a=p(6,['Flamethrower','Air Slash']),b=p(3,['Vine Whip','Sleep Powder']),reserve=p(9,['Surf']);
 const o=options([a],[b,reserve]);const before=JSON.stringify(o);const original=Math.random;
 Math.random=()=>{throw Error('Decision consumed battle RNG');};let result;
 try{result=ai.analyse(o);assert.deepEqual(ai.analyse(o),result);}finally{Math.random=original;}
 assert.equal(JSON.stringify(o),before);
 for(const enemy of [b,reserve])for(const key of ['movePp','iv','ev','heldItem','attack','defense','speed','k'])
  Object.defineProperty(enemy,key,{get(){throw Error('Private data read: '+key);},configurable:true});
 Object.defineProperty(o.field,'turnActions',{get(){throw Error('Read player intention');}});
 assert.deepEqual(ai.analyse(o),result);
 assert(result.predictions.some(x=>x.move==='Sleep Powder'));
 assert(result.predictions.some(x=>x.action==='change'&&x.pokemonUuid===reserve.uuid));
 b.abilities=['Earthquake','Rock Slide'];assert.notDeepEqual(ai.analyse(o).predictions,result.predictions);
});
test('prediction is uncertain, learns completed habits and ignores selected action injection',()=>{
 const o=options([p(6,['Flamethrower','Air Slash'])],[p(3,['Razor Leaf','Sleep Powder']),p(9,['Surf'])]);
 const first=ai.analyse(o),prob=r=>r.predictions.filter(x=>x.action==='change').reduce((n,x)=>n+x.probability,0);
 assert(prob(first)>0&&prob(first)<.6);assert(Math.abs(first.predictions.reduce((n,x)=>n+x.probability,0)-1)<1e-9);
 const expected=ai.chooseAction(o);
 for(const action of ['attack','change','bag']){o.field.turnActions={turn:1,entries:[{uuid:o.opponentTeam[0].uuid,action,moveName:'Rock Slide'}]};assert.deepEqual(ai.chooseAction(o),expected);}
 for(let i=0;i<8;i++)ai.observeTurn(o.memory,o.opponentTeam[0].uuid,null,'change');
 assert(prob(ai.analyse(o))>prob(first));
});
test('smart attack choices respect immunity, accuracy, PP, first-action moves and choice items',()=>{
 const a=p(25,['Thunderbolt','Iron Tail']),b=p(112,['Rock Slide']);assert.equal(ai.chooseAction(options([a],[b])).number,1);
 const fire=p(6,['Fire Blast','Flamethrower']),grass=p(3,['Tackle']);grass.currentHp=1;assert.equal(ai.chooseAction(options([fire],[grass])).number,1);
 fire.movePp[1]=0;assert.equal(ai.chooseAction(options([fire],[grass])).number,0);
 const fake=p(392,['Fake Out','Close Combat']);fake.__battle.activeMoveActions=1;assert.equal(ai.chooseAction(options([fake],[p(143,['Tackle'])])).number,1);
 const locked=p(9,['Surf','Ice Beam']);locked.heldItem='choice_specs';locked.__battle.choiceMove='Surf';assert.equal(ai.chooseAction(options([locked],[p(3,['Razor Leaf'])])).number,0);
});
test('strategic options include healing, setup, and an escape from a losing matchup',()=>{
 const heal=p(9,['Tackle','Recover']);heal.currentHp=Math.floor(heal.maxHp*.25);assert.equal(ai.chooseAction(options([heal],[p(7,['Tackle'])])).number,1);
 const setup=p(212,['Bullet Punch','Swords Dance']);const wall=p(143,['Splash']);wall.currentHp=wall.maxHp=1000;
 assert(Array.from({length:12},(_,i)=>ai.chooseAction(options([setup],[wall],{round:i+1})).number).includes(1),'Try a strong setup when the opponent cannot threaten it');
 const rock=p(112,['Rock Slide']),grass=p(3,['Razor Leaf']),water=p(9,['Surf']);
 assert.deepEqual(ai.chooseAction(options([rock,grass],[water])),{action:'change',number:1});
 const o=options([rock,grass],[water],{memory:{lastSwitchRound:1},round:2});assert.equal(ai.chooseAction(o).action,'change','a credible immediate KO permits a second defensive switch, with a repeat cost');
 rock.__battle.trappedTurns=2;assert.equal(ai.chooseAction(options([rock,grass],[water])).action,'attack');
});
test('all ordinary trainers use the new policy; champion ace reservation remains intact',()=>{
 const foe=p(9,['Surf']);
 for(const def of require('../data/game/pnj_teams.json').pnjs){const team=getPnjTeam(def.name),field=engine.createBattleState();const action=tactics.chooseAction(team,foe,field,tactics.createMemory(),1,[foe]);
 assert(['attack','change'].includes(action.action),def.name);
 if(action.action==='change'){assert(team.pokemons[action.number].currentHp>0);if(team.__trainerPlan?.aceUuid)assert.notEqual(team.pokemons[action.number].uuid,team.__trainerPlan.aceUuid);}
 }
});
for(const mode of ['rift','colosseum'])test(`${mode}: a trainer commits before any player command; resume and checkpoint preserve it`,()=>{
 const player={userId:1,currentmap:'route2',run:{mode},equipe:{pokemons:[p(9,['Surf']),p(3,['Razor Leaf']),p(6,['Flamethrower'])]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
 const foe={npc:true,equipe:{pokemons:[p(25,['Thunderbolt','Iron Tail'])]},drifts:[],equipped:[]};
 const battle=new DriftBattle(player,foe,{type:'trainer',emit(){},paceMs:0});const chosen={...battle.pending.get(foe)};
 assert.equal(battle.pending.has(player),false);assert.equal(battle.action(player,{action:'change',number:999,turnId:battle.token}),false);assert.deepEqual(battle.pending.get(foe),chosen);
 const restored=codec.decode(codec.encode(battle));restored.emit=()=>{};restored.resume(restored.a);assert.deepEqual(restored.pending.get(restored.b),chosen);
 battle.finished=restored.finished=true;
});
test('full six-on-six evaluation remains bounded and does not mutate a combat',()=>{
 const o=options(getPnjTeam('sevenp').pokemons,getPnjTeam('lucie_corrupted').pokemons);const before=JSON.stringify(o);
 const start=performance.now();for(let i=0;i<8;i++)assert(ai.chooseAction(o));
 assert(performance.now()-start<1800,'AI should not block the server for seconds');assert.equal(JSON.stringify(o),before);
});

test('an expert can predict a Ground switch with Surf, but its prediction can be punished by staying in',()=>{
 const a=p(25,['Thunderbolt','Surf']),b=p(130,['Tackle']),reserve=p(112,['Earthquake']);
 const o=options([a],[b,reserve],{memory:{habits:{turns:8,switches:8,moves:{}}}});
 assert.equal(ai.chooseAction(options([a],[b])).number,0,'Thunderbolt wins against the current Water/Flying target');
 assert.equal(ai.chooseAction(o).number,1,'Surf is a calculated coverage prediction into the known Ground reserve');
 const model=ai.analyse(o);assert(model.predictions.some(x=>x.action==='attack'&&x.probability>.4),'Staying in remains possible');
});
test('an immunity revealed in combat prevents repeating a blocked move',()=>{
 const a=p(6,['Flamethrower','Air Slash']),b=p(3,['Vine Whip']),o=options([a],[b]);
 o.memory.seen={[b.uuid]:{immuneMoves:['Flamethrower'],moves:['Vine Whip']}};
 assert.equal(ai.chooseAction(o).number,1);
});

test('unusable Fake Out alone cannot grant a free Struggle while it still has PP',()=>{
 const a=p(392,['Fake Out']);a.__battle.activeMoveActions=2;
 assert.deepEqual(ai.chooseAction(options([a],[p(143,['Splash'])])),{action:'attack',number:0});
});

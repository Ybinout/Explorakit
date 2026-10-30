const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),ai=require('../server/game/battle/humanTrainerAI'),model=require('../server/game/battle/humanTrainerModel');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const bases=new Map([6,9,25,130,212,143,94,65,445,376].map(id=>[id,factory.create(id,70,true)]));
function mon(id){const p=bases.get(id);p.__battle={statStages:{},sleepTurns:1};p.passiveAbility=null;return ai.publicPokemon(p);}
function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))freeze(v);}return o;}
test('private damage previews match the defensive public API across weather, screens, flags, items and abilities',()=>{
 let checks=0;const rng=Math.random;Math.random=()=>{throw Error('preview consumed live RNG');};
 try{for(const weather of [null,'rain','sun','hail','sandstorm'])for(const pair of [[6,9,'Flamethrower'],[25,130,'Thunderbolt'],[212,143,'Bullet Punch'],[94,65,'Shadow Ball'],[445,376,'Earthquake']])for(const variant of [0,1,2,3]){
  const [a,b,move]=[mon(pair[0]),mon(pair[1]),engine.getMoveByName(pair[2])],field=engine.createBattleState();field.weather={kind:weather,turns:5};
  if(variant===1){a.__battle.chargeElectric=true;a.__battle.helpingHand=true;a.heldItem='life_orb';b.heldItem='eviolite';}
  if(variant===2){a.__battle.statStages.specialAttack=2;b.__battle.statStages.defense=2;field.sides.player.screens.reflectTurns=3;field.sides.player.screens.lightScreenTurns=3;}
  if(variant===3){a.passiveAbility='Adaptability';b.passiveAbility='Thick Fat';a.__battle.laserFocusTurns=2;field.terrain={kind:'grassy_terrain',turns:5};}
  const before=JSON.stringify([a,b,field]),expected=engine.estimateDamage(a,b,move,{battleState:field,defenderSide:field.sides.player});freeze(field);
  const actual=engine.estimateDamageOnCopies(model.copy(a),model.copy(b),move,{battleState:field,defenderSide:field.sides.player});assert.equal(actual,expected);assert.equal(JSON.stringify([a,b,field]),before);checks++;
 }}finally{Math.random=rng;}assert.equal(checks,100);
});
test('optimised planner never calls general deep-cloning damage estimates or changes source state',()=>{
 const a=factory.create(9,70,true),b=factory.create(6,70,true);a.abilities=['Surf','Ice Beam','Protect','Recover'];a.movePp=a.abilities.map(resources.getMaxMovePp);b.abilities=['Flamethrower','Air Slash'];b.movePp=b.abilities.map(resources.getMaxMovePp);const field=engine.createBattleState(),options={team:[a],opponentTeam:[b],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};
 const before=JSON.stringify(options),estimate=engine.estimateDamage;engine.estimateDamage=()=>{throw Error('redundant deep clone');};
 try{assert(ai.chooseAction(options));assert.equal(JSON.stringify(options),before);}finally{engine.estimateDamage=estimate;}
});

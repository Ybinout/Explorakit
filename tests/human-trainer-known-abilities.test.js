const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
function mon(id,moves,passiveAbility=null){const p=factory.create(id,50,true);p.uuid=`ability-sheet-${id}`;p.passiveAbility=passiveAbility;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
function options(team,opponentTeam){const field=engine.createBattleState();return {team,opponentTeam,field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};}

test('the trainer knows current abilities of the whole opposing team, with no private items/stats or pending action',()=>{
 const a=mon(6,['Flamethrower','Dragon Pulse']),b=mon(437,['Psychic'],'Levitate'),reserve=mon(134,['Surf'],'Water Absorb');
 const o=options([a],[b,reserve]),before=JSON.stringify(o),expected=ai.analyse(o);assert.equal(JSON.stringify(o),before);
 assert.equal(ai.publicPokemon(b).passiveAbility,'Levitate');assert.equal(ai.publicPokemon(reserve).passiveAbility,'Water Absorb');
 for(const p of [b,reserve])for(const key of ['movePp','heldItem','iv','ev','k','attack','defense','specialAttack','specialDefense','speed','currentAttack','currentDefense','currentSpecialAttack','currentSpecialDefense','currentSpeed'])
  Object.defineProperty(p,key,{get(){throw Error('Private data read: '+key);}});
 Object.defineProperty(o.field,'turnActions',{get(){throw Error('Submitted action read');}});
 const random=Math.random;Math.random=()=>{throw Error('Live battle RNG used');};
 try{assert.deepEqual(ai.analyse(o),expected);}finally{Math.random=random;}
 assert(!Object.hasOwn(ai.publicPokemon(b),'heldItem'));assert(!Object.hasOwn(ai.publicPokemon(b),'iv'));
});

test('Levitate versus Heatproof changes the right attack; suppression and ability changes are immediately respected',()=>{
 const a=mon(373,['Earthquake','Fire Blast']),b=mon(437,['Splash'],'Levitate'),o=options([a],[b]);
 const before=JSON.stringify(o);assert.deepEqual(ai.chooseAction(o),{action:'attack',number:1});assert.equal(JSON.stringify(o),before);
 b.passiveAbility='Heatproof';assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 b.passiveAbility='Levitate';b.__battle.abilitySuppressed=true;assert.deepEqual(ai.chooseAction(o),{action:'attack',number:0});
 b.__battle.abilitySuppressed=false;assert.deepEqual(ai.chooseAction(o),{action:'attack',number:1});
});

for(const [id,ability,attacker,moves]of [
 [195,'Water Absorb',9,['Surf','Ice Beam']],
 [135,'Volt Absorb',25,['Thunderbolt','Body Slam']],
 [59,'Flash Fire',6,['Flamethrower','Dragon Pulse']],
 [241,'Sap Sipper',3,['Giga Drain','Sludge Bomb']]
])test(`known ${ability}: do not feed an immunity while an effective attack is available`,()=>{
 const a=mon(attacker,moves),b=mon(id,['Splash'],ability),o=options([a],[b]);
 assert.deepEqual(ai.chooseAction(o),{action:'attack',number:1});
 for(const chosen of ['attack','change','bag']){
  o.field.turnActions={turn:1,entries:[{uuid:b.uuid,action:chosen,moveName:'Splash'}]};
  assert.deepEqual(ai.chooseAction(o),{action:'attack',number:1});
 }
});

test('known Rough Skin prevents a needless contact suicide when a non-contact KO is available',()=>{
 const a=mon(68,['Close Combat','Earthquake']),b=mon(445,['Splash'],'Rough Skin');a.currentHp=1;b.currentHp=1;
 assert.deepEqual(ai.chooseAction(options([a],[b])),{action:'attack',number:1});
});

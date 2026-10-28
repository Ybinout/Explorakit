const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('../server/game/battle/humanTrainerAI'),switching=require('../server/game/battle/trainerSwitching');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const resources=require('../server/game/battle/battleResources'),codec=require('../server/game/drift/checkpointCodec');
const {DriftBattle}=require('../server/game/drift/driftBattle');
function mon(id,moves=['Splash'],ability=null){const p=factory.create(id,50,true);p.uuid=`trap-${id}`;p.passiveAbility=ability;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
function options(team,foes){const field=engine.createBattleState();return {team,opponentTeam:foes,field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};}
const escapes=o=>ai.analyse(o).predictions.filter(p=>p.action==='change').reduce((n,p)=>n+p.probability,0);

test('Arena Trap, Magnet Pull and Shadow Tag remove only the switch hypotheses they actually prevent',()=>{
 for(const [ability,id,blocked,free]of [['Arena Trap',51,25,130],['Magnet Pull',462,376,25],['Shadow Tag',202,25,94]]){
  const holder=mon(id,['Tackle'],ability),reserve=mon(9,['Surf']);
  assert.equal(escapes(options([holder],[mon(blocked,['Tackle']),reserve])),0,ability);
  assert(escapes(options([holder],[mon(free,['Tackle']),reserve]))>0,ability+' exception');
  holder.__battle.abilitySuppressed=true;
  assert(escapes(options([holder],[mon(blocked,['Tackle']),reserve]))>0,ability+' suppressed');
 }
});

test('grounding, Gravity, airborne effects and Ghost escape use the same rules as real switching',()=>{
 const holder=mon(51,['Earthquake'],'Arena Trap'),field=engine.createBattleState();
 for(const target of [mon(25),mon(130),mon(94),mon(330,['Earthquake'],'Levitate'),mon(25,['Splash'],'Levitate')]){
  assert.equal(switching.chance(target,holder,field),Number(engine.canSwitchOut(structuredClone(target),structuredClone(holder),structuredClone(field))));
 }
 const air=ai.publicPokemon(mon(330));assert.equal(switching.chance(air,holder,field),1,'Flygon always has Levitate; infer from species only');
 field.field.gravityTurns=3;assert.equal(switching.chance(air,holder,field),0);
 assert.equal(switching.chance(ai.publicPokemon(mon(130)),holder,field),0);
 assert.equal(switching.chance(ai.publicPokemon(mon(94)),holder,field),1,'Ghost remains free even when grounded');
 field.field.gravityTurns=0;const floating=ai.publicPokemon(mon(25));floating.__battle.magnetRiseTurns=2;assert.equal(switching.chance(floating,holder,field),1);
 floating.__battle.magnetRiseTurns=0;floating.__battle.telekinesisTurns=2;assert.equal(switching.chance(floating,holder,field),1);
 floating.__battle.grounded=true;assert.equal(switching.chance(floating,holder,field),0);
});

test('ambiguous Levitate is a species-based hypothesis, independent of hidden ability and selected action',()=>{
 const holder=mon(51,['Earthquake'],'Arena Trap'),foe=mon(437,['Psychic'],'Levitate'),reserve=mon(130,['Waterfall']);
 const o=options([holder],[foe,reserve]),before=JSON.stringify(o),expected=ai.analyse(o);
 const probability=switching.chance(ai.publicPokemon(foe),holder,o.field);assert(probability>0&&probability<1);
 assert(escapes(o)>0);assert.equal(JSON.stringify(o),before);
 for(const p of [foe,reserve])for(const key of ['passiveAbility','heldItem','iv','ev','k','currentAttack','currentDefense','currentSpeed','currentSpecialAttack','currentSpecialDefense'])
  Object.defineProperty(p,key,{get(){throw Error('Private property read: '+key);}});
 Object.defineProperty(o.field,'turnActions',{get(){throw Error('Pending player choice read');}});
 const random=Math.random;Math.random=()=>{throw Error('Live RNG used');};
 try{assert.deepEqual(ai.analyse(o),expected);}finally{Math.random=random;}
});

test('the AI can bring Dugtrio in safely, and values its trap without granting it a suicidal bonus',()=>{
 const lead=mon(143,['Body Slam']),dug=mon(51,['Earthquake','Stone Edge'],'Arena Trap'),foe=mon(462,['Thunderbolt']),reserve=mon(130,['Waterfall']);
 foe.maxHp=foe.currentHp=250;const o=options([lead,dug],[foe,reserve]),before=JSON.stringify(o);
 const score=ai.analyse(o).candidates.find(c=>c.action==='change'&&c.number===1).score;
 assert.deepEqual(ai.chooseAction(o),{action:'change',number:1});assert.equal(JSON.stringify(o),before);
 dug.passiveAbility='Sand Force';const noTrap=ai.analyse(o).candidates.find(c=>c.action==='change'&&c.number===1).score;assert(score>noTrap);
 dug.passiveAbility='Arena Trap';dug.currentHp=1;foe.abilities=['Flash Cannon'];foe.movePp=[10];
 assert.notDeepEqual(ai.chooseAction(o),{action:'change',number:1},'do not sacrifice the trapper on entry');
});

test('Ghost can escape Fairy Lock and ordinary trapping; known own Levitate is preserved',()=>{
 const field=engine.createBattleState();field.field.fairyLockTurns=1;
 const ghost=mon(94);ghost.__battle.trappedTurns=2;ghost.__battle.ingrain=true;
 assert.equal(switching.chance(ghost,mon(51,[],'Arena Trap'),field),1);
 assert.equal(switching.chance(mon(25),null,field),0);
});

for(const mode of ['rift','colosseum'])test(`${mode}: a real Arena Trap encounter rejects escape and keeps its committed decision across checkpoint`,()=>{
 const lead=mon(25,['Thunderbolt']),reserve=mon(130,['Waterfall']),dug=mon(51,['Earthquake','Stone Edge'],'Arena Trap');
 const player={userId:1,currentmap:'route2',run:{mode},equipe:{pokemons:[lead,reserve]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
 const npc={npc:true,equipe:{pokemons:[dug]},drifts:[],equipped:[]};
 const b=new DriftBattle(player,npc,{type:'trainer',emit(){},paceMs:0});const committed={...b.pending.get(npc)};
 assert.equal(escapes(options([dug],[lead,reserve])),0);
 assert.equal(b.action(player,{action:'change',number:1,turnId:b.token}),false);assert.deepEqual(b.pending.get(npc),committed);
 const restored=codec.decode(codec.encode(b));restored.emit=()=>{};restored.resume(restored.a);assert.deepEqual(restored.pending.get(restored.b),committed);
 assert.equal(engine.canSwitchOut(restored.active(0),restored.active(1),restored.state),false);
 b.finished=restored.finished=true;
});

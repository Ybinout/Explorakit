const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const resources=require('../server/game/battle/battleResources');
const factory=require('../server/game/drift/pokemonFactory');
const {clearSwitchOutState}=require('../server/game/battle/battleTeam');
const {clearBattleTransientState}=require('../server/game/battle/battleOutcome');
const {pokemonToRow,rowToPokemon,POKEMON_COLUMNS}=require('../server/persistence/teamRepository');
const pc=require('../server/persistence/pokemonStorageRepository');
const codec=require('../server/game/drift/checkpointCodec');
function pokemon(id=132,moves=['Transform'],level=40,k=1){
 const p=factory.create(id,level,true);p.k=k;p.nature='Bashful';p.iv=Object.fromEntries(['hp','attack','defense','specialAttack','specialDefense','speed'].map(s=>[s,31]));p.recalculateStats();
 p.passiveAbility=id===132?'Limber':null;p.heldItem=null;p.abilities=[];p.movePp=[];moves.forEach(m=>p.addAbility(m));engine.ensureBattleData(p);return p;
}
function transform(a,b,state=engine.createBattleState()) {return engine.useattack('Transform',a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}

test('Morphing copies actual non-HP stats, current types, ability, stages and fresh moves, preserving Ditto identity and equipment',()=>{
 const a=pokemon(),b=pokemon(94,['Shadow Ball','Thunderbolt','Protect','Substitute'],80,4);a.heldItem='choice_scarf';a.currentHp-=10;a.status='poison';b.status='paralyze';b.passiveAbility='Levitate';
 const own={uuid:a.uuid,level:a.level,k:a.k,maxHp:a.maxHp,hp:a.currentHp,iv:{...a.iv},ev:{...a.ev}};
 b.__battle.tempTypes=['Water'];b.__battle.statStages.speed=2;b.__battle.statStages.specialAttack=3;b.__battle.statStages.defense=-1;b.movePp=[0,1,2,0];a.__battle.statStages.speed=-2;
 assert(transform(a,b).success);
 for(const s of ['Attack','Defense','SpecialAttack','SpecialDefense','Speed'])assert.equal(a['current'+s],b['current'+s]);
 assert.deepEqual(a.__battle.tempTypes,['Water']);assert.equal(a.passiveAbility,'Levitate');assert.deepEqual(a.__battle.statStages,b.__battle.statStages);
 assert.equal(a.data.id,132);assert.equal(a.uuid,own.uuid);assert.equal(a.level,own.level);assert.equal(a.k,own.k);assert.equal(a.maxHp,own.maxHp);assert.equal(a.currentHp,own.hp);assert.equal(a.status,'poison');assert.equal(a.heldItem,'choice_scarf');assert.deepEqual(a.iv,own.iv);assert.deepEqual(a.ev,own.ev);
 assert.equal(a.__battle.transformSpriteId,94);assert.deepEqual(a.abilities,b.abilities);assert.deepEqual(a.movePp,[5,5,5,5]);assert.deepEqual(b.movePp,[0,1,2,0]);
 a.__battle.statStages.speed=0;assert.equal(b.__battle.statStages.speed,2);
});

for(const base of [100,101,199,200,201])test(`Choice Scarf applies once to copied speed ${base}, with correct integer rounding and real turn order`,()=>{
 const a=pokemon(),b=pokemon(94,['Tackle']);a.heldItem='choice_scarf';b.currentSpeed=base;const state=engine.createBattleState();assert(transform(a,b,state).success);
 assert.equal(a.currentSpeed,base);assert.equal(engine.getBattleSpeed(a,state.sides.player,state),Math.floor(base*1.5));
 const actions=[{pokemon:b,moveName:'Tackle',side:state.sides.enemy},{pokemon:a,moveName:'Tackle',side:state.sides.player}];
 assert.equal(engine.orderBattleActions(actions,state)[0].pokemon,a);
 state.field.trickRoomTurns=3;assert.equal(engine.orderBattleActions(actions,state)[0].pokemon,b);
 state.field.trickRoomTurns=0;b.heldItem='choice_scarf';assert.equal(engine.getBattleSpeed(a,null,state),engine.getBattleSpeed(b,null,state));
});

test('Copied speed boosts are separate from held items, paralysis and each side’s Tailwind',()=>{
 const a=pokemon(),b=pokemon(94,['Tackle']);a.heldItem='choice_scarf';b.heldItem='choice_scarf';b.currentSpeed=201;b.status='paralyze';b.__battle.statStages.speed=1;
 const state=engine.createBattleState();assert(transform(a,b,state).success);
 assert.equal(a.status,'normal');assert.equal(engine.getBattleSpeed(a,null,state),451);
 assert.equal(engine.getBattleSpeed(b,null,state),225);
 state.sides.player.screens.tailwindTurns=2;assert.equal(engine.getBattleSpeed(a,state.sides.player,state),902);
 state.field.magicRoomTurns=2;assert.equal(engine.getBattleSpeed(a,null,state),301);
 state.field.magicRoomTurns=0;a.__battle.embargoTurns=2;assert.equal(engine.getBattleSpeed(a,null,state),301);
});

test('A copied Klutz disables Ditto’s own Scarf; the target’s held item is never copied',()=>{
 const a=pokemon(),b=pokemon(428,['Tackle']);a.heldItem='choice_scarf';b.heldItem='leftovers';b.passiveAbility='Klutz';b.currentSpeed=200;
 assert(transform(a,b).success);assert.equal(a.heldItem,'choice_scarf');assert.equal(engine.getBattleSpeed(a),200);
});

test('Morphing releases a Choice lock on the vanished move, then locks the first copied attack normally',()=>{
 const a=pokemon(),b=pokemon(9,['Surf','Ice Beam']);a.heldItem='choice_scarf';const state=engine.createBattleState();assert(transform(a,b,state).success);
 assert.deepEqual(resources.getUsableMoveIndexes(a,state),[0,1]);assert.equal(a.__battle.choiceMove,undefined);
 engine.useattack('Surf',a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy});
 assert.equal(a.__battle.choiceMove,'Surf');assert.deepEqual(resources.getUsableMoveIndexes(a,state),[0]);assert.equal(a.movePp[0],4);
});

test('Copied PP use a five-PP maximum, including refill; moves with fewer base PP keep that lower maximum',()=>{
 const a=pokemon(),b=pokemon(235,['Sketch','Splash']);assert(transform(a,b).success);
 assert.deepEqual(a.movePp,[1,5]);a.movePp=[90,90];resources.normalizeMovePp(a);assert.deepEqual(a.movePp,[1,5]);
 a.movePp=[0,0];resources.restoreMovePp(a);assert.deepEqual(a.movePp,[1,5]);assert.equal(resources.getMovePp(a,'Splash').max,5);
});

test('Imposter shares Morphing’s stats and stages, activates the copied entry ability once and does not repeat entry hazards',()=>{
 const a=pokemon(),b=pokemon(130,['Waterfall','Dragon Dance']);a.passiveAbility='Imposter';a.heldItem='choice_scarf';b.passiveAbility='Intimidate';b.currentSpeed=200;b.__battle.statStages.speed=2;
 const state=engine.createBattleState(),before=a.currentHp;state.sides.player.hazards.stealthRock=true;
 const messages=engine.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,b);
 assert(a.__battle.transformed);assert.equal(a.passiveAbility,'Intimidate');assert.equal(a.__battle.statStages.speed,2);assert.equal(engine.getBattleSpeed(a,null,state),600);
 assert.equal(b.__battle.statStages.attack,-1);assert.equal(messages.filter(m=>m.includes('Attaque baisse')).length,1);
 assert.equal(before-a.currentHp,Math.max(1,Math.floor(a.maxHp/8)));assert.deepEqual(a.movePp,[5,5]);
 clearSwitchOutState(a);assert.equal(a.passiveAbility,'Imposter');assert.deepEqual(a.abilities,['Transform']);assert.deepEqual(a.movePp,[10]);assert.equal(a.currentSpeed,a.speed);
 const next=pokemon(25,['Thunderbolt']);next.currentSpeed=101;engine.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,next);assert.equal(engine.getBattleSpeed(a,null,state),151);
});

for(const reason of ['substitute','transformed','illusion','airborne','fainted'])test(`Morphing cannot copy an invalid target: ${reason}`,()=>{
 const a=pokemon(),b=pokemon(94,['Shadow Ball']);if(reason==='substitute')b.__battle.substituteHp=20;if(reason==='transformed')b.__battle.transformed=true;if(reason==='illusion')b.__battle.illusion={id:25};if(reason==='airborne')b.__battle.semiInvulnerable='airborne';if(reason==='fainted')b.currentHp=0;
 const original=a.currentSpeed;const r=transform(a,b);assert(!r.success);assert(!a.__battle.transformed);assert.deepEqual(a.abilities,['Transform']);assert.equal(a.currentSpeed,original);
});

test('A second Morphing cannot refill copied PP or recursively copy another transformed Ditto',()=>{
 const a=pokemon(),b=pokemon(151,['Transform','Surf']),c=pokemon(25,['Tackle']);assert(transform(a,b).success);
 a.movePp[1]=1;assert(!transform(a,c).success);assert.equal(a.movePp[1],1);assert.equal(a.__battle.transformSpeciesId,151);
 const other=pokemon();assert(!transform(other,a).success);
});

test('Copying a weather form uses its sprite/types without changing the real species or recalculating with Ditto’s own IV/level',()=>{
 const a=pokemon(),b=pokemon(351,['Weather Ball']);b.passiveAbility='Forecast';const state=engine.createBattleState();state.weather={kind:'rain',turns:5};engine.applySwitchInEffects(b,state.sides.enemy,state.sides.player,state,a);
 assert(transform(a,b,state).success);assert.equal(a.data.id,132);assert.equal(a.__battle.transformSpriteId,10014);assert.deepEqual(a.__battle.tempTypes,['Water']);
 state.weather={kind:'sun',turns:5};engine.processEndOfRound(a,state.sides.player,state);assert.equal(a.__battle.transformSpriteId,10014);assert.deepEqual(a.__battle.tempTypes,['Water']);
});

test('Mid-battle party/PC saves use the permanent set without modifying the live transformation',()=>{
 const a=pokemon(),b=pokemon(9,['Surf','Ice Beam']);a.heldItem='choice_scarf';b.passiveAbility='Torrent';assert(transform(a,b).success);
 const values=pokemonToRow(a,1,1),row=Object.fromEntries(POKEMON_COLUMNS.map((key,i)=>[key,values[i]]));
 assert.equal(row.pokemon_id,132);assert.equal(row.ability1,'Transform');assert.equal(row.move1_pp,9);assert.equal(row.passive_ability,'Limber');assert.equal(row.current_speed,a.speed);assert.equal(row.held_item,'choice_scarf');
 for(const restored of [rowToPokemon(row),pc.decodePokemon(pc.encodePokemon(a))]){assert.equal(restored.data.id,132);assert.deepEqual(restored.abilities,['Transform']);assert.deepEqual(restored.movePp,[9]);assert.equal(restored.passiveAbility,'Limber');assert.equal(restored.heldItem,'choice_scarf');}
 assert.deepEqual(a.abilities,['Surf','Ice Beam']);assert.equal(a.passiveAbility,'Torrent');assert(a.__battle.transformed);
});

test('XP and EV changes update permanent stats while copied combat stats stay fixed; switch/end cleanup keeps the legitimate growth',()=>{
 const a=pokemon(),b=pokemon(94,['Shadow Ball']);assert(transform(a,b).success);const copied=a.currentSpeed,oldOwn=a.speed;
 a.gainEffort({speed:252});assert(a.speed>oldOwn);assert.equal(a.currentSpeed,copied);
 a.gainExperience(a.getNextLevelExp()-a.experience);assert.equal(a.currentSpeed,copied);
 clearBattleTransientState([a]);assert.equal(a.currentSpeed,a.speed);assert.deepEqual(a.abilities,['Transform']);assert.deepEqual(a.movePp,[9]);assert.equal(a.passiveAbility,'Limber');assert(!a.__battle);
});

test('Checkpoint/reconnect retains a transformed Scarf Ditto and can still restore its original set later',()=>{
 const a=pokemon(),b=pokemon(94,['Shadow Ball','Protect']);a.heldItem='choice_scarf';b.currentSpeed=201;assert(transform(a,b).success);
 const restored=codec.decode(codec.encode(a));assert.equal(engine.getBattleSpeed(restored),301);assert.deepEqual(restored.movePp,[5,5]);assert.equal(restored.__battle.transformSpeciesId,94);
 clearSwitchOutState(restored);assert.equal(restored.data.id,132);assert.equal(restored.passiveAbility,'Limber');assert.deepEqual(restored.abilities,['Transform']);assert.deepEqual(restored.movePp,[9]);assert.equal(restored.currentSpeed,restored.speed);
});

for(const mode of ['rift','colosseum'])for(const ability of ['Limber','Imposter'])test(`${mode} ${ability}: real expedition turns use copied Scarf speed and checkpoints preserve/restorable identity`,()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle');
 const a=pokemon(),b=pokemon(94,['Tackle']);a.passiveAbility=ability;a.heldItem='choice_scarf';a.currentSpeed=40;b.currentSpeed=200;
 for(const p of [a,b])p.currentHp=p.maxHp=10000;
 const player={userId:1,currentmap:'route1',run:{mode},equipe:{pokemons:[a]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
 const enemy={npc:true,equipe:{pokemons:[b]},drifts:[],equipped:[],chain:0};
 const events=[],battle=new DriftBattle(player,enemy,{type:'trainer',npcKey:mode==='colosseum'?'colosseum_1':'fixture',paceMs:0,random:()=>.5,emit(_p,event,payload){events.push({event,payload:JSON.parse(JSON.stringify(payload))});}});
 assert(battle.action(player,{turnId:battle.token,action:'attack',number:0}));battle.tick();
 assert(a.__battle.transformed);assert.equal(engine.getBattleSpeed(a),300);
 assert(battle.action(player,{turnId:battle.token,action:'attack',number:0}));
 const animations=events.filter(e=>e.event==='battleMoveAnimation').map(e=>e.payload.actor);
 assert.deepEqual(animations.slice(0,4),ability==='Imposter'?['player','opponent','player','opponent']:['opponent','player','player','opponent']);
 const restored=codec.decode(codec.encode(battle));assert.equal(engine.getBattleSpeed(restored.a.equipe.pokemons[0]),300);assert.deepEqual(restored.a.equipe.pokemons[0].abilities,['Tackle']);
 clearBattleTransientState(restored.originals);assert.deepEqual(restored.a.equipe.pokemons[0].abilities,['Transform']);assert.equal(restored.a.equipe.pokemons[0].passiveAbility,ability);
 battle.finish(null,'fled');assert(!a.__battle);assert.equal(a.currentSpeed,a.speed);assert.deepEqual(a.abilities,['Transform']);assert.equal(a.heldItem,'choice_scarf');
});

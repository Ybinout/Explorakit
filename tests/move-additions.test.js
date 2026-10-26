const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const factory=require('../server/game/drift/pokemonFactory'),{switchPokemonByIndex}=require('../server/game/battle/battleTeam');
function mon(id,names=['Splash'],extra={}) {const p=factory.create(id,50,true);return Object.assign(p,{uuid:`addition-${id}`,currentHp:500,maxHp:500,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,passiveAbility:null,heldItem:null,status:'normal',abilities:names,movePp:names.map(resources.getMaxMovePp),__battle:{statStages:{}}},extra);}
function cast(name,a,b,state=engine.createBattleState()){if(!a.abilities.includes(name)){a.abilities.push(name);a.movePp.push(resources.getMaxMovePp(name));}return engine.useattack(name,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
function fixed(work,roll=.99){const old=Math.random;Math.random=()=>roll;try{return work();}finally{Math.random=old;}}
test('First Impression is a strong priority opening, then fails until the next entry',()=>fixed(()=>{
 const a=mon(83,['First Impression','Tackle']),b=mon(143),state=engine.createBattleState();
 assert.equal(engine.getMovePriority('First Impression',a),2);assert(cast('First Impression',a,b,state).damage>0);
 state.turn++;assert.equal(cast('First Impression',a,b,state).success,false);
 const team=[a,mon(19)];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);assert(cast('First Impression',a,b,state).damage>0);
}));
test('Strength Sap uses Attack before the drop and obeys stage limits, Contrary, Liquid Ooze and Heal Block',()=>fixed(()=>{
 const a=mon(45,['Strength Sap'],{currentHp:10}),b=mon(143,[],{currentAttack:100});b.__battle.statStages.attack=2;
 cast('Strength Sap',a,b);assert.equal(a.currentHp,210);assert.equal(b.__battle.statStages.attack,1);
 a.currentHp=10;a.__battle.healBlockTurns=2;cast('Strength Sap',a,b);assert.equal(a.currentHp,10);assert.equal(b.__battle.statStages.attack,1);
 delete a.__battle.healBlockTurns;b.__battle.statStages.attack=-6;assert.equal(cast('Strength Sap',a,b).success,false);
 b.__battle.statStages.attack=0;b.passiveAbility='Contrary';a.currentHp=10;cast('Strength Sap',a,b);assert.equal(b.__battle.statStages.attack,1);assert.equal(a.currentHp,110);
 b.passiveAbility='Liquid Ooze';b.__battle.statStages.attack=0;a.currentHp=200;cast('Strength Sap',a,b);assert.equal(a.currentHp,100);
}));
test('Laser Focus guarantees critical hits through the next turn, expires and respects critical immunity',()=>fixed(()=>{
 const a=mon(448,['Laser Focus','Tackle']),b=mon(143),state=engine.createBattleState();cast('Laser Focus',a,b,state);
 engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);state.turn++;
 assert.equal(cast('Tackle',a,b,state).critical,true);
 engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);state.turn++;
 assert.equal(cast('Tackle',a,b,state).critical,false);
 cast('Laser Focus',a,b,state);b.passiveAbility='Battle Armor';assert.equal(cast('Tackle',a,b,state).critical,false);
}));
test('Throat Chop blocks sound for two turns without blocking ordinary moves or surviving a switch',()=>fixed(()=>{
 const a=mon(215,['Throat Chop']),b=mon(143,['Hyper Voice','Tackle']),state=engine.createBattleState();cast('Throat Chop',a,b,state);
 assert.equal(cast('Hyper Voice',b,a,state).success,false);assert(cast('Tackle',b,a,state).damage>0);
 engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);state.turn++;assert.equal(cast('Hyper Voice',b,a,state).success,false);
 engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);state.turn++;assert(cast('Hyper Voice',b,a,state).damage>0);
}));
test('Sheer Force and Shield Dust suppress Throat Chop’s secondary effect',()=>fixed(()=>{
 for(const mode of['force','dust']){const a=mon(68,['Throat Chop']),b=mon(143,['Hyper Voice']);if(mode==='force')a.passiveAbility='Sheer Force';else b.passiveAbility='Shield Dust';cast('Throat Chop',a,b);assert(cast('Hyper Voice',b,a).damage>0);}
}));
test('Power Trip and Stored Power scale from own positive stages, excluding the critical stage',()=>{
 for(const name of['Power Trip','Stored Power']){const a=mon(198,[name]),b=mon(143);a.__battle.statStages={attack:2,speed:1,accuracy:1,critical:3,defense:-2};assert.equal(engine.getSpecialMoveResolution(engine.getMoveByName(name),a,b).power,100);}
});
test('Burn Up removes Fire only after a successful hit and the original type returns on leaving',()=>fixed(()=>{
 const a=mon(157,['Burn Up']),b=mon(143),state=engine.createBattleState();assert(cast('Burn Up',a,b,state).damage>0);
 assert(!a.__battle.tempTypes.includes('Fire'));assert.equal(cast('Burn Up',a,b,state).success,false);
 const team=[a,mon(19)];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);assert(cast('Burn Up',a,b,state).damage>0);
 const water=mon(9,['Burn Up']);assert.equal(cast('Burn Up',water,b,state).success,false);
}));
test('Aurora Veil requires hail, halves physical and special hits, does not stack with screens and is breakable',()=>fixed(()=>{
 const a=mon(131,['Aurora Veil']),b=mon(143,['Tackle','Psychic','Psychic Fangs']),state=engine.createBattleState();
 assert.equal(cast('Aurora Veil',a,b,state).success,false);state.weather={kind:'hail',turns:5};assert.equal(cast('Aurora Veil',a,b,state).success,true);
 const estimate=(n)=>engine.estimateDamage(b,a,engine.getMoveByName(n),{battleState:state,defenderSide:state.sides.player});
 for(const name of['Tackle','Psychic']){const half=estimate(name);state.sides.player.screens.auroraVeilTurns=0;const full=estimate(name);state.sides.player.screens.auroraVeilTurns=5;assert(Math.abs(full-2*half)<=1);}
 const half=estimate('Tackle');state.sides.player.screens.reflectTurns=5;assert.equal(estimate('Tackle'),half);
 const swapped={...state,sides:{player:state.sides.enemy,enemy:state.sides.player}};cast('Psychic Fangs',b,a,swapped);assert.equal(state.sides.player.screens.auroraVeilTurns,0);assert.equal(state.sides.player.screens.reflectTurns,0);
}));
test('Stomping Tantrum doubles after an actual previous-turn failure, not after Protect',()=>fixed(()=>{
 const a=mon(57,['Thunderbolt','Stomping Tantrum']),b=mon(112),state=engine.createBattleState();assert.equal(cast('Thunderbolt',a,b,state).damage,0);state.turn++;
 assert.equal(engine.getSpecialMoveResolution(engine.getMoveByName('Stomping Tantrum'),a,b,{battleState:state}).power,150);
 b.__battle.protect=true;cast('Stomping Tantrum',a,b,state);state.turn++;assert.equal(engine.getSpecialMoveResolution(engine.getMoveByName('Stomping Tantrum'),a,b,{battleState:state}).power,75);
}));
test('new physical moves preserve their secondary effects and Dragon Ascent has its defensive cost',()=>fixed(()=>{
 const a=mon(384,['Dragon Ascent']),b=mon(143);cast('Dragon Ascent',a,b);assert.equal(a.__battle.statStages.defense,-1);assert.equal(a.__battle.statStages.specialDefense,-1);
 b.currentHp=500;cast('Lunge',a,b);assert.equal(b.__battle.statStages.attack,-1);
 b.currentHp=500;cast('Liquidation',a,b);assert.equal(b.__battle.statStages.defense,-1);
},.1));
test('Toxic Thread and Tearful Look apply the intended status/stat combination',()=>fixed(()=>{
 const a=mon(168,['Toxic Thread']),b=mon(143);cast('Toxic Thread',a,b);assert.equal(b.status,'poison');assert.equal(b.__battle.statStages.speed,-1);
 cast('Tearful Look',a,b);assert.equal(b.__battle.statStages.attack,-1);assert.equal(b.__battle.statStages.specialAttack,-1);
}));
test('the new spread attacks are blocked by Wide Guard and Smart Strike ignores accuracy/evasion stages',()=>fixed(()=>{
 const a=mon(382,['Origin Pulse','Precipice Blades','Brutal Swing','Smart Strike']),b=mon(143),state=engine.createBattleState();state.sides.enemy.protectTeam.wideGuardTurns=1;
 for(const name of['Origin Pulse','Precipice Blades','Brutal Swing']){const hp=b.currentHp;assert.equal(cast(name,a,b,state).damage,0);assert.equal(b.currentHp,hp);}
 state.sides.enemy.protectTeam.wideGuardTurns=0;a.__battle.statStages.accuracy=-6;b.__battle.statStages.evasion=6;assert(cast('Smart Strike',a,b,state).damage>0);
}));

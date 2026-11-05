const test=require('node:test'),assert=require('node:assert/strict');
const presentation=require('../server/game/battle/presentationState');
const factory=require('../server/game/drift/pokemonFactory'),forms=require('../server/game/abilities/abilityForms');
const engine=require('../server/game/battle/battleEngine'),{DriftBattle}=require('../server/game/drift/driftBattle');
for(const id of[570,571])test(`Illusion ${id}: opposing snapshots hide the ability, while the authoritative owner remains intact`,()=>{
 const fox=factory.create(id,40,true),reserve=factory.create(25,40,true);fox.passiveAbility='Illusion';const before=fox.passiveAbility;
 assert.equal(presentation.opponentPokemon(fox).passiveAbility,null,'entry snapshot cannot disclose Illusion');
 forms.attachTeam([fox,reserve]);const state=engine.createBattleState();engine.applySwitchInEffects(fox,state.sides.player,state.sides.enemy,state,reserve);
 const publicView=presentation.opponentPokemon(fox);assert.equal(publicView.passiveAbility,reserve.passiveAbility);assert.deepEqual(publicView.data.type,reserve.data.type);assert.deepEqual(fox.data.type,['Dark']);assert.equal(publicView.__battle.illusion.id,25);assert.equal(fox.passiveAbility,before);assert.notEqual(publicView,fox);
 assert.equal(JSON.parse(JSON.stringify(publicView)).passiveAbility,reserve.passiveAbility);assert.equal(publicView.currentHp,fox.currentHp);assert.equal(publicView.uuid,fox.uuid);
 const old=Math.random;Math.random=()=>.8;try{engine.useattack('Tackle',reserve,fox,{battleState:state,attackerSide:state.sides.enemy,defenderSide:state.sides.player});}finally{Math.random=old;}
 assert.equal(fox.__battle.illusion,null);forms.prepareIllusion(fox);assert.equal(fox.__battle.illusion,null);assert.equal(fox.passiveAbility,'Illusion');assert.equal(presentation.opponentPokemon(fox).passiveAbility,'Illusion');
});
test('ordinary abilities stay visible and an active disguise is protected even after an ability edit',()=>{
 const p=factory.create(25,40,true);p.passiveAbility='Static';assert.equal(presentation.opponentPokemon(p),p);assert.equal(presentation.opponentPokemon(null),null);p.__battle={illusion:{id:133}};assert.equal(presentation.opponentPokemon(p).passiveAbility,null);assert.equal(p.passiveAbility,'Static');
});
test('real shared battle and reconnect snapshots reveal Illusion only to its own camp',()=>{
 const make=(id,foxId)=>{const fox=factory.create(foxId,40,true);fox.passiveAbility='Illusion';const last=factory.create(25,40,true);return{id,userId:id,socketId:'s'+id,username:'Owner'+id,currentmap:'ville5_maison1',equipe:{pokemons:[fox,last]},items:{},drifts:[],equipped:[]};};
 const a=make(1,570),b=make(2,571),packets=[];
 const battle=new DriftBattle(a,b,{type:'pvp',paceMs:0,rules:{report:false},emit:(p,event,payload)=>{if(event==='introAnimation')packets.push({viewer:p.userId,payload:JSON.parse(JSON.stringify(payload))});}});
 for(const id of[1,2]){const packet=packets.find(p=>p.viewer===id).payload;assert.equal(packet.player.equipe.pokemons[0].passiveAbility,'Illusion');assert.equal(packet.wildPokemon.passiveAbility,'Static');assert(packet.wildPokemon.__battle.illusion);}
 battle.resume(a);assert.equal(packets.at(-1).payload.wildPokemon.passiveAbility,'Static');assert.equal(a.equipe.pokemons[0].passiveAbility,'Illusion');assert.equal(b.equipe.pokemons[0].passiveAbility,'Illusion');
});
test('the copied ability is cosmetic: an apparent Levitate never grants a real Ground immunity',()=>{
 const fox=factory.create(571,40,true),apparent=factory.create(94,40,true);fox.passiveAbility='Illusion';apparent.passiveAbility='Levitate';apparent.abilities=['Earthquake'];apparent.movePp=[10];forms.attachTeam([fox,apparent]);const state=engine.createBattleState();engine.applySwitchInEffects(fox,state.sides.player,state.sides.enemy,state,apparent);
 assert.equal(presentation.opponentPokemon(fox).passiveAbility,'Levitate');const before=fox.currentHp,old=Math.random;Math.random=()=>.8;try{engine.useattack('Earthquake',apparent,fox,{battleState:state,attackerSide:state.sides.enemy,defenderSide:state.sides.player});}finally{Math.random=old;}
 assert(fox.currentHp<before);assert.equal(fox.passiveAbility,'Illusion');assert.deepEqual(fox.data.type,['Dark']);
});

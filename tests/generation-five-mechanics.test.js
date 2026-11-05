const test=require('node:test'),assert=require('node:assert/strict');
const e=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const forms=require('../server/game/abilities/abilityForms'),resources=require('../server/game/battle/battleResources');
const {clearBattleTransientState}=require('../server/game/battle/battleOutcome');
let serial=0;
const mon=(id=648,extra={})=>({uuid:'gen5-'+ ++serial,data:{id},truename:'Test',name:'Test',level:70,type1:'Normal',type2:'Psychic',maxHp:1000,currentHp:1000,
 currentAttack:150,currentDefense:150,currentSpecialAttack:150,currentSpecialDefense:150,currentSpeed:150,status:'normal',abilities:[],movePp:[],...extra});
const attack=(a,b,name,state=e.createBattleState())=>e.useattack(name,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b],consumePp:false});
function fixed(work){const old=Math.random;Math.random=()=>.5;try{return work();}finally{Math.random=old;}}
for(const[key,type]of[['douse_drive','Water'],['burn_drive','Fire'],['shock_drive','Electric'],['chill_drive','Ice']])test('Techno Blast '+key+' uses the held drive in execution, AI estimates and display without changing shared data',()=>fixed(()=>{
 const a=mon(649,{type1:'Bug',type2:'Steel',heldItem:key}),b=mon(7),state=e.createBattleState(),move=resources.getMoveDefinition('Techno Blast');
 assert.equal(e.resolveWeatherMove(move,a,b,state).type,type);a.abilities=['Techno Blast'];assert.deepEqual(e.battleMoveTypes(a,b,state),[type]);assert(attack(a,b,'Techno Blast',state).damage>0);assert.equal(move.type,'Normal');
 assert(!e.canKnockOffItem(a));assert(e.canKnockOffItem(mon(7,{heldItem:key})));
 for(const change of['klutz','embargo','magic']){const c=mon(649,{heldItem:key}),s=e.createBattleState();if(change==='klutz')c.passiveAbility='Klutz';if(change==='embargo')e.ensureBattleData(c).embargoTurns=3;if(change==='magic')s.field.magicRoomTurns=3;assert.equal(e.resolveWeatherMove(move,c,b,s).type,'Normal');}
}));
test('Meloetta changes forme after a connected Relic Song, persists between turns, toggles back and resets on leaving battle',()=>fixed(()=>{
 const a=factory.create(648,70,true),b=mon(7);a.abilities=['Relic Song'];a.movePp=[10];a.passiveAbility='Serene Grace';const permanent={id:a.data.id,types:[a.type1,a.type2],stats:[a.attack,a.speed],hp:a.maxHp};
 const result=attack(a,b,'Relic Song');assert(result.damage>0);assert.equal(a.__battle.formSpriteId,10018);assert.deepEqual(a.__battle.formTypes,['Normal','Fighting']);assert.equal(a.data.id,648);assert.equal(a.maxHp,permanent.hp);assert(forms.stat(a,'attack')>a.attack);
 forms.sync(a,'end');assert.equal(a.__battle.abilityForm,'Meloetta-Pirouette');attack(a,mon(7),'Relic Song');assert.equal(a.__battle.formSpriteId,null);
 attack(a,mon(7),'Relic Song');clearBattleTransientState([a]);assert(!a.__battle);assert.deepEqual([a.type1,a.type2],permanent.types);assert.deepEqual([a.attack,a.speed],permanent.stats);
}));
for(const guard of['Ghost','Soundproof','Protect','Sheer Force'])test('Relic Song does not transform through '+guard,()=>fixed(()=>{
 const a=mon(),b=mon(7),state=e.createBattleState();if(guard==='Ghost'){b.type1='Ghost';b.type2=null;}if(guard==='Soundproof')b.passiveAbility='Soundproof';if(guard==='Protect')attack(b,a,'Protect',state);if(guard==='Sheer Force')a.passiveAbility='Sheer Force';
 attack(a,b,'Relic Song',state);assert(!a.__battle?.formSpriteId);
}));
test('Illuminate doubles only the lead party member’s encounter rate without modifying the default rate',()=>{
 const {WILD_ENCOUNTER_CHANCE,encounterChance}=require('../server/game/world/encounterRate');
 assert.equal(encounterChance([]),WILD_ENCOUNTER_CHANCE);assert.equal(encounterChance([{passiveAbility:'Illuminate'}]),WILD_ENCOUNTER_CHANCE*2);assert.equal(encounterChance([{}, {passiveAbility:'Illuminate'}]),WILD_ENCOUNTER_CHANCE);
 assert.equal(require('../server/game/abilities/abilityCoverage').status('Illuminate'),'overworld');
});
test('each of the 156 species builds a healthy party member with legal moves, abilities and its growth group',()=>{
 const dex=require('../data/game/pokedex.json');for(let id=494;id<=649;id++){
  const data=dex.find(p=>p.id===id),p=factory.create(id,75,true);assert(data.exp>0);assert.equal(p.level,75);assert.equal(p.currentHp,p.maxHp);assert(p.abilities.length>0&&p.abilities.length<=4);for(const move of p.abilities)assert(resources.getMoveDefinition(move));assert(resources.getMaxMovePp(p.abilities[0])>0);assert(p.passiveAbility);assert(Number.isFinite(p.experienceRate));
 }
});
test('all six growth rates have strictly increasing thresholds and exact level round-trips, including fast level 1',()=>{
 const {getTotalExperienceForLevel:xp,getLevelFromExperience:level}=require('../server/game/models/progression');
 for(const rate of[.6,.8,1,1.05986,1.25,1.64])for(let n=1;n<=250;n++){
  assert.equal(level(xp(n,rate),rate),n);assert(xp(n+1,rate)>xp(n,rate));
  if(n>=3)assert.equal(xp(n,rate),Math.floor(rate*(n-1)**3),'Preserve existing balancing beyond the ambiguous first threshold');
 }
});
for(const ability of['Plus','Minus',null])test('Gear Up and Magnetic Flux require the actual unsuppressed Plus/Minus ability: '+ability,()=>fixed(()=>{
 for(const[name,stats]of[['Gear Up',['attack','specialAttack']],['Magnetic Flux',['defense','specialDefense']]]){
  const a=mon(601,{passiveAbility:ability}),b=mon(7),r=attack(a,b,name);for(const stat of stats)assert.equal(e.ensureBattleData(a).statStages[stat],ability?1:0);assert.equal(r.success,Boolean(ability));
  const blocked=mon(601,{passiveAbility:ability});e.ensureBattleData(blocked).abilitySuppressed=true;assert(!attack(blocked,b,name).success);for(const stat of stats)assert.equal(e.ensureBattleData(blocked).statStages[stat],0);
 }
}));
test('Fire Lash is a physical contact Fire move with a guaranteed secondary Defense drop, respecting Sheer Force, Shield Dust and immunity',()=>fixed(()=>{
 const move=resources.getMoveDefinition('Fire Lash');assert.equal(move.type,'Fire');assert.equal(move.power,80);assert.equal(move.combat.damage_class,'physical');
 const a=mon(631,{heldItem:'life_orb'}),b=mon(7);assert(attack(a,b,'Fire Lash').damage>0);assert.equal(b.__battle.statStages.defense,-1);assert(a.currentHp<a.maxHp);
 const sheer=mon(631,{passiveAbility:'Sheer Force',heldItem:'life_orb'}),defender=mon(7),boosted=attack(sheer,defender,'Fire Lash');assert(boosted.damage>0);assert.equal(defender.__battle.statStages.defense,0);assert.equal(sheer.currentHp,sheer.maxHp);
 const dust=mon(7,{passiveAbility:'Shield Dust'});attack(mon(631),dust,'Fire Lash');assert.equal(dust.__battle.statStages.defense,0);
 const immune=mon(7,{passiveAbility:'Flash Fire'});assert.equal(attack(mon(631),immune,'Fire Lash').damage,0);assert.equal(immune.__battle.statStages.defense,0);
}));
test('the AI sees Meloetta’s public dance-form types and speed, including a transformed copy, without reading private IVs',()=>fixed(()=>{
 const ai=require('../server/game/battle/humanTrainerAI'),a=factory.create(648,70,true),b=mon(7),base=ai.publicPokemon(a);attack(a,b,'Relic Song');
 const form=ai.publicPokemon(a);assert(form.speed>base.speed);assert.equal(form.type2,'Fighting');assert.equal(form.iv,undefined);
 const copy=factory.create(132,70,true);attack(copy,a,'Transform');const publicCopy=ai.publicPokemon(copy);assert.equal(publicCopy.type2,'Fighting');assert(publicCopy.speed>base.speed);assert.equal(publicCopy.iv,undefined);
}));

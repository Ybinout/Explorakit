const test=require('node:test'),assert=require('node:assert/strict'),engine=require('../server/game/battle/battleEngine'),model=require('../server/game/battle/humanTrainerModel'),factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
function mon(id,move,item,extra={}){const p=factory.create(id,50,true);Object.assign(p,{currentHp:400,maxHp:400,attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,passiveAbility:null,heldItem:item,status:'normal',abilities:[move],movePp:[resources.getMaxMovePp(move)]},extra);engine.ensureBattleData(p);return p;}
for(const [label,id,move,item,extra,foeId,foeMove,foeItem,foeExtra,first=true] of [
 ['Sea Incense',151,'Surf','sea_incense',{},143,'Splash',null,{}],
 ['White Herb',68,'Close Combat','white_herb',{},143,'Pound',null,{}],
 ['White Herb before retaliation',68,'Close Combat','white_herb',{},143,'Pound',null,{},false],
 ['Mental Herb Taunt',151,'Swords Dance','mental_herb',{},143,'Taunt',null,{},false],
 ['Power Herb Solar Beam',151,'Solar Beam','power_herb',{},143,'Pound',null,{}],
 ['Power Herb Geomancy',151,'Geomancy','power_herb',{},143,'Pound',null,{}],
 ['Power Herb Skull Bash',151,'Skull Bash','power_herb',{},143,'Pound',null,{}],
 ['Balloon immunity',151,'Splash','air_balloon',{},143,'Earthquake',null,{}],
 ['Balloon burst',151,'Splash','air_balloon',{},143,'Pound',null,{}],
 ['Balloon behind clone',151,'Splash','air_balloon',{__battle:{statStages:{},substituteHp:100}},143,'Pound',null,{}],
 ['Weakness Policy',6,'Splash','weakness_policy',{},143,'Surf',null,{}],
 ['Weakness Policy fixed',6,'Splash','weakness_policy',{},143,'Dragon Rage',null,{}],
 ['Black Sludge Poison',31,'Splash','black_sludge',{currentHp:100},143,'Splash',null,{}],
 ['Black Sludge non Poison',143,'Splash','black_sludge',{currentHp:100},143,'Splash',null,{}],
 ['Black Sludge Heal Block',143,'Splash','black_sludge',{currentHp:100,__battle:{statStages:{},healBlockTurns:3}},143,'Splash',null,{}],
 ['Big Root drain',68,'Drain Punch','big_root',{currentHp:100},143,'Splash',null,{}],
 ['Big Root Liquid Ooze',68,'Drain Punch','big_root',{currentHp:100},143,'Splash',null,{passiveAbility:'Liquid Ooze'}],
 ['Big Root Ingrain',151,'Splash','big_root',{currentHp:100,__battle:{statStages:{},ingrain:true}},143,'Splash',null,{}],
 ['Big Root Strength Sap',151,'Strength Sap','big_root',{currentHp:100},143,'Splash',null,{}],
 ['Pads Helmet',68,'Pound','protective_pads',{},143,'Splash','rocky_helmet',{}],
 ['Pads Rough Skin',68,'Pound','protective_pads',{},143,'Splash',null,{passiveAbility:'Rough Skin'}],
 ['Light Clay',151,'Reflect','light_clay',{},143,'Pound',null,{}],
 ['Damp Rock',151,'Rain Dance','damp_rock',{},143,'Splash',null,{}],
 ['Heat Rock',151,'Sunny Day','heat_rock',{},143,'Splash',null,{}],
 ['Smooth Rock',151,'Sandstorm','smooth_rock',{},143,'Splash',null,{}],
 ['Icy Rock',151,'Hail','icy_rock',{},143,'Splash',null,{}]
])test('new equipment AI projection agrees with independent real turn: '+label,()=>{
 const a=mon(id,move,item,extra),b=mon(foeId,foeMove,foeItem,foeExtra),field=engine.createBattleState(),original=JSON.stringify([a,b,field]);
 const ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,damage:(p,q,m,side,s)=>m.ename==='Dragon Rage'?40:engine.estimateDamage(p,q,m,{battleState:s,defenderSide:side})};
 const old=Math.random;Math.random=()=>{throw Error('AI must not consume live battle randomness');};let projected;try{projected=model.project(a,b,engine.getMoveByName(move),engine.getMoveByName(foeMove),ctx,{first});}finally{Math.random=old;}assert.equal(JSON.stringify([a,b,field]),original,'projection mutates live state');
 const own=structuredClone(a),foe=structuredClone(b),s=structuredClone(field);const cast=(p,q,name,side,other)=>{if(p.currentHp>0&&q.currentHp>0)engine.useattack(name,p,q,{battleState:s,attackerSide:side,defenderSide:other,attackerTeam:[p],defenderTeam:[q]});};Math.random=()=>.5;try{if(first){cast(own,foe,move,s.sides.player,s.sides.enemy);cast(foe,own,foeMove,s.sides.enemy,s.sides.player);}else{cast(foe,own,foeMove,s.sides.enemy,s.sides.player);cast(own,foe,move,s.sides.player,s.sides.enemy);}engine.processEndOfRound(own,foe,s.sides.player,s.sides.enemy,s);}finally{Math.random=old;}
 for(const [p,q]of [[own,projected.own],[foe,projected.foe]]){assert(Math.abs(p.currentHp-q.currentHp)<=1,`HP actual ${p.currentHp}, preview ${q.currentHp}`);assert.equal(q.heldItem,p.heldItem);for(const stat of ['attack','defense','specialAttack','specialDefense','speed'])assert.equal(q.__battle.statStages[stat]||0,p.__battle.statStages[stat]||0,stat);}
 assert.deepEqual(projected.field.weather,s.weather);for(const key of ['reflectTurns','lightScreenTurns','auroraVeilTurns'])assert.equal(projected.side.screens[key],s.sides.player.screens[key]);
});

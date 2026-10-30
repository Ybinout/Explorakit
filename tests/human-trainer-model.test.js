const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),model=require('../server/game/battle/humanTrainerModel');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
function mon(id,move,extra={}) {
    const p=factory.create(id,50,true);
    return Object.assign(p,{uuid:`oracle-${id}`,currentHp:400,maxHp:400,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,
        attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,passiveAbility:null,heldItem:null,status:'normal',abilities:[move],movePp:[resources.getMaxMovePp(move)],__battle:{statStages:{},sleepTurns:1}},extra);
}
// Independent oracle: execute the real engine on separate copies with fixed
// non-critical rolls, rather than deriving expected HP from the planner.
for(const [label,id,move,props,foeMove,foeProps,first,weather] of [
    ['Life Orb',68,'Pound',{currentHp:100,heldItem:'life_orb'},'Splash',{},true],
    ['drain before Life Orb',68,'Drain Punch',{currentHp:100,heldItem:'life_orb'},'Splash',{},true],
    ['Chesto Rest',143,'Rest',{currentHp:80,heldItem:'chesto_berry'},'Splash',{},true],
    ['Sitrus activation',143,'Splash',{currentHp:215,heldItem:'sitrus_berry'},'Pound',{},true],
    ['Leftovers',143,'Splash',{currentHp:100,heldItem:'leftovers'},'Splash',{},true],
    ['Shell Bell',68,'Pound',{currentHp:100,heldItem:'shell_bell'},'Splash',{},true],
    ['Focus Sash',65,'Splash',{currentDefense:1,defense:1,heldItem:'focus_sash'},'Close Combat',{currentAttack:999,attack:999},false],
    ['first Protect',143,'Protect',{currentHp:100,heldItem:'leftovers'},'Pound',{},true],
    ['sand immunity',112,'Splash',{currentHp:100},'Splash',{},true,'sandstorm'],
    ['poison with Leftovers',143,'Splash',{currentHp:100,heldItem:'leftovers',status:'poison'},'Splash',{},true],
    ['resistance berry consumption',3,'Splash',{heldItem:'occa_berry'},'Flamethrower',{},true],
    ['Cheek Pouch and Chesto',143,'Rest',{currentHp:80,heldItem:'chesto_berry',passiveAbility:'Cheek Pouch'},'Splash',{},true],
    ['Haze through Substitute',110,'Haze',{__battle:{statStages:{defense:2}}},'Splash',{__battle:{statStages:{attack:4},substituteHp:100}},true],
    ['Rain Dance through Substitute',61,'Rain Dance',{},'Splash',{__battle:{statStages:{},substituteHp:100}},true],
    ['no secondary on an immune target',112,'Mud Shot',{},'Splash',{type1:'Flying'},true],
    ['healing blocked',143,'Recover',{currentHp:100,__battle:{statStages:{},healBlockTurns:2}},'Splash',{},true],
    ['Feint breaks Protect',143,'Feint',{},'Protect',{},false],
    ['Hyperspace Hole bypasses Substitute',143,'Hyperspace Hole',{},'Substitute',{},false],
    ['Purify cures target and heals user',1,'Purify',{currentHp:80},'Splash',{status:'poison'},true],
    ['Purify fails on a healthy target',1,'Purify',{currentHp:80},'Splash',{},true],
    ['Pain Split average',19,'Pain Split',{currentHp:40},'Splash',{currentHp:160},true],
    ['Pain Split rounds down',19,'Pain Split',{currentHp:1},'Splash',{currentHp:200},true],
    ['Pain Split individual caps',19,'Pain Split',{currentHp:10,maxHp:50},'Splash',{currentHp:190},true],
    ['Pain Split at one HP each',19,'Pain Split',{currentHp:1},'Splash',{currentHp:1},true],
    ['Pain Split through Heal Block',19,'Pain Split',{currentHp:40,__battle:{statStages:{},healBlockTurns:3}},'Splash',{currentHp:160,__battle:{statStages:{},healBlockTurns:3}},true],
    ['Pain Split blocked by Substitute',19,'Pain Split',{currentHp:40},'Splash',{currentHp:160,__battle:{statStages:{},substituteHp:100}},true],
    ['Pain Split Infiltrator',19,'Pain Split',{currentHp:40,passiveAbility:'Infiltrator'},'Splash',{currentHp:160,__battle:{statStages:{},substituteHp:100}},true],
    ['Pain Split blocked by Protect',19,'Pain Split',{currentHp:40},'Protect',{currentHp:160},false],
    ['Pain Split not reflected',19,'Pain Split',{currentHp:40},'Magic Coat',{currentHp:160},false],
    ['Pain Split activates both Sitrus berries',19,'Pain Split',{currentHp:1,heldItem:'sitrus_berry'},'Splash',{currentHp:199,heldItem:'sitrus_berry'},true],
    ['Pain Split Ghost target',19,'Pain Split',{currentHp:40},'Splash',{currentHp:160,type1:'Ghost'},true],
    ['Pain Split after damage',19,'Pain Split',{currentHp:80},'Pound',{currentHp:300},false]
]) test(`turn projection agrees with actual item/HP mechanics: ${label}`,()=>{
    const a=mon(id,move,props),b=mon(143,foeMove,foeProps),field=engine.createBattleState();if(weather)field.weather={kind:weather,turns:4};
    const ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,
        damage:(p,q,m,side,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side})};
    const projected=model.project(a,b,engine.getMoveByName(move),engine.getMoveByName(foeMove),ctx,{first});
    const own=structuredClone(a),foe=structuredClone(b),state=structuredClone(field),original=Math.random;
    const cast=(p,q,name,side,otherSide)=>{if(p.currentHp>0&&q.currentHp>0)engine.useattack(name,p,q,{battleState:state,attackerSide:side,defenderSide:otherSide,attackerTeam:[p],defenderTeam:[q]});};
    Math.random=()=>.5;
    try {
        if(first){cast(own,foe,move,state.sides.player,state.sides.enemy);cast(foe,own,foeMove,state.sides.enemy,state.sides.player);}
        else {cast(foe,own,foeMove,state.sides.enemy,state.sides.player);cast(own,foe,move,state.sides.player,state.sides.enemy);}
        engine.processEndOfRound(own,foe,state.sides.player,state.sides.enemy,state);
    }finally{Math.random=original;}
    for(const [actual,preview] of[[own,projected.own],[foe,projected.foe]]) {
        assert(Math.abs(actual.currentHp-preview.currentHp)<=1,`${label}: HP ${preview.currentHp} projected, ${actual.currentHp} actual`);
        assert.equal(preview.heldItem,actual.heldItem);assert.equal(preview.status,actual.status);
        for(const stat of ['attack','defense','specialAttack','specialDefense','speed'])assert.equal(preview.__battle.statStages[stat]||0,actual.__battle.statStages[stat]||0,stat);
        assert.equal(preview.__battle.substituteHp||0,actual.__battle.substituteHp||0);
    }
    assert.equal(projected.field.weather.kind,state.weather.kind);
});

test('Rapid Spin projection clears the correct hazards only after a surviving hit, matching the real engine',()=>{
 for(const condition of ['hit','ghost','contact-ko','protect']) {
  const ghost=condition==='ghost';
  const a=mon(121,'Rapid Spin'),b=mon(ghost?94:143,'Splash'),field=engine.createBattleState();
  if(condition==='contact-ko'){a.currentHp=1;b.passiveAbility='Rough Skin';}
  if(condition==='protect')b.abilities=['Protect'];
  Object.assign(field.sides.player.hazards,{stealthRock:true,spikes:2,toxicSpikes:1,stickyWeb:true});field.sides.enemy.hazards.stealthRock=true;
  const ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,
   damage:(p,q,m,side,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side})};
  const projected=model.project(a,b,engine.getMoveByName('Rapid Spin'),engine.getMoveByName(b.abilities[0]),ctx,{first:condition!=='protect'});
  const actual=structuredClone(field),own=structuredClone(a),foe=structuredClone(b),random=Math.random;Math.random=()=>.5;
  try{
   if(condition==='protect')engine.useattack('Protect',foe,own,{battleState:actual,attackerSide:actual.sides.enemy,defenderSide:actual.sides.player});
   engine.useattack('Rapid Spin',own,foe,{battleState:actual,attackerSide:actual.sides.player,defenderSide:actual.sides.enemy});
  }finally{Math.random=random;}
  assert.deepEqual(projected.side.hazards,actual.sides.player.hazards);
  assert.deepEqual(projected.enemySide.hazards,actual.sides.enemy.hazards);
  assert.equal(Boolean(projected.side.hazards.stealthRock),condition!=='hit');
 }
});

test('Encore projection uses completed move history, prevents a different reply, and expires with the real engine',()=>{
 for(const last of [null,'Recover']) {
  const a=mon(65,'Encore'),b=mon(143,'Body Slam'),field=engine.createBattleState();
  b.abilities.push('Recover');b.movePp.push(resources.getMaxMovePp('Recover'));b.__battle.lastMoveUsed=last;
  const ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,
   damage:(p,q,m,side,state)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side})};
  const projected=model.project(a,b,engine.getMoveByName('Encore'),engine.getMoveByName('Body Slam'),ctx,{first:true});
  const actual=structuredClone(field),own=structuredClone(a),foe=structuredClone(b),random=Math.random;Math.random=()=>.5;
  try {
   for(const [p,q,name,side,otherSide]of[[own,foe,'Encore',actual.sides.player,actual.sides.enemy],[foe,own,'Body Slam',actual.sides.enemy,actual.sides.player]])
    engine.useattack(name,p,q,{battleState:actual,attackerSide:side,defenderSide:otherSide});
   engine.processEndOfRound(own,foe,actual.sides.player,actual.sides.enemy,actual);
  }finally{Math.random=random;}
  assert.equal(projected.foe.__battle.encoreTurns||0,foe.__battle.encoreTurns||0);
  assert.equal(projected.foe.__battle.encoreMove||null,foe.__battle.encoreMove||null);
  if(last)assert.equal(projected.own.currentHp,a.currentHp,'the newly locked foe cannot use Body Slam');
 }
});

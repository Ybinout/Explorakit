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
    ['Purify fails on a healthy target',1,'Purify',{currentHp:80},'Splash',{},true]
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

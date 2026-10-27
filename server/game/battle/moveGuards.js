// Generation 7 exceptions shared by actual combat and the planner's copies.
const {hasAbility,getMoveFlags}=require('../abilities/abilityEngine');
const twoTurn=require('./twoTurnMoves');
function bypassesSubstitute(attacker,move){
    return move?.ename==='Hyperspace Hole'||hasAbility(attacker,'Infiltrator')||Boolean(getMoveFlags(move).sound);
}
function breaksProtection(move){
    return ['Feint','Hyperspace Hole'].includes(move?.ename)||Boolean(twoTurn.rule(move?.ename)?.breaksProtect);
}
function clearProtection(pokemon,side){
    const data=pokemon.__battle;
    let changed=Boolean(data?.protect);
    if(data)data.protect=false;
    for(const key of Object.keys(side?.protectTeam||{})){
        changed ||= side.protectTeam[key]>0;
        side.protectTeam[key]=0;
    }
    if(changed&&data){data.contactDamageFraction=0;data.protectionStreak=0;data.protectionTurn=null;}
    return changed;
}
module.exports={bypassesSubstitute,breaksProtection,clearProtection};

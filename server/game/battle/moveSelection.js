// Selection aid for automated choices only. The engine still validates every real action;
// players retain their moves, PP costs and forced/Choice-item restrictions.
const resources=require('./battleResources');
const {getMoveFlags,getAbilityName}=require('../abilities/abilityEngine');
const FIRST_ACTION=new Set(['Fake Out','First Impression','Mat Block']);
function entryActions(pokemon){
    const data=pokemon.__battle||{};
    return Number.isFinite(data.activeMoveActions)?Math.max(0,data.activeMoveActions):Number(data.lastActionTurn)>0?1:0;
}
function failureReason(pokemon,move,field,{privateKnown=true}={}){
    if(!move)return 'unknown_move';
    const data=pokemon.__battle||{},name=move.ename;
    if(FIRST_ACTION.has(name)&&entryActions(pokemon)>0)return 'first_action_only';
    if(data.tauntTurns>0&&move.combat?.damage_class==='status')return 'taunt';
    if(data.disableTurns>0&&data.disabledMove===name)return 'disabled';
    if(data.encoreTurns>0&&data.encoreMove&&data.encoreMove!==name)return 'encore';
    if(data.soundBlockedTurns>0&&getMoveFlags(move).sound)return 'sound_blocked';
    if(name==='Teleport'&&field?.battleType!=='wild')return 'not_wild';
    if(['Spit Up','Swallow'].includes(name)&&!(data.stockpileCount>0))return 'no_stockpile';
    // Opposing items/abilities are deliberately absent from public snapshots.
    // An unknown item must never be treated as a known empty item slot.
    if(privateKnown){
        const ability=getAbilityName(pokemon);
        if(['Sleep Talk','Snore'].includes(name)&&pokemon.status!=='sleep'&&ability!=='Comatose')return 'not_asleep';
        if(name==='Fling'&&!resources.getItemDefinition(pokemon.heldItem))return 'no_item';
        if(name==='Natural Gift'&&!resources.getItemDefinition(pokemon.heldItem)?.natural_gift_power)return 'no_berry';
        const types=data.tempTypes?.length?data.tempTypes:data.formTypes?.length?data.formTypes:[pokemon.type1,pokemon.type2];
        if(name==='Burn Up'&&!types.includes('Fire')&&ability!=='Protean')return 'not_fire';
    }
    return null;
}
function preferMoves(pokemon,field,indexes=resources.getUsableMoveIndexes(pokemon,field),options){
    if(resources.getForcedMove(pokemon))return indexes;
    const available=indexes.filter(i=>!failureReason(pokemon,resources.getMoveDefinition(pokemon.abilities[i]),field,options));
    // A failed condition does not grant free Struggle while moves still have PP.
    return available.length?available:indexes;
}
module.exports={entryActions,failureReason,preferMoves};

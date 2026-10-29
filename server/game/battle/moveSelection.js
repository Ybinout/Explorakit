// Selection aid for automated choices only. The engine still validates every real action;
// players retain their moves, PP costs and forced/Choice-item restrictions.
const resources=require('./battleResources');
const {getMoveFlags,getAbilityName}=require('../abilities/abilityEngine');
const {redundantReason}=require('./moveRedundancy');
const FIRST_ACTION=new Set(['Fake Out','First Impression','Mat Block']);
function entryActions(pokemon){
    const data=pokemon.__battle||{};
    return Number.isFinite(data.activeMoveActions)?Math.max(0,data.activeMoveActions):Number(data.lastActionTurn)>0?1:0;
}
function failureReason(pokemon,move,field,{privateKnown=true,ownTeam}={}){
    if(!move)return 'unknown_move';
    const data=pokemon.__battle||{},name=move.ename;
    if(FIRST_ACTION.has(name)&&entryActions(pokemon)>0)return 'first_action_only';
    if(data.tauntTurns>0&&move.combat?.damage_class==='status')return 'taunt';
    if(data.disableTurns>0&&data.disabledMove===name)return 'disabled';
    if(data.encoreTurns>0&&data.encoreMove&&data.encoreMove!==name)return 'encore';
    if(data.soundBlockedTurns>0&&getMoveFlags(move).sound)return 'sound_blocked';
    if(name==='Teleport'&&field?.battleType!=='wild'){
        if(!['trainer','arena','pvp'].includes(field?.battleType))return 'unsupported_battle';
        if(ownTeam&&!ownTeam.some(p=>p.uuid!==pokemon.uuid&&p.currentHp>0))return 'no_reserve';
    }
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
function preferMoves(pokemon,field,indexes=resources.getUsableMoveIndexes(pokemon,field),options={}){
    if(resources.getForcedMove(pokemon))return indexes;
    const available=indexes.filter(i=>!failureReason(pokemon,resources.getMoveDefinition(pokemon.abilities[i]),field,options));
    // A failed condition does not grant free Struggle while moves still have PP.
    let pool=available.length?available:indexes;
    if(options.avoidRedundant!==false){const useful=pool.filter(i=>!redundantReason(pokemon,resources.getMoveDefinition(pokemon.abilities[i]),field,options));if(useful.length)pool=useful;}
    if(options.avoidStalePriority){
        const data=pokemon.__battle||{},foe=options.opponent?.__battle||{};
        const forced=foe.encoreTurns>0?resources.getMoveDefinition(foe.encoreMove):null;
        const forcedDamage=forced?.combat?.damage_class!=='status'&&forced!=null||Boolean(foe.rampageMove);
        if(data.lastMoveUsed==='Sucker Punch'&&data.lastMoveFailed&&!forcedDamage){const alternative=pool.filter(i=>pokemon.abilities[i]!=='Sucker Punch');if(alternative.length)pool=alternative;}
    }
    return pool;
}
module.exports={entryActions,failureReason,preferMoves,redundantReason};

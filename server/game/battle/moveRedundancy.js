// Planning aid only. Never changes legality, PP costs or a human command.
const {FIELD_TIMERS,SIDE_TIMERS,ROOMS}=require('./battleField');
const {getAbilityName,ignoresDefenderAbility}=require('../abilities/abilityEngine');
const TARGET_FLAGS={taunt:'tauntTurns',heal_block:'healBlockTurns',embargo:'embargoTurns',torment:'tormented',
    leech_seed:'leechSeedSource',telekinesis:'telekinesisTurns',trap:'trappedTurns',foresight:'foresight',miracle_eye:'miracleEye'};
const OWN_FLAGS={aqua_ring:'aquaRing',ingrain:'ingrain',magnet_rise:'magnetRiseTurns',laser_focus:'laserFocusTurns'};
const PUBLIC_EFFECT_KEYS=[...new Set([...Object.values(TARGET_FLAGS),...Object.values(OWN_FLAGS),
    'confusionTurns','infatuationTurns','lockOnTurns','lockOnTargetId'])];
function publicEffects(data={},own=false) {
    data=data||{};
    const result={};
    for(const key of PUBLIC_EFFECT_KEYS){const value=data[key];if(value===undefined)continue;
        // Presence is public; random remaining confusion/infatuation is not.
        result[key]=!own&&['confusionTurns','infatuationTurns'].includes(key)?Number(value)>0?1:0
            :['string','number','boolean'].includes(typeof value)?value:Boolean(value);
    }
    return result;
}
function redundantReason(pokemon,move,field,{opponent,ownSide,enemySide,incomingDamage=0}={}) {
    if(move?.combat?.damage_class!=='status')return null;
    const own=pokemon.__battle||{},other=opponent?.__battle||{};
    if(move.ename==='Rest')return own.healBlockTurns>0?'no_healing':incomingDamage<=0&&pokemon.currentHp>=pokemon.maxHp&&(!pokemon.status||pokemon.status==='normal')?'already_healthy':null;
    const effects=move.combat.effects||[];if(!effects.length)return null;
    const reasons=effects.map(effect=>{
        const self=(effect.target||move.combat.target)==='self',target=self?pokemon:opponent,data=self?own:other;
        if(effect.kind==='field') {
            if(field?.weather?.kind===effect.field||field?.terrain?.kind===effect.field)return 'field_already_active';
            if(ROOMS.has(effect.field))return null; // These can be deliberately cancelled.
            if(SIDE_TIMERS[effect.field]&&ownSide?.screens?.[SIDE_TIMERS[effect.field]]>0)return 'screen_already_active';
            if(FIELD_TIMERS[effect.field]&&field?.field?.[FIELD_TIMERS[effect.field]]>0)return 'field_already_active';
        }
        if(effect.kind==='hazard') {
            const [key,max]=({stealth_rock:['stealthRock',1],spikes:['spikes',3],toxic_spikes:['toxicSpikes',2],sticky_web:['stickyWeb',1]})[effect.hazard]||[];
            if(key&&Number(enemySide?.hazards?.[key])>=max)return 'hazards_complete';
        }
        // A slower Encore/Disable may catch a move completed earlier this turn.
        if(effect.kind==='encore'&&opponent)return other.encoreTurns>0?'encore_already_active':null;
        if(effect.kind==='disable_last_move'&&opponent)return other.disableTurns>0&&other.disabledMove===other.lastMoveUsed?'already_disabled':null;
        if(TARGET_FLAGS[effect.kind]&&other[TARGET_FLAGS[effect.kind]])return 'effect_already_active';
        if(OWN_FLAGS[effect.kind]&&own[OWN_FLAGS[effect.kind]])return 'effect_already_active';
        if(effect.kind==='wish'&&ownSide?.wish?.turns>0)return 'wish_pending';
        if(effect.kind==='substitute'&&own.substituteHp>0&&incomingDamage<own.substituteHp)return 'substitute_present';
        if(effect.kind==='stockpile'&&own.stockpileCount>=3)return 'stockpile_full';
        if(effect.kind==='lock_on'&&own.lockOnTurns>0&&opponent&&own.lockOnTargetId===opponent.uuid)return 'target_already_locked';
        if(effect.kind==='heal'&&target&&(target.currentHp>=target.maxHp&&(!self||incomingDamage<=0)||data.healBlockTurns>0))return 'no_healing';
        if(effect.kind==='status'&&target){
            if(effect.status==='confusion')return data.confusionTurns>0?'already_confused':null;
            if(effect.status==='infatuation')return data.infatuationTurns>0?'already_infatuated':null;
            if(target.status&&target.status!=='normal')return 'already_statused';
        }
        if(effect.kind==='stat_stage'&&target){
            const stages=Number(data.statStages?.[effect.stat])||0,contrary=getAbilityName(target)==='Contrary'&&!ignoresDefenderAbility(pokemon,target);
            const delta=effect.stages*(contrary?-1:1),limit=effect.stat==='critical'?3:6;
            if(delta>0&&stages>=limit||delta<0&&stages<=-6)return 'stage_at_limit';
        }
        if(effect.kind==='reset_stat_stages'&&opponent&&!Object.values(own.statStages||{}).some(Boolean)&&!Object.values(other.statStages||{}).some(Boolean))return 'no_stages_to_reset';
        return null;
    });
    // Mixed moves remain useful while at least one part can still change things.
    return reasons.every(Boolean)?reasons[0]:null;
}
module.exports={redundantReason,publicEffects};

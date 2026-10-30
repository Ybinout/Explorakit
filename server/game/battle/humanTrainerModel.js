// Deterministic tactical projections, on the planner's sanitized copies only.
// Every opposing action is a hypothesis. No live engine action queue or RNG.
const engine=require('./battleEngine'),resources=require('./battleResources');
const held=require('../items/heldItems'),abilities=require('../abilities/abilityEngine');
const traits=require('../../../data/game/ability_move_traits.gen7.json').moves;
const twoTurn=require('./twoTurnMoves');
const rampage=require('./rampageMoves');
const moveGuards=require('./moveGuards');
const moveDamageRules=require('./moveDamageRules');
const {weatherHealingAmount}=require('./weatherHealing');
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x)),alive=p=>p.currentHp>0;
const ability=p=>abilities.getAbilityName(p);
const types=p=>p.__battle?.tempTypes?.length?p.__battle.tempTypes:p.__battle?.formTypes?.length?p.__battle.formTypes:[p.type1,p.type2].filter(Boolean);
const copy=p=>({...p,abilities:[...(p.abilities||[])],movePp:[...(p.movePp||[])],__battle:{...p.__battle,statStages:{...p.__battle.statStages}}});
const hp=(p,x)=>{p.currentHp=clamp(x,0,p.maxHp);};
const heal=(p,x)=>{if(alive(p)&&!(p.__battle.healBlockTurns>0))hp(p,p.currentHp+Math.max(0,x));};
const grounded=(p,f)=>f.field.gravityTurns>0||p.__battle.grounded||p.__battle.ingrain||(!types(p).includes('Flying')&&ability(p)!=='Levitate');
function consume(p,field,{eaten=true}={}) { const item=p.heldItem,berry=eaten&&item?.endsWith('_berry');p.heldItem=null;p.__battle.consumedHeldItem=item;if(berry&&field){field.berryEaters ||= [];if(!field.berryEaters.includes(p.uuid))field.berryEaters.push(p.uuid);}if(ability(p)==='Unburden')p.__battle.unburden=true;if(berry&&ability(p)==='Cheek Pouch')heal(p,Math.floor(p.maxHp/3)); }
function activate(p,other,field) {
    if(!alive(p)||!held.enabled(p,field))return;
    const item=resources.getItemDefinition(p.heldItem);if(!item)return;
    if(p.heldItem.endsWith('_berry')&&alive(other)&&ability(other)==='Unnerve')return;
    const cures=item.cure||item.fieldUse?.cure||[];
    if(item.battle_effect==='cure_status'&&(cures.includes(p.status)||item.key==='lum_berry'&&p.__battle.confusionTurns>0)) {
        p.status='normal';p.__battle.sleepTurns=0;p.__battle.toxicCounter=1;
        if(item.key==='lum_berry')p.__battle.confusionTurns=0;
        consume(p,field);return;
    }
    if(item.battle_effect==='cure_confusion'&&p.__battle.confusionTurns>0){p.__battle.confusionTurns=0;consume(p,field);return;}
    const limit=ability(p)==='Gluttony'&&item.trigger_hp_ratio===.25?.5:item.trigger_hp_ratio;
    if(p.currentHp/p.maxHp<=limit) {
        if(item.battle_effect==='heal_flat'||item.battle_effect==='heal_fraction') {
            if(p.__battle.healBlockTurns>0)return;
            heal(p,item.battle_effect==='heal_flat'?item.amount:Math.floor(p.maxHp*item.fraction));consume(p,field);
        } else if(item.battle_effect==='stat_berry'&&(p.__battle.statStages[item.stat]||0)<6) {
            engine.applyStageChange(p,item.stat,1,[],p);consume(p,field);
        }
    }
}
function protectionChance(p,field) {
    const d=p.__battle,streak=d.protectionStreak??d.protectStreak??0;
    const consecutive=d.protectionTurn===undefined||d.protectionTurn===field.turn-1;
    return consecutive&&streak>0?1/3**Math.min(streak,6):1;
}
function canStatus(p,status,source,side,field) {
    if(status==='confusion')return !(p.__battle.confusionTurns>0)&&ability(p)!=='Own Tempo';
    if(p.status&&p.status!=='normal')return false;
    if((status==='burn'&&types(p).includes('Fire'))||(status==='paralyze'&&types(p).includes('Electric'))
        ||(['poison','badly_poison'].includes(status)&&types(p).some(t=>['Poison','Steel'].includes(t))&&ability(source)!=='Corrosion'))return false;
    if(side.screens.safeguardTurns>0&&source!==p&&ability(source)!=='Infiltrator')return false;
    if(grounded(p,field)&&(field.terrain.kind==='misty_terrain'||status==='sleep'&&field.terrain.kind==='electric_terrain'))return false;
    const effective=abilities.isWeatherSuppressed(p,source)?{...field,weather:{kind:null}}:field;
    return abilities.ignoresDefenderAbility(source,p)||!abilities.canAbilityBlockStatus(p,status,effective,source);
}
function applyStatus(p,status,source,side,field) {
    if(!canStatus(p,status,source,side,field))return false;
    if(status==='confusion')p.__battle.confusionTurns=2;
    else {p.status=status;if(status==='sleep')p.__battle.sleepTurns=2;if(status==='badly_poison')p.__battle.toxicCounter=1;}
    activate(p,source,field);return true;
}
function damageTarget(p,amount,source,move,field) {
    const before=p.currentHp,sub=p.__battle.substituteHp||0;
    if(sub>0&&!moveGuards.bypassesSubstitute(source,move)) {
        p.__battle.substituteHp=Math.max(0,sub-amount);return {hp:0,total:Math.min(sub,amount)};
    }
    const hits=traits[move.ename]?.multihit;
    const multiple=Array.isArray(hits)||Number(hits)>1;
    if(amount>=before&&before===p.maxHp&&!multiple&&(held.effect(p,field)==='focus_sash'
        ||ability(p)==='Sturdy'&&!abilities.ignoresDefenderAbility(source,p))) {
        amount=before-1;if(held.effect(p,field)==='focus_sash')consume(p,field);
    }
    hp(p,before-amount);const lost=before-p.currentHp;
    if(lost>0){p.__battle.lastHurtTurn=field.turn;p.__battle.lastDamageTaken=lost;p.__battle.lastDamageClass=move.combat.damage_class;
        p.__battle.lastDamageTurn=field.turn;p.__battle.lastDamageSource=source.uuid;}
    return {hp:lost,total:lost};
}
function actionAvailability(p,move) {
    if(p.__battle.soundBlockedTurns>0&&abilities.getMoveFlags(move).sound)return 0;
    if(p.__battle.rechargeMove||ability(p)==='Truant'&&p.__battle.loafing)return 0;
    if(p.status==='sleep'&&!['Sleep Talk','Snore'].includes(move.ename)&&ability(p)!=='Comatose')return 1-.65*(p.__battle.projectedStatusChance??1);
    if(p.status==='freeze')return .2;
    return p.status==='paralyze'?1-.25*(p.__battle.projectedStatusChance??1):1;
}
function cast(p,other,move,reply,side,otherSide,state,ctx,guard,{alreadyMoved=false}={}) {
    const before=rampage.current(p);
    const result=castMove(p,other,move,reply,side,otherSide,state,ctx,guard,{alreadyMoved});
    rampage.finish(p,move?.ename,{before,hit:result.inflicted>0,random:()=>.5,
        confuse:()=>{engine.applyStatus(p,'confusion',side,[],{attacker:p,battleState:state,ignoreSafeguard:true,turns:2});activate(p,other,state);}});
    return result;
}
function castMove(p,other,move,reply,side,otherSide,state,ctx,guard,{alreadyMoved=false}={}) {
    if(!alive(p)||!alive(other)||!move)return {useful:false,accuracy:0};
    if(move.combat.damage_class==='status'&&p.__battle.tauntTurns>0)return {useful:false,accuracy:0};
    if(p.__battle.encoreTurns>0&&p.__battle.encoreMove&&p.__battle.encoreMove!==move.ename)return {useful:false,accuracy:0};
    const availability=actionAvailability(p,move),hitChance=ctx.chance(move,p,other,state)*availability;
    if(!availability)return {useful:false,accuracy:0};
    if(engine.movePhase(p,move.ename,state,other)==='prepare'){const rule=twoTurn.rule(move.ename);p.__battle.chargeMove=move.ename;p.__battle.chargeTurns=1;if(rule?.state)p.__battle.semiInvulnerable=rule.state;return {useful:true,recognized:true,accuracy:hitChance};}
    const flags=abilities.getMoveFlags(move),damaging=move.combat.damage_class!=='status',wasSubstitute=other.__battle.substituteHp>0;
    let useful=false,inflicted=0,painSplitApplied=false,recognized=damaging||move.ename==='Rest';
    const slot=p.abilities.indexOf(move.ename);if(slot>=0&&!rampage.current(p))p.movePp[slot]=Math.max(0,(p.movePp[slot]??1)-1);
    p.__battle.lastMoveUsed=move.ename;
    if(held.effect(p,state)?.startsWith('choice_'))p.__battle.choiceMove ||= move.ename;
    const failure=moveDamageRules.failure(move,p,other,state,{types});
    p.__battle.usedMoves=(p.__battle.usedMoves||[]).filter(name=>p.abilities.includes(name));if(p.abilities.includes(move.ename)&&!p.__battle.usedMoves.includes(move.ename))p.__battle.usedMoves.push(move.ename);
    if(failure){p.__battle.lastMoveFailed=true;p.__battle.lastMoveResultTurn=state.turn;return {useful:false,recognized:true,accuracy:hitChance,inflicted:0};}
    if(damaging) {
        let resolved=engine.resolveWeatherMove(move,p,other,state);
        if(state.field.ionDelugeTurns>0&&resolved.type==='Normal')resolved={...resolved,type:'Electric'};
        resolved=abilities.transformMoveForAbility(p,resolved).move;
        const effectiveness=engine.getMoveEffectiveness(resolved,p,other,state);
        const blocked=abilities.resolveMoveAbilityImmunity({attacker:p,defender:other,move:resolved,battleState:state,effectiveness,
            movePriority:engine.getMovePriority(move.ename,p),heal,changeStage:(target,stat,n)=>engine.applyStageChange(target,stat,n,[],target)});
        let raw=blocked?0:ctx.damage(p,other,move,otherSide,state,{movedLast:alreadyMoved});
        if(move.ename==='Sucker Punch'&&(!reply||(reply.combat.damage_class==='status'&&reply.ename!=='Me First')||alreadyMoved||other.__battle.rechargeMove))raw=0;
        if(['Fake Out','First Impression'].includes(move.ename)&&p.__battle.activeMoveActions>0)raw=0;
        if(move.ename==='False Swipe')raw=Math.min(raw,Math.max(0,other.currentHp-1));
        if(move.ename==='Focus Punch'&&p.__battle.lastDamageTurn===state.turn&&p.__battle.lastDamageTaken>0)raw=0;
        if(moveGuards.breaksProtection(move)&&raw>0&&hitChance>0){guard.delete(other);moveGuards.clearProtection(other,otherSide);}
        const guardChance=moveGuards.breaksProtection(move)?0:guard.get(other)||0;
        const hit=damageTarget(other,raw*hitChance*(1-guardChance),p,move,state);
        inflicted=hit.total;useful=inflicted>0;
        if(inflicted>0&&['Fling','Natural Gift'].includes(move.ename))consume(p,state,{eaten:false});
        if(moveDamageRules.CRASH_MOVES.has(move.ename)&&ability(p)!=='Magic Guard') {
            const crashChance=Math.max(0,availability-(raw>0?hitChance*(1-guardChance):0));
            hp(p,p.currentHp-Math.max(1,Math.floor(p.maxHp/2))*crashChance);
        }
        if(move.ename==='Knock Off'&&hit.hp>0)engine.knockOffHeldItem(p,other);
        const item=resources.getItemDefinition(other.heldItem);
        if(hit.hp>0&&held.effect(other,state)==='type_resist'&&item.resist_type===resolved.type
            &&(effectiveness>1||resolved.type==='Normal')&&ability(p)!=='Unnerve')consume(other,state);
        if(hit.hp>0&&other.status===moveDamageRules.curedStatus(move)){other.status='normal';other.__battle.sleepTurns=0;other.__battle.nightmare=false;}
        if(hit.hp>0&&flags.contact&&ability(p)!=='Long Reach'&&ability(p)!=='Magic Guard') {
            let recoil=0;if(['Rough Skin','Iron Barbs'].includes(ability(other)))recoil+=p.maxHp/8;
            if(held.effect(other,state)==='rocky_helmet')recoil+=p.maxHp/6;
            hp(p,p.currentHp-recoil*hitChance);
        }
        if(move.ename==='Rapid Spin'&&inflicted>0&&alive(p)) {
            for(const key of Object.keys(side.hazards))side.hazards[key]=typeof side.hazards[key]==='boolean'?false:0;
            p.__battle.trappedTurns=0;p.__battle.leechSeedSource=null;
        }
        const drain=traits[move.ename]?.drain;
        if(drain&&inflicted>0) {
            const amount=inflicted*drain[0]/drain[1];
            if(ability(other)==='Liquid Ooze'&&ability(p)!=='Magic Guard')hp(p,p.currentHp-amount);else heal(p,amount);
        }
        if(move.ename==='Fake Out'&&hit.hp>0&&!alreadyMoved&&(abilities.ignoresDefenderAbility(p,other)||!['Inner Focus','Shield Dust'].includes(ability(other)))&&ability(p)!=='Sheer Force')guard.set(p,1);
        if(inflicted>0) {
            if(held.effect(p,state)==='life_orb'&&ability(p)!=='Magic Guard'&&!(ability(p)==='Sheer Force'&&flags.secondary))hp(p,p.currentHp-Math.floor(p.maxHp/10));
            if(held.effect(p,state)==='shell_bell')heal(p,Math.floor(inflicted/8));
            if(flags.recoil&&ability(p)!=='Magic Guard'&&ability(p)!=='Rock Head')hp(p,p.currentHp-inflicted*flags.recoil[0]/flags.recoil[1]);
            
            const drops={'Close Combat':{defense:-1,specialDefense:-1},Superpower:{attack:-1,defense:-1},Overheat:{specialAttack:-2},'Leaf Storm':{specialAttack:-2},'Draco Meteor':{specialAttack:-2},'Psycho Boost':{specialAttack:-2}};
            for(const[stat,delta]of Object.entries(drops[move.ename]||{}))engine.applyStageChange(p,stat,delta,[],p);
            if(flags.recharge||['Hyper Beam','Giga Impact'].includes(move.ename))p.__battle.rechargeMove=move.ename;
        }
    }
    if(['Explosion','Self-Destruct','Final Gambit'].includes(move.ename))hp(p,0);
    if(move.ename==='Struggle'&&inflicted>0)hp(p,p.currentHp-Math.max(1,Math.floor(p.maxHp/4)));
    if(move.ename==='Rest') {
        const old=p.status;p.status='normal';
        if(old!=='sleep'&&p.currentHp<p.maxHp&&canStatus(p,'sleep',p,side,state)&&!(p.__battle.healBlockTurns>0)) {
            heal(p,p.maxHp);p.status='sleep';p.__battle.sleepTurns=3;useful=true;
        } else p.status=old;
    } else for(const effect of move.combat.effects||[]) {
        const self=['self','self_side'].includes(effect.target||move.combat.target),target=self?p:other;
        if(effect.kind==='pain_split') {
            recognized=true;
            const noGuard=ability(p)==='No Guard'||ability(other)==='No Guard'&&!abilities.ignoresDefenderAbility(p,other);
            const locked=p.__battle.lockOnTurns>0&&p.__battle.lockOnTargetId===other.uuid;
            const reachable=!other.__battle.semiInvulnerable||noGuard||locked;
            const probability=hitChance*(1-(guard.get(other)||0));
            if(probability>0&&reachable&&(!wasSubstitute||moveGuards.bypassesSubstitute(p,move))
                &&!abilities.resolveMoveAbilityImmunity({attacker:p,defender:other,move,battleState:state,
                    movePriority:engine.getMovePriority(move.ename,p),grounded:grounded(other,state),effectiveness:1})) {
                const average=Math.max(1,Math.floor((p.currentHp+other.currentHp)/2));
                const ownChange=Math.min(p.maxHp,average)-p.currentHp,foeChange=Math.min(other.maxHp,average)-other.currentHp;
                // HP redistribution bypasses Heal Block and is not direct damage:
                // no Focus Sash, Life Orb, drain or contact reaction is involved.
                hp(p,p.currentHp+ownChange*probability);hp(other,other.currentHp+foeChange*probability);
                painSplitApplied=true;useful=ownChange!==0||foeChange!==0;
            }
        }
        if(effect.kind==='curse') {
            recognized=true;
            if(types(p).includes('Ghost')) {
                if(!other.__battle.curseSource){hp(p,p.currentHp-Math.max(1,Math.floor(p.maxHp/2)));other.__battle.curseSource=true;useful=true;}
            } else for(const[stat,delta]of [['speed',-1],['attack',1],['defense',1]]) {
                const old=p.__battle.statStages[stat]||0;
                engine.applyStageChange(p,stat,delta,[],p);
                if(old!==p.__battle.statStages[stat])useful=true;
            }
        }
        if(['protect','heal','stat_stage','status','substitute','taunt','leech_seed','reset_stat_stages'].includes(effect.kind))recognized=true;
        if(!self&&['status','stat_stage','taunt','leech_seed'].includes(effect.kind)
            &&(damaging&&inflicted<=0||wasSubstitute&&ability(p)!=='Infiltrator'&&!flags.sound))continue;
        if(effect.kind==='protect') {guard.set(p,protectionChance(p,state)*availability);useful=true;}
        if(effect.kind==='heal'&&self&&p.currentHp<p.maxHp&&!(p.__battle.healBlockTurns>0)) {
            const amount=weatherHealingAmount(move,p,other,state)
                ?? p.maxHp*(effect.mode==='full'?1:effect.fraction||.5);
            heal(p,amount*availability);useful=true;
        }
        if(effect.kind==='stat_stage'&&effect.target!=='opponent_contact'&&(effect.chance==null||effect.chance===1)) {
            const old=target.__battle.statStages[effect.stat]||0;
            const stages=effect.stages*(move.ename==='Growth'&&state.weather.kind==='sun'&&!abilities.isWeatherSuppressed(p,other)?2:1);
            engine.applyStageChange(target,effect.stat,stages,[],p);
            if((target.__battle.statStages[effect.stat]||0)!==old)useful=true;
        }
        if(effect.kind==='status'&&!self&&hitChance>0&&!(guard.get(other)>0)&&(effect.chance==null||effect.chance===1)
            && !(move.ename==='Thunder Wave'&&types(other).includes('Ground'))) {
            if(applyStatus(other,effect.status,p,otherSide,state)){useful=true;other.__battle.projectedStatusChance=hitChance;}
        }
        if(effect.kind==='substitute'&&!(p.__battle.substituteHp>0)&&p.currentHp>Math.floor(p.maxHp*.25)) {
            const cost=Math.floor(p.maxHp*.25);hp(p,p.currentHp-cost);p.__battle.substituteHp=cost;useful=true;
        }
        if(effect.kind==='taunt'&&!(other.__battle.tauntTurns>0)&&ability(other)!=='Oblivious'&&ability(other)!=='Aroma Veil') {other.__battle.tauntTurns=3;useful=true;}
        if(effect.kind==='encore') {
            recognized=true;
            if(other.__battle.lastMoveUsed&&!(other.__battle.encoreTurns>0)&&ability(other)!=='Aroma Veil'
                &&hitChance>0&&!(guard.get(other)>0)&&(!wasSubstitute||moveGuards.bypassesSubstitute(p,move))) {
                other.__battle.encoreMove=other.__battle.lastMoveUsed;
                other.__battle.encoreTurns=effect.turns||3;useful=true;
            }
        }
        if(effect.kind==='leech_seed'&&!other.__battle.leechSeedSource&&!types(other).includes('Grass')) {other.__battle.leechSeedSource=true;useful=true;}
        if(effect.kind==='reset_stat_stages') {for(const t of[p,other]){if(Object.values(t.__battle.statStages).some(Boolean))useful=true;t.__battle.statStages={};}}
        if(effect.kind==='hazard') {
            recognized=true;
            const key={stealth_rock:'stealthRock',spikes:'spikes',toxic_spikes:'toxicSpikes',sticky_web:'stickyWeb'}[effect.hazard];
            const max=key==='spikes'?3:key==='toxicSpikes'?2:1;
            if(key&&(otherSide.hazards[key]||0)<max){otherSide.hazards[key]=(otherSide.hazards[key]||0)+1;useful=true;}
        }
        if(effect.kind==='laser_focus'){recognized=true;p.__battle.laserFocusTurns=2;useful=true;}
        if(effect.kind==='sound_block'&&inflicted>0&&ability(p)!=='Sheer Force'&&ability(other)!=='Shield Dust'){recognized=true;other.__battle.soundBlockedTurns=2;useful=true;}
        if(effect.kind==='strength_sap'){recognized=true;if((other.__battle.statStages.attack||0)>-6&&!(p.__battle.healBlockTurns>0)){const amount=other.attack*((other.__battle.statStages.attack||0)>=0?(2+(other.__battle.statStages.attack||0))/2:2/(2-(other.__battle.statStages.attack||0)));engine.applyStageChange(other,'attack',-1,[],p);if(ability(other)==='Liquid Ooze'){if(ability(p)!=='Magic Guard')hp(p,p.currentHp-amount);}else heal(p,amount);useful=true;}}
        if(effect.kind==='purify'){
            recognized=true;
            if(['burn','poison','badly_poison','paralyze','sleep','freeze'].includes(other.status)&&!(p.__battle.healBlockTurns>0)&&!(guard.get(other)>0)&&(!wasSubstitute||moveGuards.bypassesSubstitute(p,move))){
                other.status='normal';other.__battle.sleepTurns=0;other.__battle.toxicCounter=1;heal(p,Math.ceil(p.maxHp/2));useful=true;
            }
        }
        if(effect.kind==='field') {
            const key={reflect:'reflectTurns',aurora_veil:'auroraVeilTurns',light_screen:'lightScreenTurns',tailwind:'tailwindTurns',safeguard:'safeguardTurns'}[effect.field];
            if(key){recognized=true;if(!(side.screens[key]>0)&&(effect.field!=='aurora_veil'||state.weather.kind==='hail')){side.screens[key]=5;useful=true;}}
            if(['rain','sun','hail','sandstorm'].includes(effect.field)){recognized=true;if(state.weather.kind!==effect.field){state.weather={kind:effect.field,turns:5};useful=true;}}
            const room={trick_room:'trickRoomTurns',magic_room:'magicRoomTurns',wonder_room:'wonderRoomTurns'}[effect.field];
            if(room){recognized=true;state.field[room]=state.field[room]>0?0:5;useful=true;}
            if(['grassy_terrain','electric_terrain','misty_terrain','psychic_terrain'].includes(effect.field)){recognized=true;if(state.terrain.kind!==effect.field){state.terrain={kind:effect.field,turns:5};useful=true;}}
        }
    }
    if(p.__battle.chargeMove===move.ename){p.__battle.chargeMove=null;p.__battle.chargeTurns=0;p.__battle.semiInvulnerable=null;}
    if(move.ename==='Burn Up'&&inflicted>0){p.__battle.tempTypes=types(p).filter(t=>t!=='Fire');if(!p.__battle.tempTypes.length)p.__battle.tempTypes=['???'];}
    p.__battle.lastMoveFailed=move.ename==='Pain Split'?!painSplitApplied:!useful&&!(guard.get(other)>0);p.__battle.lastMoveResultTurn=state.turn;
    activate(p,other,state);activate(other,p,state);
    p.__battle.activeMoveActions=(p.__battle.activeMoveActions||0)+1;
    return {useful,recognized,accuracy:hitChance,inflicted};
}
function endTurn(p,other,state,{switched=false}={}) {
    if(!alive(p))return;
    const magic=ability(p)==='Magic Guard',poisoned=['poison','badly_poison'].includes(p.status);
    if(poisoned&&ability(p)==='Poison Heal')heal(p,p.maxHp/8);
    else if(!magic) {
        if(p.status==='burn')hp(p,p.currentHp-Math.max(1,Math.floor(p.maxHp/(ability(p)==='Heatproof'?32:16))));
        if(p.status==='poison')hp(p,p.currentHp-Math.floor(p.maxHp/8));
        if(p.status==='badly_poison'){hp(p,p.currentHp-Math.floor(p.maxHp*(p.__battle.toxicCounter||1)/16));p.__battle.toxicCounter=(p.__battle.toxicCounter||1)+1;}
    }
    if(alive(p)&&!magic&&p.__battle.leechSeedSource){const loss=Math.min(p.currentHp,Math.floor(p.maxHp/8));hp(p,p.currentHp-loss);heal(other,loss);}
    if(alive(p)&&!magic&&p.__battle.curseSource)hp(p,p.currentHp-Math.max(1,Math.floor(p.maxHp/4)));
    if(!abilities.isWeatherSuppressed(p,other)) {
        const weather=state.weather.kind;
        if(!magic&&weather==='sandstorm'&&!types(p).some(t=>['Rock','Ground','Steel'].includes(t))&&!['Overcoat','Sand Rush','Sand Veil','Sand Force'].includes(ability(p)))hp(p,p.currentHp-Math.floor(p.maxHp/16));
        if(!magic&&weather==='hail'&&!types(p).includes('Ice')&&!['Overcoat','Ice Body','Snow Cloak','Slush Rush'].includes(ability(p)))hp(p,p.currentHp-Math.floor(p.maxHp/16));
        if(weather==='rain'&&ability(p)==='Rain Dish'||weather==='hail'&&ability(p)==='Ice Body')heal(p,Math.floor(p.maxHp/16));
        if(weather==='rain'&&ability(p)==='Dry Skin')heal(p,Math.floor(p.maxHp/8));
        if(weather==='sun'&&['Dry Skin','Solar Power'].includes(ability(p)))hp(p,p.currentHp-Math.floor(p.maxHp/8));
    }
    if(held.effect(p,state)==='end_turn_heal')heal(p,Math.floor(p.maxHp*(resources.getItemDefinition(p.heldItem).fraction||1/16)));
    if(state.terrain.kind==='grassy_terrain'&&grounded(p,state))heal(p,Math.floor(p.maxHp/16));
    if(alive(p)&&ability(p)==='Speed Boost'&&!switched)engine.applyStageChange(p,'speed',1,[],p);
    activate(p,other,state);
}
function project(a,b,move,reply,ctx,{switched=false,first=true,ownSwitched=false}={}) {
    const own=copy(a),foe=copy(b),field={...ctx.field,...(Array.isArray(ctx.field.berryEaters)?{berryEaters:[...ctx.field.berryEaters]}:{}),weather:{...ctx.field.weather},terrain:{...ctx.field.terrain},field:{...ctx.field.field},sides:{}};
    for(const key of ['player','enemy']){const side=ctx.field.sides[key];field.sides[key]={...side,screens:{...side.screens},hazards:{...side.hazards},protectTeam:{...side.protectTeam},wish:side.wish?{...side.wish}:null};}
    const side=ctx.ownSide===ctx.field.sides.player?field.sides.player:field.sides.enemy,enemySide=side===field.sides.player?field.sides.enemy:field.sides.player;
    const guard=new Map();let action={useful:false,accuracy:1},response={useful:false,accuracy:1};
    if(first) {action=cast(own,foe,move,reply,side,enemySide,field,ctx,guard);if(!switched)response=cast(foe,own,reply,move,enemySide,side,field,ctx,guard,{alreadyMoved:true});}
    else {if(!switched)response=cast(foe,own,reply,move,enemySide,side,field,ctx,guard);action=cast(own,foe,move,reply,side,enemySide,field,ctx,guard,{alreadyMoved:true});}
    endTurn(own,foe,field,{switched:ownSwitched});endTurn(foe,own,field,{switched});
    for(const p of[own,foe])for(const key of['laserFocusTurns','soundBlockedTurns','encoreTurns'])if(p.__battle[key]>0)p.__battle[key]--;
    for(const group of[field.field,side.screens,enemySide.screens])for(const key of Object.keys(group))if(key.endsWith('Turns')&&group[key]>0)group[key]--;
    for(const group of[field.weather,field.terrain])if(group.turns>0&&--group.turns===0)group.kind=null;
    field.turn++;
    const health=100*((own.currentHp-a.currentHp)/Math.max(1,a.maxHp))*.9+100*((b.currentHp-foe.currentHp)/Math.max(1,b.maxHp));
    const score=health+(!alive(foe)?100:0)-(!alive(own)?150:0);
    return {own,foe,field,side,enemySide,score,action,response};
}
module.exports={project,protectionChance,activate,endTurn,copy,types};

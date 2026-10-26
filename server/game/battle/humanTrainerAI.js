// Open-team-sheet trainer AI. It knows species and moves, not a submitted action.
// All evaluation runs on snapshots; the orchestrators commit before prompting.
const engine = require('./battleEngine');
const resources = require('./battleResources');
const legacy = require('../drift/colosseumAI');
const model = require('./humanTrainerModel');
const { getMoveFlags, transformMoveForAbility, getAbilityAccuracyMultiplier, ignoresDefenderAbility, resolveMoveAbilityImmunity } = require('../abilities/abilityEngine');
const { createDeterministicRandom } = require('../abilities/abilityDex');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ratio = (n, p) => 100 * n / Math.max(1, p.maxHp);
const moveByName = engine.getMoveByName;
const species = new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
const traits = require('../../../data/game/ability_move_traits.gen7.json');
const forms = traits.forms;
const damageCaches = new WeakMap();
const moveCaches = new WeakMap();
const speedCaches = new WeakMap();
const FIXED_DAMAGE = {'Dragon Rage':40,'Sonic Boom':20};
const LEVEL_DAMAGE = new Set(['Seismic Toss','Night Shade']);
const PUBLIC_VOLATILES = ['statStages','tempTypes','formTypes','abilityForm','tauntTurns','disableTurns',
    'disabledMove','encoreTurns','encoreMove','leechSeedSource','foresight','miracleEye','substituteHp',
    'trappedTurns','ingrain','chargeMove','chargeTurns','semiInvulnerable','rechargeMove','bideTurns',
    'activeMoveActions','laserFocusTurns','soundBlockedTurns','lastMoveFailed','lastMoveResultTurn','protectStreak','protectionStreak','protectionTurn','transformed','transformSpeciesId','transformSpriteId'];
const OWN_VOLATILES = [...PUBLIC_VOLATILES,'sleepTurns','choiceMove','unburden','abilitySuppressed','flashFireBoost','healBlockTurns',
    'embargoTurns','confusionTurns','infatuationTurns','toxicCounter','activeTurns','loafing','stockpileCount','consumedHeldItem',
    'lastDamageTaken','lastDamageTurn','lastDamageSource','lastDamageClass','lastActionTurn','protectionStreak','protectionTurn','grounded'];
const STATS=['attack','defense','specialAttack','specialDefense','speed','accuracy','evasion','critical'];
function battleView(data={},own=false) {
    const view={statStages:{}};
    for(const stat of STATS)if(Number.isFinite(data.statStages?.[stat]))view.statStages[stat]=data.statStages[stat];
    for(const key of own?OWN_VOLATILES:PUBLIC_VOLATILES) {
        if(key==='statStages')continue;
        const value=data[key];
        if(key==='leechSeedSource'){view[key]=Boolean(value);continue;}
        if(['tempTypes','formTypes'].includes(key)){if(Array.isArray(value))view[key]=value.filter(x=>typeof x==='string').slice(0,2);continue;}
        if(value===null||['string','number','boolean'].includes(typeof value))view[key]=value;
    }
    return view;
}

function publicPokemon(p) {
    const disguise=p.__battle?.illusion?.id || p.__battle?.transformSpeciesId;
    const visible=species.get(disguise || p.data.id),form=!disguise&&forms[p.__battle?.abilityForm];
    const base=form?{HP:form.stats.hp,Attack:form.stats.atk,Defense:form.stats.def,'Sp. Attack':form.stats.spa,'Sp. Defense':form.stats.spd,Speed:form.stats.spe}:visible.base;
    const visibleTypes=disguise?visible.type:model.types(p),level=p.level;
    const scaling=clamp(p.maxHp/((2*base.HP+30)*level/100+level+10),.5,4);
    const stat=key=>Math.max(1,Math.floor(((2*base[key]+30)*level/100+5)*scaling));
    const view={uuid:p.uuid,level,currentHp:p.currentHp,maxHp:p.maxHp,status:p.status,
        type1:visibleTypes[0],type2:visibleTypes[1],data:{id:visible.id,type:[...visibleTypes]},
        attack:stat('Attack'),defense:stat('Defense'),specialAttack:stat('Sp. Attack'),specialDefense:stat('Sp. Defense'),speed:stat('Speed')};
    // Moves and team composition are deliberately public; PP, items, abilities,
    // IV/EV and exact combat stats are not consulted on the opposing team.
    view.abilities = [...(p.abilities || [])].filter(name => moveByName(name)).slice(0,4);
    view.movePp = view.abilities.map(resources.getMaxMovePp);
    view.__battle=battleView(p.__battle);
    view.__battle.sleepTurns = 1; // Never sample hidden sleep duration while evaluating.
    return view;
}
function ownPokemon(p) {
    const view={uuid:p.uuid,level:p.level,maxHp:p.maxHp,currentHp:p.currentHp,status:p.status,type1:p.type1,type2:p.type2,
        data:{id:p.data.id,type:p.__battle?.tempTypes?.length?p.__battle.tempTypes:p.__battle?.formTypes?.length?p.__battle.formTypes:[p.type1,p.type2].filter(Boolean)},
        attack:p.currentAttack??p.attack,defense:p.currentDefense??p.defense,specialAttack:p.currentSpecialAttack??p.specialAttack,
        specialDefense:p.currentSpecialDefense??p.specialDefense,speed:p.currentSpeed??p.speed,
        passiveAbility:p.passiveAbility,heldItem:p.heldItem,__battle:battleView(p.__battle,true)};
    view.abilities = [...p.abilities]; view.movePp = [...(p.movePp || p.abilities.map(resources.getMaxMovePp))];
    view.__battle.sleepTurns ??= 1;
    return view;
}
function publicField(field) {
    // In particular: no turnActions, trainerTeam, callbacks or pending payloads.
    const result = engine.createBattleState();
    result.turn=field.turn;
    for(const key of ['weather','terrain','field'])for(const name of Object.keys(result[key]||{})) {
        const value=field[key]?.[name];if(value===null||['string','number','boolean'].includes(typeof value))result[key][name]=value;
    }
    for (const side of ['player','enemy']) {
        const source = field.sides?.[side] || {};
        for(const key of ['screens','hazards','protectTeam'])for(const name of Object.keys(result.sides[side][key])) {
            const value=source[key]?.[name];if(['number','boolean'].includes(typeof value))result.sides[side][key][name]=value;
        }
        if(source.wish)result.sides[side].wish={turns:Number(source.wish.turns)||0,healAmount:Number(source.wish.healAmount)||0};
    }
    return result;
}
function moves(p, field) {
    let cache=moveCaches.get(field);if(!cache){cache=new WeakMap();moveCaches.set(field,cache);}
    if(cache.has(p))return cache.get(p);
    const forced = resources.getForcedMove(p);
    if (forced) return [{number:p.abilities.indexOf(forced), move:moveByName(forced)}].filter(x=>x.move);
    let legal = legacy.legalIndexes(p, field);
    const unblocked=legal.filter(i=>!(p.__battle.soundBlockedTurns>0 && getMoveFlags(moveByName(p.abilities[i])).sound));
    if(unblocked.length)legal=unblocked;
    const result=legal.length ? legal.map(number=>({number,move:moveByName(p.abilities[number])})) : [{number:-1,move:moveByName('Struggle')}];
    cache.set(p,result);return result;
}
function resetEntry(p) { return {...p,__battle:{statStages:{},sleepTurns:1}}; }
function chance(move,a,b,field) {
    const accuracy=engine.weatherMoveAccuracy(move,a,b,field);
    const stage=n=>n>=0?(2+n)/2:2/(2-n);
    const ability=getAbilityAccuracyMultiplier(a,b,move,field);
    if(accuracy<=0||ability===Infinity)return 1;
    const base=move.combat?.power_type==='ohko'?(a.level<b.level?0:(30+a.level-b.level)/100)
        :move.combat?.damage_class==='status'&&b.passiveAbility==='Wonder Skin'&&!ignoresDefenderAbility(a,b) ? .5 : accuracy/100;
    return clamp(base*stage(a.__battle.statStages?.accuracy||0)/stage(b.__battle.statStages?.evasion||0)*ability
        *(field.field?.gravityTurns>0&&move.combat?.power_type!=='ohko'?5/3:1),0,1);
}
// Every analysis owns immutable public snapshots and a private field copy.
// Repeated priority/support evaluations can share speed for that exact snapshot,
// while new turns, changed weather and hypothetical boosted Pokémon get new keys.
function speed(pokemon, side, field) {
    let cache=speedCaches.get(field);
    if(!cache){cache=new WeakMap();speedCaches.set(field,cache);}
    let sides=cache.get(pokemon);
    if(!sides){sides=new Map();cache.set(pokemon,sides);}
    if(!sides.has(side))sides.set(side,engine.getBattleSpeed(structuredClone(pokemon),side,field));
    return sides.get(side);
}
function actsFirst(a,m,b,r,ctx) {
    const priority=engine.getMovePriority(m.ename,a)-engine.getMovePriority(r.ename,b);
    if(priority)return priority>0;
    const delta=speed(a,ctx.ownSide,ctx.field)-speed(b,ctx.enemySide,ctx.field);
    return ctx.field.field.trickRoomTurns>0?delta<0:delta>=0;
}
function damage(a,b,move,side,field) {
    if(!move || move.combat?.damage_class==='status')return 0;
    if(['Fake Out','First Impression'].includes(move.ename)&&a.__battle.activeMoveActions>0)return 0;
    let cache=damageCaches.get(field);if(!cache){cache={ids:new WeakMap(),next:0,values:new Map()};damageCaches.set(field,cache);}
    for(const p of [a,b])if(!cache.ids.has(p))cache.ids.set(p,++cache.next);
    const key=`${cache.ids.get(a)}:${cache.ids.get(b)}:${move.ename}:${side===field.sides.player?'p':'e'}`;
    if(!cache.values.has(key)) {
        let resolved=engine.resolveWeatherMove(move,a,b,field);
        if(field.field?.ionDelugeTurns>0&&resolved.type==='Normal')resolved={...resolved,type:'Electric'};
        const preview=model.copy(a),target=model.copy(b);
        let special=null;
        if(resolved.combat?.power_type==='special_case') {
            special=move.ename==='Psywave'?{fixedDamage:Math.max(1,a.level)}:move.ename==='Magnitude'?{power:71}
                :move.ename==='Present'?{power:52}:engine.getSpecialMoveResolution(resolved,preview,target,{battleState:field});
            if(special?.power!==undefined)resolved={...resolved,power:special.power};
        }
        const transformed=transformMoveForAbility(preview,resolved);
        const effectiveness=model.types(target).reduce((n,t)=>n*engine.getEffectiveness(transformed.move.type,t),1);
        const blocked=resolveMoveAbilityImmunity({attacker:preview,defender:target,move:transformed.move,battleState:field,
            effectiveness,movePriority:engine.getMovePriority(move.ename,preview)});
        const fixed=special?.fixedDamage ?? FIXED_DAMAGE[move.ename] ?? (LEVEL_DAMAGE.has(move.ename)?Math.max(1,a.level):null);
        if(fixed!==null) {
            const types=b.__battle?.tempTypes?.length?b.__battle.tempTypes:b.__battle?.formTypes?.length?b.__battle.formTypes:[b.type1,b.type2];
            const immune=types.filter(Boolean).some(type=>engine.getEffectiveness(transformed.move.type,type)===0
                && !(type==='Ghost'&&['Normal','Fighting'].includes(transformed.move.type)
                    && (b.__battle?.foresight || (a.passiveAbility==='Scrappy'&&!a.__battle?.abilitySuppressed))));
            cache.values.set(key,immune||blocked?0:fixed);
        } else {
            const hits=traits.moves[move.ename]?.multihit;
            const count=move.ename==='Water Shuriken'&&a.__battle.abilityForm==='Greninja-Ash'?3:Number.isInteger(hits)?hits:Array.isArray(hits)
                ?(a.passiveAbility==='Skill Link'?hits[1]:hits[0]===2&&hits[1]===5?3.1:(hits[0]+hits[1])/2):1;
            cache.values.set(key,blocked||special?.failMessage||special?.unsupported||special?.statusOnly?0:count*engine.estimateDamage(preview,target,transformed.move,{battleState:field,defenderSide:side,abilityPowerMultiplier:transformed.powerMultiplier}));
        }
    }
    return cache.values.get(key);
}
function weighted(list, temperature=22) {
    const best=Math.max(...list.map(x=>x.score));
    const weights=list.map(x=>Math.exp(clamp((x.score-best)/temperature,-12,0)));
    const sum=weights.reduce((a,b)=>a+b,0);
    return list.map((x,i)=>({...x,probability:weights[i]/sum}));
}
function attackValue(a,b,m,ctx,side=ctx.enemySide) {
    const hit=damage(a,b,m,side,ctx.field), flags=getMoveFlags(m);
    let value=ratio(Math.min(hit,b.currentHp),b)*chance(m,a,b,ctx.field);
    if(hit>=b.currentHp)value+=55*chance(m,a,b,ctx.field);
    if(flags.charge&&!resources.getForcedMove(a))value*=.52;
    if(flags.recharge)value*=.72;
    if(flags.selfdestruct || ['Explosion','Self-Destruct'].includes(m.ename))value-=ratio(a.currentHp,a)*.85;
    return value;
}
function support(a,b,move,ctx,incoming,bestDamage) {
    const helpers={damage,speed,
        accuracy:(m,x,y)=>chance(m,x,y,ctx.field),before:actsFirst};
    let score=Math.max(legacy.supportScore(a,b,move,ctx,incoming,bestDamage),
        require('../drift/colosseumTactics').supportScore(a,b,move,ctx,incoming,bestDamage,helpers));
    for(const e of move.combat?.effects || []) {
        if(e.kind==='hazard' && ctx.foeCount>1) {
            const key={stealth_rock:'stealthRock',spikes:'spikes',toxic_spikes:'toxicSpikes',sticky_web:'stickyWeb'}[e.hazard];
            if(key && !ctx.enemySide.hazards?.[key] && incoming<a.currentHp*.65)score=Math.max(score,b.maxHp*.13*Math.min(4,ctx.foeCount));
        }
        if(e.kind==='protect' && !(model.protectionChance(a,ctx.field)<1) && (['poison','badly_poison','burn'].includes(b.status)||a.heldItem==='leftovers'))
            score=Math.max(score,incoming*.6+b.maxHp*.1);
        if(e.kind==='substitute' && !a.__battle.substituteHp && a.currentHp>a.maxHp*.55 && incoming<a.maxHp*.15)
            score=Math.max(score,b.maxHp*.25);
    }
    return score<=-999?-100:ratio(score,b);
}
function context(a,b,team,field,ownSide,enemySide,foeCount) {
    const attacks=moves(a,field).map(x=>x.move).filter(m=>m.combat?.damage_class!=='status');
    const replies=moves(b,field).map(x=>x.move).filter(m=>m.combat?.damage_class!=='status');
    return {field,ownSide,enemySide,attacks,replies,party:team.filter(p=>p.currentHp>0).map(p=>({...p,moves:moves(p,field).map(x=>x.move).filter(m=>m.power>0)})),
        observed:{moves:b.abilities},moveByName,foeCount};
}
function canSwitch(p,field) {return !p.__battle.trappedTurns&&!p.__battle.ingrain&&!p.__battle.chargeTurns&&!p.__battle.bideTurns&&!p.__battle.rechargeMove&&!field.field.fairyLockTurns;}
function orderChance(a,move,b,reply,ctx) {
    const priority=engine.getMovePriority(move.ename,a)-engine.getMovePriority(reply.ename,b);
    if(priority)return priority>0?1:0;
    if(speed(a,ctx.ownSide,ctx.field)===speed(b,ctx.enemySide,ctx.field))return .5;
    return actsFirst(a,move,b,reply,ctx)?1:0;
}
function knownIneffective(a,b,move,ctx) {
    return ctx.memory?.seen?.[b.uuid]?.immuneMoves?.includes(move.ename)
        || (move.combat?.damage_class!=='status' && (move.power>0 || FIXED_DAMAGE[move.ename] || LEVEL_DAMAGE.has(move.ename)) && damage(a,b,move,ctx.enemySide,ctx.field)===0);
}
function finishingPressure(a,b,ctx) {
    // A player who can finish the active trainer has little reason to leave.
    // Only visible moves/stages/status and inferred stats are used, never the
    // submitted command, private stats, reserve order or hidden item/ability.
    if(b.__battle.rechargeMove)return 0;
    let pressure=0;
    for(const reply of ctx.replies) {
        if(reply.ename==='False Swipe'||engine.movePhase(b,reply.ename,ctx.field,a)==='prepare')continue;
        const hit=damage(b,a,reply,ctx.ownSide,ctx.field);
        if(hit<a.currentHp)continue;
        let prevented=0;
        for(const move of ctx.attacks)if(!knownIneffective(a,b,move,ctx)
            && move.ename!=='False Swipe'
            && engine.movePhase(a,move.ename,ctx.field,b)!=='prepare'
            && damage(a,b,move,ctx.enemySide,ctx.field)>=b.currentHp) {
            prevented=Math.max(prevented,orderChance(a,move,b,reply,ctx)*chance(move,a,b,ctx.field));
        }
        let reliable=chance(reply,b,a,ctx.field)*(1-prevented);
        if(b.status==='paralyze')reliable*=.75;
        if(b.status==='sleep')reliable*=.4;
        if(b.status==='freeze')reliable*=.2;
        if(reply.ename==='Sucker Punch')reliable*=.7;
        if(['Explosion','Self-Destruct'].includes(reply.ename))reliable*=.65;
        pressure=Math.max(pressure,reliable);
    }
    return pressure;
}
function forecast(a,foes,ctx,memory,skill=1) {
    const b=foes[0],reverse=context(b,a,foes,ctx.field,ctx.enemySide,ctx.ownSide,ctx.party.length);
    const ownBest=Math.max(0,...ctx.attacks.map(m=>damage(a,b,m,ctx.enemySide,ctx.field)));
    const enemyBest=Math.max(0,...reverse.attacks.map(m=>damage(b,a,m,ctx.ownSide,ctx.field)));
    const attacks=weighted(moves(b,ctx.field).map(({move})=>{
        let score=move.combat?.damage_class==='status'?support(b,a,move,reverse,ownBest,enemyBest):attackValue(b,a,move,reverse,ctx.ownSide);
        const count=memory.habits?.moves?.[b.uuid]?.[move.ename]||0;
        score+=Math.min(9,count*2); // Historical preference, never the pending move.
        return {kind:'attack',target:b,move,score};
    }));
    const reserves=canSwitch(b,ctx.field)?foes.slice(1).map(resetEntry).map(target=>{
        const cost=legacy.entryDamage(target,ctx.enemySide,ctx.field);
        const threatened=Math.max(0,...ctx.attacks.map(m=>damage(a,target,m,ctx.enemySide,ctx.field)));
        const offense=Math.max(0,...moves(target,ctx.field).map(x=>damage(target,a,x.move,ctx.ownSide,ctx.field)));
        return {kind:'change',target,score:ratio(ownBest,b)-ratio(threatened+cost,target)+.35*ratio(offense-enemyBest,a)};
    }).filter(x=>x.target.currentHp>legacy.entryDamage(x.target,ctx.enemySide,ctx.field)):[];
    if(!reserves.length || resources.getForcedMove(b)) return attacks;
    const advantage=Math.max(...reserves.map(x=>x.score));
    const history=memory.habits||{},rate=(history.switches||0)/Math.max(1,history.turns||0);
    // Never assumes a switch is certain. A risky prediction can be called out.
    const baseline=clamp((.06+Math.max(0,advantage)*.004+(rate-.2)*.18)*(.4+.6*clamp(skill,0,1)),.03,.58);
    // Habits cannot outweigh a credible immediate KO. Keep a small uncertainty
    // rather than reading the player's actual choice or predicting certainty.
    const switchChance=Math.max(.005,baseline*(1-.94*ctx.finishingPressure));
    return [...attacks.map(x=>({...x,probability:x.probability*(1-switchChance)})),
        ...weighted(reserves,20).map(x=>({...x,probability:x.probability*switchChance}))];
}
function futureValue(out,ctx) {
    const {own:a,foe:b,field,side,enemySide}=out;
    if(a.currentHp<=0||b.currentHp<=0)return 0;
    const next={...ctx,field,ownSide:side,enemySide};
    const replies=moves(b,field).map(x=>x.move).filter(m=>m.combat.damage_class!=='status');
    const threat=Math.max(0,...replies.map(m=>damage(b,a,m,side,field)*chance(m,b,a,field)));
    let best=-40;
    for(const {move}of moves(a,field)) {
        if(move.combat.damage_class==='status'||ctx.memory?.seen?.[b.uuid]?.immuneMoves?.includes(move.ename))continue;
        const amount=damage(a,b,move,enemySide,field),accuracy=chance(move,a,b,field);
        const canFinish=amount>=b.currentHp&&replies.every(reply=>actsFirst(a,move,b,reply,next));
        let value=ratio(Math.min(amount,b.currentHp),b)*accuracy+(canFinish?35*accuracy:0)
            -ratio(Math.min(threat,a.currentHp),a)*(canFinish?1-accuracy:.6);
        if(getMoveFlags(move).charge&&!resources.getForcedMove(a))value*=.52;
        if(a.__battle.rechargeMove)value=-ratio(Math.min(threat,a.currentHp),a);
        best=Math.max(best,value);
    }
    return best;
}
function scoreMove(a,move,scenario,ctx,lookahead=false) {
    if(['Fake Out','First Impression'].includes(move.ename) && a.__battle.activeMoveActions>0)return -240;
    const b=scenario.target,switched=scenario.kind==='change',reply=scenario.move;
    const local=context(a,b,ctx.party,ctx.field,ctx.ownSide,ctx.enemySide,ctx.foeCount);
    const incoming=switched?0:damage(b,a,reply,ctx.ownSide,ctx.field)*chance(reply,b,a,ctx.field);
    const knownImmune=ctx.memory?.seen?.[b.uuid]?.immuneMoves?.includes(move.ename);
    if(knownImmune)return -240;
    const first=switched?1:orderChance(a,move,b,reply,ctx),projectionContext={...ctx,damage,chance};
    function evaluate(before) {
        const out=model.project(a,b,move,reply,projectionContext,{switched,first:before});
        let score=out.score;
        if(out.own.currentHp<=0)return score;
        if(out.foe.currentHp<=0)score-=100*(1-out.action.accuracy);
        score-=(1-out.action.accuracy)*ratio(Math.min(incoming,a.currentHp),a)*.7;
        if(move.combat.damage_class==='status') {
            const utility=support(a,b,move,local,incoming,Math.max(0,...local.attacks.map(m=>damage(a,b,m,ctx.enemySide,ctx.field))));
            if(!out.action.recognized)score+=Math.max(-35,utility)*.6;
            else if(!out.action.useful)score-=25;
            else if(utility>0) {
                const kinds=(move.combat.effects||[]).map(e=>e.kind);
                const continuing=kinds.includes('field')?.85:kinds.some(k=>['hazard','taunt','leech_seed'].includes(k))?.6:.15;
                score+=utility*continuing;
            }
        }
        if(out.own.status==='sleep'&&a.status!=='sleep')score-=30;
        if((!b.status||b.status==='normal')&&out.foe.status!=='normal')score+=12*(out.action.accuracy??1);
        if((out.own.__battle.substituteHp||0)>(a.__battle.substituteHp||0))score+=ratio(out.own.__battle.substituteHp-(a.__battle.substituteHp||0),a)*.65;
        if(lookahead)score+=futureValue(out,ctx)*.4;
        return score;
    }
    return first===1?evaluate(true):first===0?evaluate(false):evaluate(true)*first+evaluate(false)*(1-first);
}
function analyse({team,opponentTeam,field,ownSide,enemySide,memory={},round=1,skill=1}) {
    const own=team.map(ownPokemon),foes=opponentTeam.filter(p=>p.currentHp>0&&!p.isEgg).map(publicPokemon);
    if(!own[0]||!foes[0])return {candidates:[],predictions:[]};
    const safe=publicField(field);
    const os=ownSide===field.sides?.player?safe.sides.player:safe.sides.enemy;
    const es=enemySide===field.sides?.enemy?safe.sides.enemy:safe.sides.player;
    const a=own[0],b=foes[0],ctx=context(a,b,own.filter(p=>p.currentHp>0),safe,os,es,foes.length);
    ctx.memory=memory;
    ctx.finishingPressure=finishingPressure(a,b,ctx);
    const scenarios=forecast(a,foes,ctx,memory,skill);
    // All legal hypotheses get a first-turn projection. A fixed three-branch
    // beam extends the most probable ones; no wall-clock budget or live RNG.
    const deeper=new Set([...scenarios].sort((x,y)=>y.probability-x.probability).slice(0,3));
    const aggregate=scores=>scores.reduce((v,x,i)=>v+x*scenarios[i].probability,0)*.88+Math.min(...scores)*.12;
    const canAffectCurrent=ctx.attacks.some(move=>!knownIneffective(a,b,move,ctx)&&damage(a,b,move,es,safe)>0);
    const candidates=moves(a,safe).map(({number,move})=>{
        let score=aggregate(scenarios.map(s=>scoreMove(a,move,s,ctx,deeper.has(s))));
        // When every stay-in line looks lost, their flat terminal score used to
        // make even a tiny switch scenario dominate. Don't throw an immune hit
        // while a live-target attack exists just to chase that unlikely escape.
        if(canAffectCurrent && ctx.finishingPressure && knownIneffective(a,b,move,ctx))score-=40*ctx.finishingPressure;
        return {action:'attack',number,score};
    });
    if(canSwitch(a,safe)&&(round-(memory.lastSwitchRound??-10)>1||ctx.finishingPressure>=.75))for(let number=1;number<own.length;number++) {
        const p=resetEntry(own[number]);if(p.currentHp<=0)continue;
        const cost=legacy.entryDamage(p,os,safe);if(cost>=p.currentHp)continue;
        const currentThreat=Math.max(0,...ctx.replies.map(m=>damage(b,a,m,os,safe)));
        const currentOffense=Math.max(0,...ctx.attacks.map(m=>damage(a,b,m,es,safe)));
        const nextOffense=Math.max(0,...moves(p,safe).map(x=>damage(p,b,x.move,es,safe)));
        if(!currentThreat&&!currentOffense&&!nextOffense)continue;
        const entered=model.copy(p);entered.currentHp-=cost;
        const score=aggregate(scenarios.map(s=>{
            const out=model.project(entered,s.target,null,s.move,{...ctx,damage,chance},{switched:s.kind==='change',first:false,ownSwitched:true});
            if(out.own.currentHp<=0)return -240;
            const offense=deeper.has(s)?futureValue(out,ctx):0;
            // The reserve spends this turn entering. Recovery on departure is
            // useful but never reads the opposing held item or selected move.
            const recovery=a.passiveAbility==='Regenerator'?ratio(Math.min(a.maxHp-a.currentHp,a.maxHp/3),a)*.5:0;
            const cure=a.passiveAbility==='Natural Cure'&&a.status&&a.status!=='normal'?12:0;
            const repeatPenalty=round-(memory.lastSwitchRound??-10)<=1?15:0;
            return out.score+.65*offense-ratio(cost,p)-12-repeatPenalty+recovery+cure;
        }));
        candidates.push({action:'change',number,score});
    }
    candidates.sort((x,y)=>y.score-x.score||x.number-y.number);
    return {candidates,predictions:scenarios.map(s=>({action:s.kind,pokemonUuid:s.target.uuid,move:s.move?.ename,probability:s.probability})),skill};
}
function chooseAction(options) {
    const {team,field,memory={},round=1,skill=1}=options;
    if(resources.getForcedMove(team[0]))return {action:'attack',number:resources.getUsableMoveIndexes(team[0],field)[0]};
    const {candidates}=analyse(options);if(!candidates.length)return {action:'attack',number:-1};
    const best=candidates[0];
    // Mix only credible close choices. No intentional throw, arbitrary immunity
    // attack or second lottery when an invalid player command is retried.
    const shortlist=candidates.filter(c=>c.score>=best.score-(1.5+2.5*(1-clamp(skill,0,1))));
    const random=createDeterministicRandom(`human-ai:${team[0].uuid}:${round}:${memory.decisions||0}`);
    const roll=random(),distribution=weighted(shortlist,1.5);let total=0,selected=best;
    for(const candidate of distribution){total+=candidate.probability;if(roll<total){selected=candidate;break;}}
    return {action:selected.action,number:selected.number};
}
// A free replacement is chosen from the board after a completed KO. Never
// inspect a pending human replacement; if both actives fainted, retain order.
function chooseReplacement({team,opponentTeam,field,ownSide,enemySide,memory={},round=1,skill=1}) {
    const indexes=team.map((p,i)=>p.currentHp>0&&!p.isEgg?i:-1).filter(i=>i>=0);
    if(indexes.length<2||!opponentTeam[0]||opponentTeam[0].currentHp<=0)return indexes[0]??-1;
    const safe=publicField(field),side=ownSide===field.sides.player?safe.sides.player:safe.sides.enemy;
    let selected=indexes[0],best=-Infinity;
    for(const index of indexes) {
        const candidate=resetEntry(ownPokemon(team[index])),cost=legacy.entryDamage(candidate,side,safe);
        candidate.currentHp-=cost;if(candidate.currentHp<=0)continue;
        const result=analyse({team:[candidate],opponentTeam,field,ownSide,enemySide,memory,round,skill});
        const value=(result.candidates[0]?.score??-240)-ratio(cost,candidate);
        if(value>best){best=value;selected=index;}
    }
    return selected;
}
function observeTurn(memory, beforeUuid, after, action, moveName) {
    const h=memory.habits ||= {turns:0,switches:0,moves:{}};h.turns=Math.min(1000,h.turns+1);
    if(action==='change')h.switches=Math.min(1000,h.switches+1);
    if(action==='attack'&&moveByName(moveName)) observeMove(memory,beforeUuid,moveName);
    // Called once both choices are locked, never while deliberating. No stored
    // target or command can revise the current decision. Visible moves are
    // counted separately by observeMove after their actual execution.
    memory.decisions=(memory.decisions||0)+1;
}
function observeMove(memory,uuid,moveName) {
    const h=memory.habits ||= {turns:0,switches:0,moves:{}};
    const entry=h.moves[uuid] ||= {};entry[moveName]=Math.min(20,(entry[moveName]||0)+1);
}
module.exports={chooseAction,analyse,observeTurn,observeMove,publicField,publicPokemon,chooseReplacement};

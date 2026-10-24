// Open-team-sheet trainer AI. It knows species and moves, not a submitted action.
// All evaluation runs on snapshots; the orchestrators commit before prompting.
const engine = require('./battleEngine');
const resources = require('./battleResources');
const legacy = require('../drift/colosseumAI');
const { getMoveFlags } = require('../abilities/abilityEngine');
const { createDeterministicRandom } = require('../abilities/abilityDex');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ratio = (n, p) => 100 * n / Math.max(1, p.maxHp);
const moveByName = engine.getMoveByName;
const damageCaches = new WeakMap();
const moveCaches = new WeakMap();
const PUBLIC_VOLATILES = ['statStages','tempTypes','formTypes','abilityForm','tauntTurns','disableTurns',
    'disabledMove','encoreTurns','encoreMove','leechSeedSource','foresight','miracleEye','substituteHp',
    'trappedTurns','ingrain','chargeMove','chargeTurns','semiInvulnerable','rechargeMove','bideTurns',
    'activeMoveActions','protectStreak'];

function publicPokemon(p) {
    const view = legacy.observedView(p);
    view.data.id = p.__battle?.illusion?.id || p.data.id;
    // Moves and team composition are deliberately public; PP, items, abilities,
    // IV/EV and exact combat stats are not consulted on the opposing team.
    view.abilities = [...(p.abilities || [])].filter(name => moveByName(name)).slice(0,4);
    view.movePp = view.abilities.map(resources.getMaxMovePp);
    for (const key of PUBLIC_VOLATILES) if (p.__battle?.[key] !== undefined)
        view.__battle[key] = structuredClone(p.__battle[key]);
    view.__battle.sleepTurns = 1; // Never sample hidden sleep duration while evaluating.
    return view;
}
function ownPokemon(p) {
    const view = legacy.ownView(p);
    view.abilities = [...p.abilities]; view.movePp = [...(p.movePp || p.abilities.map(resources.getMaxMovePp))];
    view.__battle.sleepTurns ??= 1;
    return view;
}
function publicField(field) {
    // In particular: no turnActions, trainerTeam, callbacks or pending payloads.
    const result = engine.createBattleState();
    for (const key of ['turn','weather','terrain','field']) if (field[key] !== undefined) result[key] = structuredClone(field[key]);
    for (const side of ['player','enemy']) {
        const source = field.sides?.[side] || {};
        for (const key of ['screens','hazards','protectTeam','wish']) if (source[key]) result.sides[side][key] = structuredClone(source[key]);
    }
    return result;
}
function moves(p, field) {
    let cache=moveCaches.get(field);if(!cache){cache=new WeakMap();moveCaches.set(field,cache);}
    if(cache.has(p))return cache.get(p);
    const forced = resources.getForcedMove(p);
    if (forced) return [{number:p.abilities.indexOf(forced), move:moveByName(forced)}].filter(x=>x.move);
    const legal = legacy.legalIndexes(p, field);
    const result=legal.length ? legal.map(number=>({number,move:moveByName(p.abilities[number])})) : [{number:-1,move:moveByName('Struggle')}];
    cache.set(p,result);return result;
}
function resetEntry(p) { return {...p,__battle:{statStages:{},sleepTurns:1}}; }
function chance(move,a,b,field) {
    if (a.passiveAbility==='No Guard' || b.passiveAbility==='No Guard') return 1;
    const accuracy=engine.weatherMoveAccuracy(move,a,b,field);
    const stage=n=>n>=0?(3+n)/3:3/(3-n);
    return accuracy<=0?1:clamp(accuracy/100*stage(a.__battle.statStages?.accuracy||0)/stage(b.__battle.statStages?.evasion||0),.05,1);
}
function actsFirst(a,m,b,r,ctx) {
    const priority=engine.getMovePriority(m.ename,a)-engine.getMovePriority(r.ename,b);
    if(priority)return priority>0;
    const delta=engine.getBattleSpeed(structuredClone(a),ctx.ownSide,ctx.field)-engine.getBattleSpeed(structuredClone(b),ctx.enemySide,ctx.field);
    return ctx.field.field.trickRoomTurns>0?delta<0:delta>=0;
}
function damage(a,b,move,side,field) {
    if(!move || move.combat?.damage_class==='status')return 0;
    if(move.ename==='Fake Out'&&a.__battle.activeMoveActions>0)return 0;
    let cache=damageCaches.get(field);if(!cache){cache={ids:new WeakMap(),next:0,values:new Map()};damageCaches.set(field,cache);}
    for(const p of [a,b])if(!cache.ids.has(p))cache.ids.set(p,++cache.next);
    const key=`${cache.ids.get(a)}:${cache.ids.get(b)}:${move.ename}:${side===field.sides.player?'p':'e'}`;
    if(!cache.values.has(key))cache.values.set(key,engine.estimateDamage(a,b,move,{battleState:field,defenderSide:side}));
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
    const helpers={damage,speed:(p,side,field)=>engine.getBattleSpeed(structuredClone(p),side,field),
        accuracy:(m,x,y)=>chance(m,x,y,ctx.field),before:actsFirst};
    let score=Math.max(legacy.supportScore(a,b,move,ctx,incoming,bestDamage),
        require('../drift/colosseumTactics').supportScore(a,b,move,ctx,incoming,bestDamage,helpers));
    for(const e of move.combat?.effects || []) {
        if(e.kind==='hazard' && ctx.foeCount>1) {
            const key={stealth_rock:'stealthRock',spikes:'spikes',toxic_spikes:'toxicSpikes',sticky_web:'stickyWeb'}[e.hazard];
            if(key && !ctx.enemySide.hazards?.[key] && incoming<a.currentHp*.65)score=Math.max(score,b.maxHp*.13*Math.min(4,ctx.foeCount));
        }
        if(e.kind==='protect' && !(a.__battle.protectStreak>0) && (['poison','badly_poison','burn'].includes(b.status)||a.heldItem==='leftovers'))
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
    const switchChance=clamp((.06+Math.max(0,advantage)*.004+(rate-.2)*.18)*(.4+.6*clamp(skill,0,1)),.03,.58);
    return [...attacks.map(x=>({...x,probability:x.probability*(1-switchChance)})),
        ...weighted(reserves,20).map(x=>({...x,probability:x.probability*switchChance}))];
}
function scoreMove(a,move,scenario,ctx) {
    if(move.ename==='Fake Out' && a.__battle.activeMoveActions>0)return -130;
    const b=scenario.target,switched=scenario.kind==='change',reply=scenario.move;
    const local=context(a,b,ctx.party,ctx.field,ctx.ownSide,ctx.enemySide,ctx.foeCount);
    const incoming=switched?0:damage(b,a,reply,ctx.ownSide,ctx.field)*chance(reply,b,a,ctx.field);
    const first=switched||actsFirst(a,move,b,reply,ctx);
    const damaging=move.combat?.damage_class!=='status';
    const sucker=move.ename==='Sucker Punch';
    const fails=sucker&&(switched||reply?.combat?.damage_class==='status'||!first);
    const knownImmune=ctx.memory?.seen?.[b.uuid]?.immuneMoves?.includes(move.ename);
    if(knownImmune)return -110;
    const hit=fails?0:damage(a,b,move,ctx.enemySide,ctx.field);
    let score=damaging?(fails?-12:attackValue(a,b,move,ctx)):support(a,b,move,local,incoming,Math.max(0,...local.attacks.map(m=>damage(a,b,m,ctx.enemySide,ctx.field))));
    const lethal=first&&damaging&&!fails&&hit>=b.currentHp;
    if(!first&&incoming>=a.currentHp)return -110;
    const fakeOut=move.ename==='Fake Out'&&!(a.__battle.activeMoveActions>0)&&first;
    const heal=(move.combat?.effects||[]).find(e=>e.kind==='heal'&&e.target==='self');
    const restored=heal?Math.min(a.maxHp-a.currentHp,a.maxHp*(heal.mode==='full'?1:heal.fraction||.5)):0;
    const blocked=(move.combat?.effects||[]).some(e=>e.kind==='protect')&&!(a.__battle.protectStreak>0);
    const suffered=blocked?0:incoming;
    score-=ratio(Math.min(a.currentHp,suffered),a)*(lethal?1-chance(move,a,b,ctx.field):fakeOut?0:.8);
    if(!lethal&&suffered>=a.currentHp+(first?restored:0)&&!fakeOut)score-=45;
    if(move.ename==='Rest')score-=20; // Two sleeping turns are a real opportunity cost.
    if(damaging&&hit>0&&!fails) {
        // A small bounded follow-up rewards lasting position, not just raw damage.
        const remaining=Math.max(0,b.currentHp-hit);
        const future=Math.max(0,...local.attacks.map(m=>damage(a,b,m,ctx.enemySide,ctx.field)));
        if(a.currentHp>incoming)score+=.2*ratio(Math.min(remaining,future),b);
    }
    return score;
}
function analyse({team,opponentTeam,field,ownSide,enemySide,memory={},round=1,skill=1}) {
    const own=team.map(ownPokemon),foes=opponentTeam.filter(p=>p.currentHp>0&&!p.isEgg).map(publicPokemon);
    if(!own[0]||!foes[0])return {candidates:[],predictions:[]};
    const safe=publicField(field);
    const os=ownSide===field.sides?.player?safe.sides.player:safe.sides.enemy;
    const es=enemySide===field.sides?.enemy?safe.sides.enemy:safe.sides.player;
    const a=own[0],b=foes[0],ctx=context(a,b,own.filter(p=>p.currentHp>0),safe,os,es,foes.length);
    ctx.memory=memory;
    const scenarios=forecast(a,foes,ctx,memory,skill);
    const aggregate=scores=>scores.reduce((v,x,i)=>v+x*scenarios[i].probability,0)*.88+Math.min(...scores)*.12;
    const candidates=moves(a,safe).map(({number,move})=>({action:'attack',number,score:aggregate(scenarios.map(s=>scoreMove(a,move,s,ctx)))}));
    if(canSwitch(a,safe)&&round-(memory.lastSwitchRound??-10)>1)for(let number=1;number<own.length;number++) {
        const p=resetEntry(own[number]);if(p.currentHp<=0)continue;
        const cost=legacy.entryDamage(p,os,safe);if(cost>=p.currentHp)continue;
        const currentThreat=Math.max(0,...ctx.replies.map(m=>damage(b,a,m,os,safe)));
        const currentOffense=Math.max(0,...ctx.attacks.map(m=>damage(a,b,m,es,safe)));
        const nextOffense=Math.max(0,...moves(p,safe).map(x=>damage(p,b,x.move,es,safe)));
        if(!currentThreat&&!currentOffense&&!nextOffense)continue;
        const score=aggregate(scenarios.map(s=>{
            const target=s.target,incoming=s.kind==='change'?0:damage(target,p,s.move,os,safe)*chance(s.move,target,p,safe);
            if(cost+incoming>=p.currentHp)return -125;
            const follow=context(p,target,own,safe,os,es,foes.length);follow.memory=memory;
            const reply=moves(target,safe).map(x=>x.move).sort((x,y)=>damage(target,p,y,os,safe)-damage(target,p,x,os,safe))[0];
            const offense=Math.max(0,...moves(p,safe).map(x=>scoreMove(p,x.move,{kind:'attack',target,move:reply},follow)));
            return .65*offense-ratio(incoming+cost,p)-12;
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
    const shortlist=candidates.filter(c=>c.score>=best.score-(3+4*clamp(skill,0,1)));
    const random=createDeterministicRandom(`human-ai:${team[0].uuid}:${round}:${memory.decisions||0}`);
    const roll=random(),distribution=weighted(shortlist,3);let total=0,selected=best;
    for(const candidate of distribution){total+=candidate.probability;if(roll<total){selected=candidate;break;}}
    return {action:selected.action,number:selected.number};
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
module.exports={chooseAction,analyse,observeTurn,observeMove,publicField,publicPokemon};

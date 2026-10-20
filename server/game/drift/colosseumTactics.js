// Extra utility evaluations for the v5 circuit only. Inputs are copies of the
// NPC's own team and the rival's public/revealed information.
function supportScore(a,b,move,ctx,incoming,bestDamage,{damage,speed,accuracy,before}) {
    if (bestDamage>=b.currentHp || incoming>=a.currentHp && !ctx.replies.every(r=>before(a,move,b,r,ctx))) return -1000;
    const healthy=a.currentHp>incoming*1.5, stages=b.__battle?.statStages || {};
    let score=-1000;
    for(const effect of move.combat?.effects || []) {
        if(effect.kind==='stat_stage' && effect.target==='self' && ['defense','specialDefense'].includes(effect.stat)
            && effect.stages>0 && healthy && (a.__battle?.statStages?.[effect.stat] || 0)<4) {
            const raised=structuredClone(a);raised.__battle.statStages ||= {};
            raised.__battle.statStages[effect.stat]=Math.min(6,(raised.__battle.statStages[effect.stat] || 0)+effect.stages);
            const after=Math.max(0,...ctx.replies.map(m=>damage(b,raised,m,ctx.ownSide,ctx.field)));
            if(after<incoming)score=Math.max(score,(incoming-after)*2.5+a.maxHp*.03);
        }
        if(effect.kind==='reset_stat_stages') {
            const boosts=Object.entries(stages).reduce((n,[key,v])=>n+(key==='critical'?0:Math.max(0,v)),0);
            const ownBoosts=Object.values(a.__battle?.statStages || {}).reduce((n,v)=>n+Math.max(0,v),0);
            if(boosts>=2) score=Math.max(score,b.maxHp*.2*boosts-a.maxHp*.12*ownBoosts);
        }
        if(effect.kind==='taunt' && !b.__battle?.tauntTurns && healthy && ctx.observed?.moves.some(name=>ctx.moveByName(name)?.combat?.damage_class==='status'))
            score=Math.max(score,b.maxHp*.4*accuracy(move,a,b));
        if(effect.kind==='leech_seed' && !b.__battle?.leechSeedSource && ![b.type1,b.type2].includes('Grass') && healthy && b.currentHp>bestDamage*2)
            score=Math.max(score,b.maxHp*.42*accuracy(move,a,b));
        if(effect.kind!=='field')continue;
        const screen={reflect:['reflectTurns','physical'],light_screen:['lightScreenTurns','special']}[effect.field];
        if(screen && !(ctx.ownSide.screens?.[screen[0]]>1) && healthy) {
            const danger=Math.max(0,...ctx.replies.filter(m=>m.combat?.damage_class===screen[1]).map(m=>damage(b,a,m,ctx.ownSide,ctx.field)));
            if(danger>a.maxHp*.07)score=Math.max(score,danger*1.4+a.maxHp*.035*Math.min(4,ctx.party.length));
        }
        if(effect.field==='tailwind' && !(ctx.ownSide.screens?.tailwindTurns>0) && healthy
            && speed(b,ctx.enemySide,ctx.field)>speed(a,ctx.ownSide,ctx.field))
            score=Math.max(score,b.maxHp*.32+incoming*.3);
        if(['rain','sun'].includes(effect.field) && ctx.field.weather?.kind!==effect.field && healthy) {
            const field=structuredClone(ctx.field);field.weather={kind:effect.field,turns:5};
            const gain=p=>Math.max(0,...p.moves.map(m=>damage(p,b,m,ctx.enemySide,field)))
                - Math.max(0,...p.moves.map(m=>damage(p,b,m,ctx.enemySide,ctx.field)));
            const activeGain=Math.max(0,...ctx.attacks.map(m=>damage(a,b,m,ctx.enemySide,field)))-bestDamage;
            const teamGain=ctx.party.reduce((sum,p)=>sum+gain(p),0)/ctx.party.length;
            const incomingAfter=Math.max(0,...ctx.replies.map(m=>damage(b,a,m,ctx.ownSide,field)));
            const weatherSpeed=(effect.field==='rain'&&a.passiveAbility==='Swift Swim')||(effect.field==='sun'&&a.passiveAbility==='Chlorophyll');
            score=Math.max(score,(activeGain+teamGain*.5)*2.3-Math.max(0,incomingAfter-incoming)+(weatherSpeed?b.maxHp*.15:0));
        }
    }
    return score;
}
module.exports={supportScore};

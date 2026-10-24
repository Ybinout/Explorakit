// Event hooks for single battles. Mutations go through the engine's HP/status/item helpers.
const { getAbilityName, hasAbility, getMoveFlags, ignoresDefenderAbility, isWeatherSuppressed } = require('./abilityEngine');
const { gender } = require('../items/stoneEvolution');
const traits = require('../../../data/game/ability_move_traits.gen7.json');
const STATS = { atk:'attack', def:'defense', spa:'specialAttack', spd:'specialDefense', spe:'speed', accuracy:'accuracy', evasion:'evasion' };
const STATUS = { brn:'burn', par:'paralyze', psn:'poison', tox:'badly_poison', slp:'sleep', frz:'freeze' };
const UNCHANGEABLE = new Set(['Multitype','RKS System','Schooling','Shields Down','Stance Change','Disguise','Comatose','Power Construct','Battle Bond']);
const REACTION_ABILITIES = Object.freeze([
    'Aftermath','Anger Point','Aroma Veil','Aura Break','Bad Dreams','Beast Boost','Berserk',
    'Cheek Pouch','Color Change','Competitive','Contrary','Corrosion','Cursed Body','Cute Charm',
    'Dancer','Dark Aura','Defiant','Early Bird','Effect Spore','Emergency Exit','Fairy Aura',
    'Flame Body','Gluttony','Gooey','Harvest','Heavy Metal','Infiltrator','Innards Out','Inner Focus',
    'Iron Barbs','Justified','Klutz','Light Metal','Liquid Ooze','Long Reach','Magic Bounce',
    'Magician','Moody','Moxie','Mummy','Pickpocket','Poison Heal','Poison Point','Poison Touch',
    'Pressure','Quick Feet','Rattled','Rivalry','Rough Skin','Scrappy','Serene Grace','Shed Skin',
    'Shield Dust','Simple','Skill Link','Slow Start','Soul-Heart','Speed Boost','Stakeout','Stall',
    'Stamina','Static','Steadfast','Stench','Sticky Hold','Synchronize','Tangled Feet','Truant',
    'Unaware','Unburden','Unnerve','Water Compaction','Weak Armor','Wimp Out',
    'Arena Trap','Magnet Pull','Shadow Tag','Run Away','Pickup'
]);
const alive = p => Number(p?.currentHp) > 0;
const label = p => p.truename || p.name || 'Pokémon';
function contact(attacker, move) { return Boolean(getMoveFlags(move).contact && !hasAbility(attacker,'Long Reach')); }
function announce(messages, p, ability) { messages.push(`${label(p)} active ${ability}.`); }
function indirect(p, amount, h, messages, ability) {
    if (!alive(p) || hasAbility(p,'Magic Guard')) return;
    const lost = h.damage(p, Math.max(1, Math.floor(amount)), { allowEndure:false }).damageToHp;
    if (lost) messages.push(`${label(p)} perd ${lost} PV (${ability}).`);
}
function afterHit({attacker:a, defender:d, move, damage, critical, battleState:state, attackerSide, defenderSide}, h, messages) {
    if (!(damage > 0)) return;
    if(d.__battle.illusion) {d.__battle.illusion=null;messages.push(`${label(d)} : l’illusion se dissipe.`);}
    const ability = getAbilityName(d), touching = contact(a, move);
    const stage = (p, stat, amount, source=p) => h.stage(p,stat,amount,messages,source);
    const status = (p, s, source, side) => h.status(p,s,side,messages,{battleState:state,attacker:source,sourceSide:source===a?attackerSide:defenderSide});
    if (alive(d)) {
        if (ability === 'Anger Point' && critical) stage(d,'attack',12);
        if (ability === 'Stamina') stage(d,'defense',1);
        if (ability === 'Water Compaction' && move.type === 'Water') stage(d,'defense',2);
        if (ability === 'Justified' && move.type === 'Dark') stage(d,'attack',1);
        if (ability === 'Rattled' && ['Dark','Ghost','Bug'].includes(move.type)) stage(d,'speed',1);
        if (ability === 'Weak Armor' && move.combat?.damage_class === 'physical') { stage(d,'defense',-1); stage(d,'speed',2); }
    }
    if (ability === 'Cursed Body' && alive(a) && !(a.__battle.disableTurns > 0) && Math.random() < .3) {
        a.__battle.disabledMove = move.ename; a.__battle.disableTurns = 4; announce(messages,d,ability);
    }
    if (touching && alive(a)) {
        if (['Rough Skin','Iron Barbs'].includes(ability)) indirect(a,a.maxHp/8,h,messages,ability);
        if (ability === 'Aftermath' && !alive(d) && !hasAbility(a,'Damp')) indirect(a,a.maxHp/4,h,messages,ability);
        if (ability === 'Gooey') stage(a,'speed',-1,d);
        const s = {'Static':'paralyze','Flame Body':'burn','Poison Point':'poison'}[ability];
        if (s && Math.random() < .3) status(a,s,d,attackerSide);
        if (ability === 'Effect Spore' && !h.types(a).includes('Grass') && !hasAbility(a,'Overcoat')) {
            const roll = Math.random(); if (roll < .3) status(a,roll<.1?'sleep':roll<.2?'poison':'paralyze',d,attackerSide);
        }
        if (ability === 'Cute Charm' && ['male','female'].includes(gender(d)) && ['male','female'].includes(gender(a))
            && gender(a)!==gender(d) && Math.random()<.3) status(a,'infatuation',d,attackerSide);
        if (hasAbility(a,'Poison Touch') && Math.random()<.3) status(d,'poison',a,defenderSide);
        if (ability === 'Mummy' && !UNCHANGEABLE.has(getAbilityName(a)) && !hasAbility(a,'Mummy')) {
            h.snapshotAbility(a); a.passiveAbility='Mummy'; announce(messages,d,ability);
        }
    }
    if (ability === 'Innards Out' && !alive(d)) indirect(a,damage,h,messages,ability);
}
function transferItem(from, to, h, messages, source) {
    if (!from?.heldItem || to?.heldItem || from.heldItem==='rift_talisman' || !alive(to)
        || (alive(from) && hasAbility(from,'Sticky Hold'))) return false;
    h.snapshotItem(from); h.snapshotItem(to);
    to.heldItem=from.heldItem; to.__heldItemOrigin=from.__heldItemOrigin;
    from.heldItem=null; from.__heldItemOrigin=null;
    if (hasAbility(from,'Unburden')) from.__battle.unburden=true;
    messages.push(`${label(to)} récupère l’objet tenu avec ${source}.`); return true;
}
function afterMove(ctx,h,messages) {
    const {attacker:a,defender:d,move,result,hpBefore,battleState:state}=ctx;
    if (result.damage + (result.substituteDamage || 0) > 0 && traits.moves[move.ename]?.drain && alive(a)) {
        const [num,den]=traits.moves[move.ename].drain,amount=Math.max(1,Math.floor((result.damage + (result.substituteDamage || 0))*num/den));
        if (hasAbility(d,'Liquid Ooze')) indirect(a,amount,h,messages,'Suintement');
        else if (!(a.__battle.healBlockTurns>0)) {const healed=h.heal(a,amount); if(healed) messages.push(`${label(a)} absorbe ${healed} PV.`);}
    }
    if (!(result.damage>0)) return;
    const ability=getAbilityName(d);
    if (alive(d)) {
        if (ability==='Color Change' && !h.types(d).includes(move.type)) { d.__battle.tempTypes=[move.type]; announce(messages,d,ability); }
        if (hpBefore>d.maxHp/2 && d.currentHp<=d.maxHp/2) {
            if (ability==='Berserk' && !hasAbility(a,'Sheer Force')) h.stage(d,'specialAttack',1,messages,d);
            if (['Wimp Out','Emergency Exit'].includes(ability)) {result.forceSwitch=true; announce(messages,d,ability);}
        }
    }
    if (hasAbility(a,'Magician')) transferItem(d,a,h,messages,'Magicien');
    if (alive(d) && ability==='Pickpocket' && contact(a,move)) transferItem(a,d,h,messages,'Pickpocket');
    if (['Thief','Covet'].includes(move.ename)) transferItem(d,a,h,messages,move.ename);
    if (!alive(d) && alive(a)) {
        if (hasAbility(a,'Moxie')) h.stage(a,'attack',1,messages,a);
        if (hasAbility(a,'Beast Boost')) {
            const stats=['attack','defense','specialAttack','specialDefense','speed'];
            const best=stats.reduce((best,s)=>h.base(a,s)>h.base(a,best)?s:best,stats[0]);
            h.stage(a,best,1,messages,a);
        }
    }

}
function secondaryEffects(ctx,h,messages) {
    const {attacker:a,defender:d,move,result,battleState:state,attackerSide,defenderSide}=ctx;
    if (!(result.damage + (result.substituteDamage || 0) > 0)) return;
    if (hasAbility(a,'Sheer Force')) {
        if (move.ename === 'Fake Out' && result.damage > 0 && alive(d)) messages.push('Sans Limite renforce Bluff mais supprime son effet d’apeurement.');
        return;
    }
    const effects=traits.moves[move.ename]?.secondaries || [];
    for(const secondary of effects) {
        const recipient=secondary.self?a:d;
        if (!alive(recipient) || (recipient===d && !(result.damage>0))) continue;
        if (recipient===d && !ignoresDefenderAbility(a,d) && hasAbility(d,'Shield Dust')) {
            if (move.ename === 'Fake Out') messages.push(`Écran Poudre de ${label(d)} empêche l’apeurement.`);
            continue;
        }
        if(Math.random()>=Math.min(1,(secondary.chance||100)/100*(hasAbility(a,'Serene Grace')?2:1)))continue;
        const effect=secondary.self||secondary;
        let status=STATUS[effect.status];
        if(move.ename==='Tri Attack')status=['burn','freeze','paralyze'][Math.floor(Math.random()*3)];
        if(status)h.status(recipient,status,recipient===a?attackerSide:defenderSide,messages,{battleState:state,attacker:a,sourceSide:attackerSide,move});
        if(effect.volatileStatus==='confusion')h.status(recipient,'confusion',defenderSide,messages,{battleState:state,attacker:a});
        if(effect.volatileStatus==='flinch')flinch(d,a,state,messages,h);
        for(const [stat,value]of Object.entries(effect.boosts||{}))if(STATS[stat])h.stage(recipient,STATS[stat],value,messages,a);
    }
    if(alive(d) && result.damage>0 && hasAbility(a,'Stench') && !effects.some(s=>s.volatileStatus==='flinch') && Math.random()<.1
        && (ignoresDefenderAbility(a,d)||!hasAbility(d,'Shield Dust')))flinch(d,a,state,messages,h);
}
function flinch(p,attacker,state,messages,h) {
    if(p.__battle.lastActionTurn===state.turn)return;
    const bypassAbility=ignoresDefenderAbility(attacker,p);
    if(!bypassAbility&&hasAbility(p,'Inner Focus')) {
        messages.push(`Attention de ${label(p)} empêche l’apeurement.`);
        return;
    }
    p.__battle.flinch=true;
    p.__battle.flinchBypassesAbility=bypassAbility;
    if(hasAbility(p,'Steadfast'))h.stage(p,'speed',1,messages,p);
}
function endTurn(p,opponent,state,h,messages) {
    if(!alive(p))return;
    const ability=getAbilityName(p),data=p.__battle;
    if(ability==='Speed Boost' && !(data.switchedInTurn===state.turn && data.lastActionTurn!==state.turn))h.stage(p,'speed',1,messages,p);
    if(ability==='Shed Skin' && p.status!=='normal' && Math.random()<1/3)h.clearStatus(p,messages);
    if(ability==='Bad Dreams' && alive(opponent) && (opponent.status==='sleep'||hasAbility(opponent,'Comatose')))indirect(opponent,opponent.maxHp/8,h,messages,ability);
    if(ability==='Moody') {
        const stats=Object.values(STATS),up=stats.filter(s=>data.statStages[s]<6),down=stats.filter(s=>data.statStages[s]>-6);
        const increased=up[Math.floor(Math.random()*up.length)];if(increased)h.stage(p,increased,2,messages,p);
        const candidates=down.filter(s=>s!==increased),decreased=candidates[Math.floor(Math.random()*candidates.length)];if(decreased)h.stage(p,decreased,-1,messages,p);
    }
    if(ability==='Harvest' && !p.heldItem && data.consumedHeldItem?.endsWith('_berry')
        && ((!isWeatherSuppressed(p,opponent)&&state.weather?.kind==='sun')||Math.random()<.5))h.recycle(p,messages);
    if(ability==='Pickup' && !p.heldItem && opponent?.__battle?.consumedHeldItemTurn===state.turn
        && opponent.__battle.consumedHeldItem && opponent.__battle.consumedHeldItem!=='rift_talisman') {
        const item=opponent.__battle.consumedHeldItem;
        h.snapshotItem(p);h.snapshotItem(opponent);
        const origin=opponent.__consumedHeldItemOrigin||opponent;
        if(Object.hasOwn(origin,'__heldItemBeforeExchange'))origin.__heldItemBeforeExchange=item;
        p.heldItem=item;p.__heldItemOrigin=origin;opponent.__battle.consumedHeldItem=null;
        announce(messages,p,'Ramassage');
    }
    data.activeTurns=(data.activeTurns||0)+1;
}
module.exports={REACTION_ABILITIES,UNCHANGEABLE,contact,afterHit,afterMove,secondaryEffects,endTurn,transferItem,traits};

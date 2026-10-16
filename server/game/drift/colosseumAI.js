const engine = require('../battle/battleEngine');
const { getMaxMovePp } = require('../battle/battleResources');
const { createDeterministicRandom, chooseSpeciesAbility } = require('../abilities/abilityDex');
const { getMoveFlags } = require('../abilities/abilityEngine');
const moveData = require('../../../data/game/moves.json');
const learnsets = require('../../../data/game/pokemonData.json');

const TIERS = [
    ['Novice', 'Attaques simples.'],
    ['Initié', 'Exploite les faiblesses et évite les immunités de type.'],
    ['Tacticien', 'Compare les dégâts, la précision et les priorités.'],
    ['Stratège', 'Change de Pokémon pour améliorer ses chances.'],
    ['Maître', 'Prépare ses attaques et utilise des soins ou des altérations.'],
    ['Expert', 'Anticipe deux tours à partir des attaques déjà observées.']
];
const stageFactor = n => n >= 0 ? (2 + n) / 2 : 2 / (2 - n);
const types = p => [...new Set((p.__battle?.tempTypes?.length ? p.__battle.tempTypes : p.__battle?.formTypes?.length ? p.__battle.formTypes : [p.type1, p.type2]).filter(Boolean))];
const effectiveness = (move, p) => types(p).reduce((value, type) => value * engine.getEffectiveness(move.type, type), 1);
const physical = move => move.combat?.damage_class === 'physical';
const accuracy = (move, a, b) => Math.min(1, (Number(move.accuracy) || 100) / 100
    * stageFactor(a.__battle?.statStages?.accuracy || 0) / stageFactor(b.__battle?.statStages?.evasion || 0));
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function difficulty(wave) {
    const tier = Math.min(6, 1 + Math.floor((Math.max(1, Number(wave) || 1) - 1) / 10));
    return { tier, label: TIERS[tier - 1][0], description: TIERS[tier - 1][1], nextWave: tier < 6 ? tier * 10 + 1 : null };
}

function preparePokemon(pokemon, wave, index) {
    const { tier } = difficulty(wave);
    // A given challenge has identical abilities and sets for every player.
    pokemon.passiveAbility = chooseSpeciesAbility(pokemon.data.id, createDeterministicRandom(`colosseum:${wave}:${index}`), 0);
    if (tier < 3) return;
    const legal = new Set(learnsets[pokemon.data.id] || []);
    const available = moveData.filter(m => legal.has(slug(m.ename))).map(m => engine.getMoveByName(m.ename));
    const attacks = available.filter(m => m.power > 0 && m.power <= (tier >= 6 ? 120 : 100) && m.combat?.power_type === 'standard'
        && !getMoveFlags(m).selfdestruct && !['Explosion', 'Self-Destruct'].includes(m.ename));
    const selected = [];
    for (let slot = 0; slot < 4; slot++) {
        const score = m => m.power * (Number(m.accuracy) || 100) / 100
            * (physical(m) ? pokemon.attack : pokemon.specialAttack)
            * (types(pokemon).includes(m.type) ? 1.5 : 1)
            * (selected.some(other => other.type === m.type) ? .35 : 1)
            * (getMoveFlags(m).recharge || getMoveFlags(m).charge ? .5 : 1);
        const next = attacks.filter(m => !selected.includes(m)).sort((a,b) => score(b)-score(a) || a.id-b.id)[0];
        if (next) selected.push(next);
    }
    if (tier >= 5) {
        const boosts = pokemon.attack >= pokemon.specialAttack ? ['Dragon Dance', 'Swords Dance', 'Bulk Up'] : ['Calm Mind', 'Nasty Plot'];
        const groups = [['Recover', 'Roost', 'Synthesis'], boosts, ['Will-O-Wisp', 'Thunder Wave', 'Toxic']];
        const preferred = [...groups[index % 3], ...groups.flat()];
        const support = preferred.map(name => available.find(m => m.ename === name)).find(Boolean);
        if (support) { selected.length = Math.min(3, selected.length);selected.push(support); }
        pokemon.heldItem = tier >= 6 ? 'leftovers' : 'sitrus_berry';
    }
    if (selected.length) {
        pokemon.abilities = [];pokemon.movePp = [];
        selected.forEach(m => pokemon.addAbility(m.ename));
    }
}

function ownView(p) {
    return {
        uuid: p.uuid, level: p.level, maxHp: p.maxHp, currentHp: p.currentHp, status: p.status,
        type1: p.type1, type2: p.type2, data: { type: types(p) },
        attack: p.currentAttack, defense: p.currentDefense, specialAttack: p.currentSpecialAttack,
        specialDefense: p.currentSpecialDefense, speed: p.currentSpeed,
        passiveAbility: p.passiveAbility, heldItem: p.heldItem,
        __battle: structuredClone(p.__battle || {})
    };
}

// Explicit observation boundary: no reserve, IV/EV, held item, ability, move list,
// remaining PP or pending action is read from the human player's Pokémon.
function observedView(p) {
    const disguise=p.__battle?.illusion?.id;
    const visible=disguise?require('../../../data/game/pokedex.json').find(entry=>entry.id===disguise):null;
    const form=!disguise && require('../../../data/game/ability_move_traits.gen7.json').forms[p.__battle?.abilityForm];
    const base=visible?.base || (form?{HP:form.stats.hp,Attack:form.stats.atk,Defense:form.stats.def,'Sp. Attack':form.stats.spa,'Sp. Defense':form.stats.spd,Speed:form.stats.spe}:p.data.base);
    const visibleTypes=visible?.type || types(p),level=p.level;
    const guessedHp = (2 * base.HP + 30) * level / 100 + level + 10;
    const scaling = Math.max(.5, Math.min(4, p.maxHp / guessedHp));
    const estimate = key => Math.max(1, Math.floor(((2 * base[key] + 30) * level / 100 + 5) * scaling));
    return { uuid: p.uuid, level, currentHp: p.currentHp, maxHp: p.maxHp, status: p.status,
        type1: visibleTypes[0], type2: visibleTypes[1], data: { type: visibleTypes },
        attack: estimate('Attack'), defense: estimate('Defense'), specialAttack: estimate('Sp. Attack'),
        specialDefense: estimate('Sp. Defense'), speed: estimate('Speed'),
        __battle: { statStages: { ...p.__battle?.statStages }, foresight: Boolean(p.__battle?.foresight), miracleEye: Boolean(p.__battle?.miracleEye) } };
}

function legalIndexes(p, field) {
    const state = p.__battle || {};
    return p.abilities.map((name,i) => ({ name, i, move: engine.getMoveByName(name) })).filter(({name,i,move}) =>
        move && require('../items/heldItems').allowsMove(p,name,{field}) && (p.movePp?.[i] ?? getMaxMovePp(name)) > 0
        && !(state.tauntTurns > 0 && move.combat?.damage_class === 'status')
        && !(state.disableTurns > 0 && state.disabledMove === name)
        && !(state.encoreTurns > 0 && state.encoreMove && state.encoreMove !== name)).map(entry => entry.i);
}

function speed(p, side, field) { return engine.getBattleSpeed(structuredClone(p), side, field); }
function before(a, move, b, reply, ctx) {
    const priority = engine.getMovePriority(move.ename, a) - engine.getMovePriority(reply.ename, b);
    if (priority) return priority > 0;
    const difference = speed(a, ctx.ownSide, ctx.field) - speed(b, ctx.enemySide, ctx.field);
    return ctx.field.field?.trickRoomTurns > 0 ? difference < 0 : difference >= 0;
}
function damage(a, b, move, side, field) {
    return engine.estimateDamage(a,b,move,{battleState:field,defenderSide:side});
}
function threats(enemy, observed) {
    const revealed = (observed?.moves || []).map(name => engine.getMoveByName(name)).filter(m => m?.power > 0);
    if (revealed.length) return revealed.slice(0,4);
    // Conservative STAB guesses until a move has actually been shown.
    return types(enemy).map(type => ({ ename: 'Unknown', type, power: 60, accuracy: 100,
        combat: { damage_class: enemy.attack >= enemy.specialAttack ? 'physical' : 'special', priority: 0 } }));
}
function entryDamage(p, side, field) {
    if (p.passiveAbility === 'Magic Guard') return 0;
    const grounded = field.field?.gravityTurns > 0 || (!types(p).includes('Flying') && p.passiveAbility !== 'Levitate');
    const spikes = grounded ? [0,1/8,1/6,1/4][Math.min(3, side?.hazards?.spikes || 0)] : 0;
    const rock = side?.hazards?.stealthRock ? effectiveness({type:'Rock'},p) / 8 : 0;
    return Math.floor(p.maxHp * spikes) + Math.floor(p.maxHp * rock);
}

function supportScore(a,b,move,ctx,incoming,bestDamage) {
    if (bestDamage >= b.currentHp) return -1000;
    let score = -1000;
    for (const effect of move.combat?.effects || []) {
        if (effect.kind === 'heal' && effect.target === 'self') {
            const restored = Math.min(a.maxHp-a.currentHp,a.maxHp*(effect.fraction || .5));
            const survives = a.currentHp>incoming || (ctx.replies.every(reply=>before(a,move,b,reply,ctx)) && a.currentHp+restored>incoming);
            if (survives && restored > incoming * 1.25 && a.currentHp < a.maxHp * .65) score = Math.max(score,restored*.85);
        }
        if (effect.kind === 'stat_stage' && effect.target === 'self' && effect.stages > 0) {
            const current = a.__battle?.statStages?.[effect.stat] || 0;
            if (current >= 4 || incoming > a.currentHp * .3) continue;
            const raised = structuredClone(a);
            raised.__battle.statStages ||= {};raised.__battle.statStages[effect.stat] = Math.min(6,current+effect.stages);
            const future = Math.max(0,...ctx.attacks.map(m=>damage(raised,b,m,ctx.enemySide,ctx.field)));
            const gain = future-bestDamage;
            if (gain > 0 && b.currentHp > bestDamage*1.5) score = Math.max(score, gain*2.5-incoming*.5);
        }
        if (effect.kind === 'status' && (!b.status || b.status === 'normal') && ctx.enemySide.screens?.safeguardTurns <= 0) {
            if(a.currentHp<=incoming)continue;
            const immune = (['poison','badly_poison'].includes(effect.status) && types(b).some(t=>['Poison','Steel'].includes(t)))
                || (effect.status === 'burn' && types(b).includes('Fire'))
                || (effect.status === 'paralyze' && (types(b).includes('Electric') || effectiveness(move,b) === 0));
            if (immune || ctx.field.terrain?.kind === 'misty_terrain') continue;
            const benefit = effect.status === 'burn' && b.attack > b.specialAttack ? incoming*1.8 + b.maxHp*.12
                : effect.status === 'paralyze' && speed(b,ctx.enemySide,ctx.field)>speed(a,ctx.ownSide,ctx.field) ? b.maxHp*.3 : b.maxHp*.2;
            if (b.currentHp > bestDamage*2) score = Math.max(score,benefit*accuracy(move,a,b));
        }
    }
    return score;
}

// Bounded two-turn projection. Only the rival's revealed moves (or generic STAB
// estimates) are considered. It never calls the engine on live combat state.
function project(a,b,move,reply,ctx) {
    const own = damage(a,b,move,ctx.enemySide,ctx.field), enemy = damage(b,a,reply,ctx.ownSide,ctx.field);
    const first = before(a,move,b,reply,ctx);
    if (!first && enemy >= a.currentHp) return -a.maxHp;
    let score = Math.min(b.currentHp,own)*accuracy(move,a,b);
    if (first && own >= b.currentHp) return score + b.maxHp*.5;
    const remaining = a.currentHp-enemy;
    score -= Math.min(a.currentHp,enemy)*.8;
    if (remaining <= 0) return score-a.maxHp*.5;
    const nextA={...a,currentHp:remaining},nextB={...b,currentHp:Math.max(0,b.currentHp-own)};
    if (nextB.currentHp > 0) {
        const followup = ctx.attacks.filter(next=>next.ename!==move.ename || ctx.remainingPp[move.ename]>1).map(next => {
            const hit=damage(nextA,nextB,next,ctx.enemySide,ctx.field), actsFirst=before(nextA,next,nextB,reply,ctx);
            if (!actsFirst && enemy >= remaining) return -remaining;
            return Math.min(nextB.currentHp,hit)*accuracy(next,nextA,nextB) - (actsFirst && hit>=nextB.currentHp ? 0 : enemy*.8);
        });
        score += .7*Math.max(0,...followup);
    }
    return score;
}

function chooseAction({ team, opponent, field, ownSide, enemySide, wave, memory, round }) {
    const { tier } = difficulty(wave), active = team[0];
    if (tier === 1 || !active || !opponent) return null;
    const a=ownView(active), b=observedView(opponent), observed=memory.seen?.[b.uuid];
    const indexes=legalIndexes(active,field);if (!indexes.length) return {action:'attack',number:-1};
    const replies=threats(b,observed);
    const attacks=indexes.map(i=>engine.getMoveByName(active.abilities[i])).filter(m=>m.power>0 && !observed?.immuneMoves?.includes(m.ename));
    const ctx={field,ownSide,enemySide,attacks,replies,
        remainingPp:Object.fromEntries(indexes.map(i=>[active.abilities[i],active.movePp?.[i] ?? getMaxMovePp(active.abilities[i])]))};
    const incoming=Math.max(0,...replies.map(m=>damage(b,a,m,ownSide,field)));
    const candidates=indexes.map(number=>{
        const move=engine.getMoveByName(active.abilities[number]);
        let score=-1000;
        if (move.power>0) {
            if (tier===2) score=move.power*effectiveness(move,b)*(types(a).includes(move.type)?1.5:1);
            else {
                const hit=damage(a,b,move,enemySide,field);
                score=Math.min(hit,b.currentHp)*accuracy(move,a,b);
                if (hit>=b.currentHp) score+=b.maxHp*.6*accuracy(move,a,b);
                if (replies.every(reply=>before(a,move,b,reply,ctx)) && hit>=b.currentHp) score+=a.maxHp*.5;
                if (tier>=6) score+=Math.min(...replies.map(reply=>project(a,b,move,reply,ctx)));
            }
            if (observed?.immuneMoves?.includes(move.ename)) score=-1000;
        } else if (tier>=5) score=supportScore(a,b,move,ctx,incoming,Math.max(0,...attacks.map(m=>damage(a,b,m,enemySide,field))));
        return {action:'attack',number,score};
    });
    candidates.sort((a,b)=>b.score-a.score || a.number-b.number);
    const best=candidates[0], bestMove=engine.getMoveByName(active.abilities[best.number]);
    const canFinish=bestMove.power>0 && damage(a,b,bestMove,enemySide,field)>=b.currentHp && replies.every(reply=>before(a,bestMove,b,reply,ctx));
    const state=active.__battle || {};
    if (tier>=4 && !canFinish && !state.trappedTurns && !state.ingrain && !(field.field?.fairyLockTurns>0)
        && round-(memory.lastSwitchRound ?? -10)>2) {
        const pressure = pokemon => Math.max(0,...replies.map(m=>damage(b,pokemon,m,ownSide,field)));
        const currentOffense = Math.max(0,...attacks.map(m=>damage(a,b,m,enemySide,field)));
        let bestSwitch=null, improvement=0;
        for (let number=1;number<team.length;number++) {
            const reserve=team[number];if(reserve.currentHp<=0)continue;
            const candidate=ownView(reserve);candidate.__battle={statStages:{}};
            const cost=entryDamage(candidate,ownSide,field), threat=pressure(candidate);
            if (candidate.currentHp<=cost+threat) continue;
            const offense=Math.max(0,...legalIndexes(reserve,field).map(i=>damage(candidate,b,engine.getMoveByName(reserve.abilities[i]),enemySide,field)));
            const gain=(incoming/a.maxHp-(threat+cost)/candidate.maxHp)*100
                +(offense-currentOffense)/b.maxHp*35-15;
            if ((incoming>=a.currentHp*.6 || currentOffense<b.maxHp*.12) && gain>Math.max(18,improvement)) {
                improvement=gain;bestSwitch={action:'change',number};
            }
        }
        if(bestSwitch)return bestSwitch;
    }
    return { action:best.action, number:best.number };
}

function observe(memory, pokemon, moveName, outcome = null) {
    memory.seen ||= {};
    const entry=memory.seen[pokemon.uuid] ||= {moves:[],immuneMoves:[]};
    if (!outcome && !entry.moves.includes(moveName)) entry.moves.push(moveName);
    if ((outcome?.effectiveness===0 || outcome?.abilityBlocked) && !entry.immuneMoves.includes(moveName)) entry.immuneMoves.push(moveName);
}

module.exports = { difficulty, preparePokemon, chooseAction, observe, observedView, entryDamage, legalIndexes };

const signals=require('./driftSignals');
const catalogue = require('../../../data/game/drifts.json');
const definitions = new Map(catalogue.definitions.map(d => [d.id, d]));
const states = new WeakMap();
const idOf = number => `DRF-${String(number).padStart(3, '0')}`;
function value(owner, number, tournament = false) {
    if (!owner || (tournament && number >= 43 && number <= 54)) return 0;
    const drift = (owner.drifts || []).find(d => d.definitionId === idOf(number) && owner.equipped?.includes(d.uuid));
    return require('./driftStrength').value(drift);
}
function v(p, n) { const s = states.get(p); return s ? value(s.owner, n, s.tournament) : 0; }
function signal(p,n,detail='') {const state=states.get(p);if(state&&v(p,n)>0)signals.signal(state.owner,n,detail);}
function power(p,n,multiple=1){const amount=v(p,n)*multiple;if(amount>0)signal(p,n,`bonus ${Math.round(amount*100)/100} %`);return amount;}
function healing(p,n,amount){const restored=heal(p,amount);if(restored)signal(p,n,`+${restored} PV`);return restored;}
function recoil(p,n,target,amount){const lost=damage(target,amount);if(lost)signal(p,n,`${lost} dégâts`);return lost;}
function changeStage(p,n,target,stat,delta,stage) {
    const before=Number(target.__battle?.statStages[stat])||0;
    stage(target,stat,delta);
    const applied=(Number(target.__battle?.statStages[stat])||0)-before;
    const label={speed:'Vitesse',accuracy:'Précision'}[stat]||'Statistique';
    if(applied)signal(p,n,`${label} adverse ${applied>0?'augmentée':'réduite'}`);
}
function roll(p, n) { const s = states.get(p); return Boolean(s && v(p, n) > 0 && s.random() < v(p, n) / 100); }
function attach(team, owner, tournament = false, random = Math.random) {
    const shared = { firstUsed: false, temporalUsed: false, deaths: 0 };
    for (const p of team) states.set(p, { owner, team, tournament, random, shared, dead: p.currentHp <= 0,
        streak: 0, turns: 0, types: [], dealt: false, survival: false, shieldUsed: false, shield: 0 });
}
function detach(team) { for (const p of team) states.delete(p); }
function isDead(p) { return states.get(p)?.dead || p?.currentHp <= 0; }
function markHp(p, hp) { if (hp <= 0 && states.has(p)) states.get(p).dead = true; }
function heal(p, amount, share = true) {
    if (!p || isDead(p)) return 0;
    const actual = Math.min(p.maxHp - p.currentHp, Math.max(0, Math.floor(amount)));
    p.currentHp += actual;
    if (share) shareHeal(p, actual);
    return actual;
}
function shareHeal(p, actual) {
    const s = states.get(p);
    if (!s || !v(p, 59) || actual <= 0) return;
    const allies = s.team.filter(a => a !== p && !isDead(a));
    if (allies.length) {const restored=allies.reduce((sum,a)=>sum+heal(a, actual * v(p, 59) / 100 / allies.length, false),0);if(restored)signal(p,59,`+${restored} PV partagés`);}
}
function damage(p, amount) { if (!p || isDead(p)) return 0; const loss = Math.min(p.currentHp, Math.max(0, Math.floor(amount))); p.currentHp -= loss; markHp(p, p.currentHp); return loss; }
function defense(p, stat, base) {
    const s = states.get(p);
    return s && ['defense', 'specialDefense'].includes(stat) ? base * (1 + power(p,20,Math.min(5,s.turns)) / 100) : base;
}
function pierce(attacker, defenseValue) { return defenseValue * (1 - power(attacker,2) / 100); }
function sameType(p, n, type) {
    const s = states.get(p);
    return s?.owner.drifts.find(d => d.definitionId === idOf(n) && s.owner.equipped.includes(d.uuid))?.element === type;
}
function multiplier(a, d, move, critical) {
    const s = states.get(a), t = states.get(d);
    let bonus = 0, reduction = power(d, 13);
    if (s) {
        if (sameType(a, 1, move.type)) bonus += power(a, 1);
        if (d.currentHp / d.maxHp < .3) bonus += power(a, 6);
        if (!s.shared.firstUsed) bonus += power(a, 7);
        bonus += power(a,8,Math.min(5,s.streak));
        if (s.vengeance) bonus += power(a, 9);
        if (critical) bonus += power(a, 10);
        if (d.currentHp / d.maxHp > .7) bonus += power(a, 11);
        if (['defense', 'specialDefense'].some(k => d.__battle?.statStages[k] > 0)) bonus += power(a, 12);
        if (s.counter) bonus += power(a, 24);
        if (s.flame) bonus += power(a, 32);
        if (s.entry) bonus += power(a, 33);
        const alive = s.team.filter(p => !isDead(p));
        const types = new Set(alive.flatMap(p => p.data.type));
        bonus += power(a,35,Math.min(6,types.size)) + power(a,36,Math.min(3,s.shared.deaths));
        if (s.types.length === 2 && !s.types.includes(move.type)) bonus += power(a, 38);
        if (alive.length === 1) bonus += power(a, 39);
        if (s.reserve) bonus += power(a, 41);
        if (d.status && d.status !== 'normal') bonus += power(a, 42);
        bonus += power(a, 56) + power(a,58,Math.min(5,s.owner.chain||0));
    }
    if (sameType(d, 14, move.type)) reduction += power(d, 14);
    if (d.currentHp / d.maxHp < .3) reduction += power(d, 18);
    if (t?.armor) reduction += power(d, 17);
    if (t?.adapted === move.type) reduction += power(d, 37);
    if (t?.wild) reduction += power(d, 48);
    return (1 + Math.min(200, bonus) / 100) * (1 - Math.min(60, reduction) / 100);
}
function directDamage(p, amount, attacker) {
    const s = states.get(p);
    if (!s || !attacker || s.dead) return amount;
    let loss = Math.max(0, amount);
    if (s.shield) { const blocked = Math.min(loss, s.shield); s.shield -= blocked; loss -= blocked;if(blocked)signal(p,21,`${blocked} dégâts bloqués`); }
    if (loss >= p.currentHp && !s.survival) {
        if (roll(p, 55)) { s.phoenixHp = Math.max(1, Math.floor(p.maxHp * .2)); loss = Math.max(0, p.currentHp - s.phoenixHp); s.survival = true;signal(p,55,'survie'); }
        else if (roll(p, 15)) { loss = p.currentHp - 1; s.survival = true;signal(p,15,'survie à 1 PV'); }
    }
    return loss;
}
function afterDamage(p, before, attacker) {
    const s = states.get(p);
    // Resolve the fatal-hit replacement before removal, even below the retained HP threshold.
    if (s?.phoenixHp) { p.currentHp = Math.max(p.currentHp, s.phoenixHp); s.phoenixHp = 0; }
    if (!s || !attacker || p.currentHp >= before) return;
    s.vengeance = true;
    s.armor = false;
    if (!s.shieldUsed && p.currentHp > 0 && p.currentHp / p.maxHp < .25 && v(p, 21)) {
        s.shieldUsed = true; s.shield = Math.max(1, Math.floor(p.maxHp * v(p, 21) / 100));signal(p,21,'bouclier activé');
    }
}
function priority(p, move) {
    const s = states.get(p);
    if (!s || !move || move.combat?.damage_class === 'status') return 0;
    let bonus = roll(p, 3) ? 1 : 0;if(bonus)signal(p,3,'priorité');
    if (!s.shared.temporalUsed) { s.shared.temporalUsed = true; if (roll(p, 57)){bonus++;signal(p,57,'priorité');} }
    return bonus;
}
function accuracy(p) { return power(p,40) / 100; }
function statusGuard(p, status, source, reflect) {
    if (!states.has(p)) return false;
    if (roll(p, 22)){signal(p,22,'statut bloqué');return true;}
    if (source && reflect && roll(p, 28)) { reflect(source, status);signal(p,28,'statut renvoyé');return true; }
    return false;
}
function afterMove(a, d, result, { contact = false, status, stage }) {
    const s = states.get(a), t = states.get(d);
    const offensive = result.move && result.move.combat?.damage_class !== 'status';
    if (result.missed && s) s.streak = 0;
    if (result.missed && t) {
        recoil(d,23,a,a.maxHp*v(d,23)/100);t.counter=true;healing(d,25,d.maxHp*v(d,25)/100);
    }
    if (!offensive || (!result.success && !result.missed && !result.blocked)) return;
    if (s) {
        s.shared.firstUsed = true;
        if (result.success && result.damage > 0) s.streak = Math.min(5, s.streak + 1); else s.streak = 0;
        const type = result.move.type;
        s.types = s.types.includes(type) || s.types.length === 2 ? [] : [...s.types, type];
        s.vengeance = s.counter = s.flame = s.entry = s.reserve = false;
        s.dealt ||= result.damage > 0;
    }
    if (result.damage <= 0) return;
    if (s) {
        healing(a,5,result.damage*v(a,5)/100);
        if (!isDead(a) && !isDead(d) && roll(a, 4)) recoil(a,4,d,result.damage*.3);
        if (!isDead(a) && !isDead(d) && roll(a, 30)) {
            if (t) {t.parasite = { source: a, turns: 3 };signal(a,30,'parasite appliqué');}
        }
        if (roll(a, 31)) {
            const boosts = Object.keys(d.__battle?.statStages || {}).filter(k => d.__battle.statStages[k] > 0 && k !== 'critical');
            if (boosts.length)changeStage(a,31,d,boosts[Math.floor(s.random()*boosts.length)],-1,stage);
        }
    }
    if (t) {
        recoil(d,19,a,result.damage*v(d,19)/100);
        t.armor = Boolean(result.critical); t.adapted = result.move.type;
        if (contact && roll(d,26)&&status(a,'poison',d))signal(d,26,'poison');
        if(roll(d,27))changeStage(d,27,a,'speed',-1,stage);
        if (result.effectiveness > 1) { t.flame = true; if(roll(d,29))changeStage(d,29,a,'accuracy',-1,stage); }
    }
}
function endTurn(p) {
    const s = states.get(p);
    if (!s || isDead(p)) return;
    if (s.parasite?.turns > 0) {
        const loss = damage(p, p.maxHp * .03); heal(s.parasite.source, loss);if(loss)signal(s.parasite.source,30,`${loss} PV drainés`);s.parasite.turns--;
    }
    if(v(p,56))recoil(p,56,p,Math.max(1,Math.floor(p.maxHp*.04)));
    healing(p,16,p.maxHp*v(p,16)/100);
    s.turns = Math.min(5, s.turns + 1);
    s.reserve = !s.dealt; s.dealt = false;
}
function switched(p, manual = false) {
    const s = states.get(p); if (!s) return;
    s.entry = true; s.turns = 0;
    if(manual)healing(p,34,p.maxHp*v(p,34)/100);
}
function fainted(p) {
    const s = states.get(p); if (!s || s.counted) return;
    s.counted = true; s.dead = true; s.shared.deaths++; s.owner.chain = 0;
}
module.exports = { definitions, states, value, v, attach, detach, isDead, markHp, heal, shareHeal, damage, defense, pierce,
    multiplier, directDamage, afterDamage, priority, accuracy, statusGuard, afterMove, endTurn, switched, fainted };

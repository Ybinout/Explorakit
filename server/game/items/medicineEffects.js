const catalog = require('../../../data/game/items.json').items;

function medicineResult(pokemon, itemKey, random = Math.random) {
    const item = catalog.find(i => i.key === itemKey && (i.category === 'medicine' || i.fieldUse));
    if (!item || !pokemon) throw Error('Objet ou Pokémon invalide.');
    const effect = item.fieldUse || item;
    if(effect.ivReroll || effect.effortReset){
        if(pokemon.currentHp<=0||pokemon.isEgg)throw Error('Choisis un Pokémon apte à s’entraîner.');
        const {STAT_KEYS,normalizeEffort}=require('../models/training');
        if(effect.ivReroll){
            const stat=effect.ivReroll;if(!STAT_KEYS.includes(stat))throw Error('Statistique IV invalide.');
            const before=Number(pokemon.iv?.[stat]);if(!Number.isInteger(before)||before<0||before>31)throw Error('IV invalide.');
            const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Tirage IV invalide.');
            const rolled=Math.floor(draw*32),after=rolled;
            return {...trainingResult(pokemon,{iv:{...pokemon.iv,[stat]:after}}),trainingChange:{kind:'iv',stat,before,rolled,after}};
        }
        const stat=effect.effortReset;if(stat!=='all'&&!STAT_KEYS.includes(stat))throw Error('Statistique EV invalide.');
        const ev=normalizeEffort(pokemon.ev),before={...ev};for(const key of STAT_KEYS)if(stat==='all'||key===stat)ev[key]=0;
        if(STAT_KEYS.every(key=>ev[key]===before[key]))throw Error('Cet objet n’aurait aucun effet : ces EV sont déjà à zéro.');
        return {...trainingResult(pokemon,{ev}),trainingChange:{kind:'evReset',stat,before,after:ev}};
    }
    if (effect.effort) {
        if (pokemon.currentHp <= 0 || pokemon.isEgg) throw Error('Choisis un Pokémon apte à s’entraîner.');
        const {STAT_KEYS,normalizeEffort} = require('../models/training');
        const {stat,amount} = effect.effort;
        if (!STAT_KEYS.includes(stat) || !Number.isFinite(amount)) throw Error('Entraînement invalide.');
        const ev = normalizeEffort(pokemon.ev), total = Object.values(ev).reduce((a,b) => a+b,0);
        const delta = amount > 0 ? Math.min(amount,252-ev[stat],510-total) : -Math.min(ev[stat],-amount);
        if (!delta) throw Error('Cet objet n’aurait aucun effet : limite d’EV atteinte ou aucun EV à retirer.');
        ev[stat] += delta;
        return trainingResult(pokemon,{ev});
    }
    if (effect.restorePp) {
        if (pokemon.currentHp <= 0 || pokemon.isEgg) throw Error('Choisis un Pokémon conscient.');
        const {getMaxMovePp} = require('../battle/battleResources');
        const index = pokemon.abilities.findIndex((name,i) => pokemon.movePp?.[i] === 0 && getMaxMovePp(name) > 0);
        const slot = index >= 0 ? index : pokemon.abilities.findIndex((name,i) => pokemon.movePp?.[i] < getMaxMovePp(name));
        if (slot < 0) throw Error('Cet objet n’aurait aucun effet : les PP sont pleins.');
        const movePp = [...pokemon.movePp]; movePp[slot] = Math.min(getMaxMovePp(pokemon.abilities[slot]),movePp[slot]+effect.restorePp);
        return {currentHp:pokemon.currentHp,status:pokemon.status,movePp};
    }
    let hp = pokemon.currentHp, status = pokemon.status;
    if (effect.revive) {
        if (hp > 0) throw Error('Ce Pokémon est déjà conscient.');
        hp = Math.max(1, Math.floor(pokemon.maxHp / 2));
        status = 'normal';
    } else {
        if (hp <= 0) throw Error('Utilise un Rappel sur un Pokémon K.O.');
        const amount = effect.heal || (effect.healFraction ? Math.max(1, Math.floor(pokemon.maxHp * effect.healFraction)) : 0);
        if (amount) hp = Math.min(pokemon.maxHp, hp + amount);
        if (effect.cure?.includes(status)) status = 'normal';
    }
    if (hp === pokemon.currentHp && status === pokemon.status) throw Error('Cet objet n’aurait aucun effet.');
    return { currentHp: hp, status };
}

function trainingResult(pokemon, patch) {
    const copy=Object.assign(Object.create(Object.getPrototypeOf(pokemon)),pokemon,patch);copy.recalculateStats(true);
    const result={...patch,currentHp:copy.currentHp,status:copy.status,maxHp:copy.maxHp};
    for(const key of ['attack','defense','specialAttack','specialDefense','speed','currentAttack','currentDefense','currentSpecialAttack','currentSpecialDefense','currentSpeed'])result[key]=copy[key];
    return result;
}
function medicineBatch(pokemon,itemKey,quantity=1,available=1,random=Math.random){
    const item=catalog.find(i=>i.key===itemKey),effort=item?.fieldUse?.effort;
    if(!Number.isInteger(quantity)||quantity<1||quantity>99)throw Error('Quantité invalide.');
    if(quantity>1&&!(effort?.amount>0))throw Error('Cet objet s’utilise à l’unité.');
    if(!(available>0))throw Error('Cet objet n’est plus dans ton sac.');
    let consumed=Math.min(quantity,available);
    if(effort?.amount>0){const ev=require('../models/training').normalizeEffort(pokemon.ev);consumed=Math.min(consumed,Math.ceil(Math.min(252-ev[effort.stat],510-Object.values(ev).reduce((s,n)=>s+n,0))/effort.amount));}
    if(consumed<1){medicineResult(pokemon,itemKey,random);throw Error('Cet objet n’aurait aucun effet.');}
    let current=Object.assign(Object.create(Object.getPrototypeOf(pokemon)),pokemon),result;
    for(let i=0;i<consumed;i++){result=medicineResult(current,itemKey,random);Object.assign(current,result);}
    if(effort?.amount>0)result.trainingChange={kind:'ev',stat:effort.stat,before:pokemon.ev[effort.stat],after:result.ev[effort.stat]};
    return {...result,consumed};
}
module.exports = { medicineResult, medicineBatch };

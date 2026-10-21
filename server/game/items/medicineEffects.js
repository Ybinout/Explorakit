const catalog = require('../../../data/game/items.json').items;

function medicineResult(pokemon, itemKey) {
    const item = catalog.find(i => i.key === itemKey && (i.category === 'medicine' || i.fieldUse));
    if (!item || !pokemon) throw Error('Objet ou Pokémon invalide.');
    const effect = item.fieldUse || item;
    if (effect.effort) {
        if (pokemon.currentHp <= 0 || pokemon.isEgg) throw Error('Choisis un Pokémon apte à s’entraîner.');
        const {STAT_KEYS,normalizeEffort} = require('../models/training');
        const {stat,amount} = effect.effort;
        if (!STAT_KEYS.includes(stat) || !Number.isFinite(amount)) throw Error('Entraînement invalide.');
        const ev = normalizeEffort(pokemon.ev), total = Object.values(ev).reduce((a,b) => a+b,0);
        const delta = amount > 0 ? Math.min(amount,252-ev[stat],510-total) : -Math.min(ev[stat],-amount);
        if (!delta) throw Error('Cet objet n’aurait aucun effet : limite d’EV atteinte ou aucun EV à retirer.');
        ev[stat] += delta;
        const copy = Object.assign(Object.create(Object.getPrototypeOf(pokemon)),pokemon,{ev});
        copy.recalculateStats(true);
        const result = {ev,currentHp:copy.currentHp,status:copy.status,maxHp:copy.maxHp};
        for (const key of ['attack','defense','specialAttack','specialDefense','speed','currentAttack','currentDefense','currentSpecialAttack','currentSpecialDefense','currentSpeed']) result[key] = copy[key];
        return result;
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

module.exports = { medicineResult };

const catalog = require('../../../data/game/items.json').items;

function medicineResult(pokemon, itemKey) {
    const item = catalog.find(i => i.key === itemKey && (i.category === 'medicine' || i.fieldUse));
    if (!item || !pokemon) throw Error('Objet ou Pokémon invalide.');
    const effect = item.fieldUse || item;
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

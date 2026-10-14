const { withTransaction } = require('../config/database');
const catalog = require('../../data/game/items.json').items;
function medicineResult(pokemon, itemKey) {
    const item = catalog.find((i) => i.key === itemKey && i.category === 'medicine');
    if (!item || !pokemon) throw Error('Objet ou Pokémon invalide.');
    let hp = pokemon.currentHp,
        status = pokemon.status;
    if (item.revive) {
        if (hp > 0) throw Error('Ce Pokémon est déjà conscient.');
        hp = Math.max(1, Math.floor(pokemon.maxHp / 2));
        status = 'normal';
    } else {
        if (hp <= 0) throw Error('Utilise un Rappel sur un Pokémon K.O.');
        if (item.heal) hp = Math.min(pokemon.maxHp, hp + item.heal);
        if (item.cure?.includes(status)) status = 'normal';
    }
    if (hp === pokemon.currentHp && status === pokemon.status) throw Error('Cet objet n’aurait aucun effet.');
    return { currentHp: hp, status };
}
async function useMedicine(userId, pokemon, itemKey) {
    const result = medicineResult(pokemon, itemKey);
    await withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [owned] = await c.execute(
            'SELECT p.uuid FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',
            [userId, pokemon.uuid]
        );
        if (!owned.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const [spent] = await c.execute(
            'UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>0',
            [userId, itemKey]
        );
        if (!spent.affectedRows) throw Error('Cet objet n’est plus dans ton sac.');
        await c.execute('UPDATE pokemons SET current_hp=?,status=? WHERE uuid=?', [
            result.currentHp,
            result.status,
            pokemon.uuid,
        ]);
    });
    return result;
}
module.exports = { useMedicine, medicineResult };

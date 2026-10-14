const { withTransaction } = require('../config/database');
const { medicineResult } = require('../game/items/medicineEffects');
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

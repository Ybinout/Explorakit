const { withTransaction } = require('../config/database');
const { medicineResult } = require('../game/items/medicineEffects');
async function useMedicine(userId, pokemon, itemKey) {
    if (!pokemon?.uuid) throw Error('Pokémon introuvable.');
    return withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [owned] = await c.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',
            [userId, pokemon.uuid]
        );
        if (!owned.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const [spent] = await c.execute(
            'UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>0',
            [userId, itemKey]
        );
        if (!spent.affectedRows) throw Error('Cet objet n’est plus dans ton sac.');
        const result = medicineResult(require('./teamRepository').rowToPokemon(owned[0]), itemKey);
        await c.execute('UPDATE pokemons SET current_hp=?,status=? WHERE uuid=?', [
            result.currentHp,
            result.status,
            pokemon.uuid,
        ]);
        if (result.ev) await c.execute('UPDATE pokemons SET ev_hp=?,ev_attack=?,ev_defense=?,ev_special_attack=?,ev_special_defense=?,ev_speed=? WHERE uuid=?',
            [result.ev.hp,result.ev.attack,result.ev.defense,result.ev.specialAttack,result.ev.specialDefense,result.ev.speed,pokemon.uuid]);
        if (result.movePp) await c.execute('UPDATE pokemons SET move1_pp=?,move2_pp=?,move3_pp=?,move4_pp=? WHERE uuid=?',
            [...Array.from({length:4},(_,i) => result.movePp[i] ?? null),pokemon.uuid]);
        return result;
    });
}
module.exports = { useMedicine, medicineResult };

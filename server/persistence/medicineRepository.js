const { withTransaction } = require('../config/database');
const { medicineResult, medicineBatch } = require('../game/items/medicineEffects');
async function useMedicine(userId, pokemon, itemKey, quantity=1, ivConfirmation=null) {
    if (!pokemon?.uuid) throw Error('Pokémon introuvable.');
    return withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [owned] = await c.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',
            [userId, pokemon.uuid]
        );
        if (!owned.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const [stock]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,itemKey]);
        const current=require('./teamRepository').rowToPokemon(owned[0]);
        if(stock[0]?.quantity>0)require('../game/items/ivRerollConfirmation').requireIvRerollConfirmation(current,itemKey,ivConfirmation);
        const result=medicineBatch(current,itemKey,quantity,Number(stock[0]?.quantity)||0);
        const [spent]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[result.consumed,userId,itemKey,result.consumed]);
        if(!spent.affectedRows)throw Error('Cet objet n’est plus dans ton sac.');
        await c.execute('UPDATE pokemons SET current_hp=?,status=? WHERE uuid=?', [
            result.currentHp,
            result.status,
            pokemon.uuid,
        ]);
        if(result.iv)await c.execute('UPDATE pokemons SET iv_hp=?,iv_attack=?,iv_defense=?,iv_special_attack=?,iv_special_defense=?,iv_speed=? WHERE uuid=?',[result.iv.hp,result.iv.attack,result.iv.defense,result.iv.specialAttack,result.iv.specialDefense,result.iv.speed,pokemon.uuid]);
        if(result.passiveAbility)await c.execute('UPDATE pokemons SET passive_ability=? WHERE uuid=?',[result.passiveAbility,pokemon.uuid]);
        if(result.nature)await c.execute('UPDATE pokemons SET nature=? WHERE uuid=?',[result.nature,pokemon.uuid]);
        if (result.ev) await c.execute('UPDATE pokemons SET ev_hp=?,ev_attack=?,ev_defense=?,ev_special_attack=?,ev_special_defense=?,ev_speed=? WHERE uuid=?',
            [result.ev.hp,result.ev.attack,result.ev.defense,result.ev.specialAttack,result.ev.specialDefense,result.ev.speed,pokemon.uuid]);
        if (result.movePp) await c.execute('UPDATE pokemons SET move1_pp=?,move2_pp=?,move3_pp=?,move4_pp=? WHERE uuid=?',
            [...Array.from({length:4},(_,i) => result.movePp[i] ?? null),pokemon.uuid]);
        return result;
    });
}
module.exports = { useMedicine, medicineResult };

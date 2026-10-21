const { withTransaction } = require('../config/database');
const { repelDuration } = require('../game/items/repel');
async function useRepel(userId, itemKey) {
    const steps = repelDuration(itemKey);
    return withTransaction(async c => {
        const [users] = await c.execute('SELECT repel_steps FROM users WHERE id=? FOR UPDATE', [userId]);
        if (!users.length) throw Error('Joueur introuvable.');
        if (users[0].repel_steps > 0) throw Error('Un Repousse est déjà actif.');
        const [spent] = await c.execute('UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>0', [userId, itemKey]);
        if (!spent.affectedRows) throw Error('Cet objet n’est plus dans ton sac.');
        await c.execute('UPDATE users SET repel_steps=? WHERE id=?', [steps, userId]);
        return steps;
    });
}
module.exports = { useRepel };

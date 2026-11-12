const {withTransaction} = require('../config/database');
const {calendar} = require('../game/world/safari');
const master = require('../game/berries/master');

// A single row lock coordinates visits, reconnects and native garden mutations.
// Recipe + day commit together; there is no inventory debit or artificial trial.
function visit(userId, now, draw) {
    return withTransaction(async c => {
        const [[user]] = await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        if (!user) throw Error('Dresseur introuvable.');
        const date = calendar(now ?? Date.now()).date;
        const [[saved]] = await c.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?', [userId, master.DAY_FLAG]);
        const [rows] = await c.execute('SELECT recipe_key,family_key FROM berry_recipe_discoveries WHERE user_id=?', [userId]);
        const known = new Map(rows.map(r => [r.recipe_key, r.family_key]));
        const previous = saved ? JSON.parse(saved.flag_value) : null;
        if (previous?.date >= date) {
            const recipe = master.byKey.get(previous.recipeKey);
            if (recipe && known.has(recipe.key)) return {status:'already', date:previous.date, recipe};
        }
        const recipe = master.choose(known, draw);
        if (!recipe) return {status:'exhausted', date};
        await c.execute('INSERT INTO berry_recipe_discoveries(user_id,recipe_key,ingredients_json,family_key,attempts) VALUES(?,?,?,?,0)',
            [userId, recipe.key, JSON.stringify(recipe.ingredients), recipe.family]);
        await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
            [userId, master.DAY_FLAG, JSON.stringify({date, recipeKey:recipe.key})]);
        return {status:'learned', date, recipe};
    });
}
module.exports = {visit};

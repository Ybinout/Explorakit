const {randomInt} = require('node:crypto');
const rules = require('./rules');

const NAME = 'magic_berry_master';
const FRAME = Object.freeze({columns:8, rows:4, index:17});
const DAY_FLAG = 'berry_master_daily';
// Teach the catalog's intentional recipes, rather than random combinations
// which can lead to the same family. Discovery still uses the native notebook.
const recipes = rules.catalog.families.map(f => rules.recipe(f.ingredients));
const byKey = new Map(recipes.map(r => [r.key, r]));
function choose(known, draw = randomInt) {
    const unknown = recipes.filter(r => !known.has(r.key));
    if (!unknown.length) return null;
    // Prefer a new outcome family if another combination already revealed one.
    const families = new Set(known.values());
    const fresh = unknown.filter(r => !families.has(r.family));
    const pool = fresh.length ? fresh : unknown;
    return pool[draw(pool.length)];
}
function pages(result) {
    const copy = [
        'Je suis le Maître des Baies ! Chez toi, plante une baie normale dans une jardinière avec '+rules.catalog.crystalCost+' Éclats fissurés. En '+rules.catalog.growthMs/60000+' minutes, elle devient un ingrédient corrompu.',
        'Au Mutateur, mélange trois baies corrompues. Le mélange fixe la recette ; la rareté est aléatoire et une mutation peut échouer.',
        'La baie finale donne un bonus et un malus. Tous les Pokémon peuvent la porter. Elle est consommée à l’entrée en combat ; ses effets durent jusqu’au retrait du Pokémon.'
    ];
    if (result.status === 'exhausted') copy.push('Je t’ai transmis toutes mes recettes ! Tu peux les retrouver dans le carnet du Mutateur.');
    else {
        copy.push(result.status === 'learned'
            ? 'Voici ta recette du jour : « '+result.recipe.name+' ». Je l’ai ajoutée à ton carnet du Mutateur !'
            : 'Je t’ai déjà confié une recette aujourd’hui. Reviens demain pour la suivante ! Voici le mélange de ce jour :');
        const counts = new Map();
        for (const key of result.recipe.ingredients) counts.set(key, (counts.get(key)||0)+1);
        const names = new Map(rules.catalog.classic.map(b => ['corrupted_'+b.key, b.name+' corrompue']));
        copy.push('« '+result.recipe.name+' » : '+[...counts].map(([key,n])=>n+' × '+names.get(key)).join(' + ')+'.');
    }
    return copy.map(text => ({text, imageName:'townspeople.png', portraitFrame:FRAME}));
}
module.exports = {NAME, FRAME, DAY_FLAG, recipes, byKey, choose, pages};

const items=require('../../../data/game/items.json').items;
const RECIPES=Object.freeze(items.filter(i=>i.corruptedHeldItem).map(i=>Object.freeze({key:i.key,name:i.name,description:i.description,base:i.corruptedBase,cost:Object.freeze([{key:i.corruptedBase,quantity:1},...['crystal_shard','clear_crystal','aurora_prism'].map(key=>({key,quantity:40}))])})));
function recipe(key){const r=RECIPES.find(r=>r.key===key);if(!r)throw Error('Recette d’objet corrompu inconnue.');return r;}
function nearby(p){return p?.currentmap==='safari_lab'&&Math.abs(Math.floor(p.x/32)-18)+Math.abs(Math.floor(p.y/32)-9)<=2;}
module.exports={RECIPES,recipe,nearby};

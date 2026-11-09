const {createHash,randomInt}=require('node:crypto');
const catalog=require('../../../data/game/berryMutation.json');
const base=new Set(catalog.classic.map(i=>i.key));
const ingredients=new Set([...base].map(k=>'corrupted_'+k));
const familyByRecipe=new Map(catalog.families.map(f=>[f.ingredients.join('|'),f]));
function recipe(keys){
 if(!Array.isArray(keys)||keys.length!==3||keys.some(k=>!ingredients.has(k)))throw Error('Choisis exactement trois baies corrompues.');
 const sorted=[...keys].sort(),signature=sorted.join('|'),key=createHash('sha256').update('berry-v1:'+signature).digest('hex');
 const family=familyByRecipe.get(signature)||catalog.families[parseInt(key.slice(0,8),16)%catalog.families.length];
 return{key,ingredients:sorted,family:family.id,name:family.name,results:family.results};
}
function mutate(keys,roll=randomInt(100)){
 if(!Number.isInteger(roll)||roll<0||roll>=100)throw Error('Tirage invalide.');
 const r=recipe(keys);let limit=0;const rarity=catalog.rarities.find(x=>(limit+=x.weight)>roll).key;
 return{...r,rarity,itemKey:r.results[rarity]};
}
function growth(crop,now=Date.now()){
 if(!crop)return{stage:'empty',remainingMs:0};
 const elapsed=Math.max(0,now-Number(crop.plantedAt));
 return{...crop,stage:elapsed>=catalog.growthMs?'mature':elapsed>=catalog.seedMs?'sprout':'seed',remainingMs:Math.max(0,catalog.growthMs-elapsed)};
}
module.exports={catalog,base,ingredients,recipe,mutate,growth};

const rules=require('../game/berries/rules');
const housing=()=>require('./housingRepository');
const furniture=require('../game/housing/rules');
const items=require('./itemRepository');
const {dbPool}=require('../config/database');
const {createHash}=require('node:crypto');
async function crops(id,c=dbPool){const[rows]=await c.execute('SELECT furniture_id,slot_index,berry_key,planted_at FROM housing_berry_crops WHERE user_id=?',[id]);return rows.map(r=>({furnitureId:r.furniture_id,slot:Number(r.slot_index),berryKey:r.berry_key,plantedAt:Number(r.planted_at)}));}
function device(h,p,kind){
 const placement=h.floors[p.floor]?.placements.find(x=>x.id===p.furnitureId),definition=furniture.items.get(placement?.key);
 if(!placement||definition?.device!==kind)throw Error('Cet équipement n’est plus installé.');
 return{placement,definition};
}
async function debit(c,id,key,quantity){const[r]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,id,key,quantity]);if(r.affectedRows!==1)throw Error('Il te manque des baies ou des cristaux.');}
async function credit(c,id,key,quantity=1){await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[id,key,quantity]);}
async function plantSlots(id,p,h,c,plantings){
 const{definition}=device(h,p,'berries');
 if(!Array.isArray(plantings)||!plantings.length||plantings.length>definition.slots||plantings.some(x=>!x||!Number.isInteger(x.slot)||x.slot<0||x.slot>=definition.slots||!rules.base.has(x.berryKey))||new Set(plantings.map(x=>x.slot)).size!==plantings.length)throw Error('Choisis des emplacements vides et des baies classiques.');
 const[old]=await c.execute('SELECT slot_index FROM housing_berry_crops WHERE user_id=? AND furniture_id=? FOR UPDATE',[id,p.furnitureId]);
 if(plantings.some(x=>old.some(r=>Number(r.slot_index)===x.slot)))throw Error('Une baie pousse déjà ici. Aucun plant n’a été remplacé.');
 const counts=new Map();for(const x of plantings)counts.set(x.berryKey,(counts.get(x.berryKey)||0)+1);
 for(const[key,n]of [...counts].sort())await debit(c,id,key,n);
 await debit(c,id,'crystal_shard',rules.catalog.crystalCost*plantings.length);
 const plantedAt=Date.now(),planted=plantings.map(x=>({furnitureId:p.furnitureId,slot:x.slot,berryKey:x.berryKey,plantedAt}));
 for(const crop of planted)await c.execute('INSERT INTO housing_berry_crops(user_id,furniture_id,slot_index,berry_key,planted_at) VALUES(?,?,?,?,?)',[id,p.furnitureId,crop.slot,crop.berryKey,plantedAt]);
 h.crops=[...(h.crops||[]),...planted];return planted;
}
function plant(id,p){return housing().mutation(id,'berry-plant',p,async(h,c)=>({crop:(await plantSlots(id,p,h,c,[{slot:p.slot,berryKey:p.berryKey}]))[0]}));}
function plantMany(id,p){return housing().mutation(id,'berry-plant-many',p,async(h,c)=>({planted:await plantSlots(id,p,h,c,p.plantings)}));}
function harvest(id,p){return housing().mutation(id,'berry-harvest',p,async(h,c)=>{
 const{definition}=device(h,p,'berries');if(!Number.isInteger(p.slot)||p.slot<0||p.slot>=definition.slots)throw Error('Emplacement invalide.');
 const[[row]]=await c.execute('SELECT berry_key,planted_at FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=? FOR UPDATE',[id,p.furnitureId,p.slot]);
 if(!row||rules.growth({plantedAt:Number(row.planted_at)}).stage!=='mature')throw Error('Cette baie n’est pas encore mûre.');
 const key='corrupted_'+row.berry_key;await credit(c,id,key);
 await c.execute('DELETE FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=?',[id,p.furnitureId,p.slot]);
 h.crops=(h.crops||[]).filter(x=>x.furnitureId!==p.furnitureId||x.slot!==p.slot);return{itemKey:key};
 });}
function mutate(id,p){return housing().mutation(id,'berry-mutate',p,async(h,c)=>{
 device(h,p,'mutator');const quantity=p.quantity??1;
 if(!Number.isInteger(quantity)||quantity<1||quantity>50)throw Error('Choisis entre 1 et 50 mutations.');
 const r=rules.recipe(p.ingredients),counts=new Map();for(const key of r.ingredients)counts.set(key,(counts.get(key)||0)+1);
 for(const[key,n]of [...counts].sort())await debit(c,id,key,n*quantity);
 const mutations=Array.from({length:quantity},()=>rules.mutate(r.ingredients)),rewards=new Map();
 for(const result of mutations)rewards.set(result.itemKey,(rewards.get(result.itemKey)||0)+1);
 for(const[key,n]of [...rewards].sort())await credit(c,id,key,n);
 await c.execute('INSERT INTO berry_recipe_discoveries(user_id,recipe_key,ingredients_json,family_key,attempts) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE attempts=attempts+VALUES(attempts)',[id,r.key,JSON.stringify(r.ingredients),r.family,quantity]);
 return{mutation:mutations.at(-1),mutations:mutations.map(result=>({...result,quantity:rewards.get(result.itemKey)})).filter((result,i,all)=>all.findIndex(r=>r.itemKey===result.itemKey)===i),quantity};
 });}
function harvestAll(id,p){return housing().mutation(id,'berry-harvest-all',p,async(h,c)=>{
 const{definition}=device(h,p,'berries'),now=Date.now();
 const[rows]=await c.execute('SELECT slot_index,berry_key,planted_at FROM housing_berry_crops WHERE user_id=? AND furniture_id=? ORDER BY slot_index FOR UPDATE',[id,p.furnitureId]);
 const ready=rows.filter(r=>Number(r.slot_index)>=0&&Number(r.slot_index)<definition.slots&&rules.growth({plantedAt:Number(r.planted_at)},now).stage==='mature');
 if(!ready.length)throw Error('Aucune baie n’est encore prête à récolter.');
 const harvested=[];
 for(const row of ready){const itemKey='corrupted_'+row.berry_key,slot=Number(row.slot_index);await credit(c,id,itemKey);await c.execute('DELETE FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=?',[id,p.furnitureId,slot]);harvested.push({slot,itemKey});}
 const slots=new Set(harvested.map(r=>r.slot));h.crops=(h.crops||[]).filter(r=>r.furnitureId!==p.furnitureId||!slots.has(r.slot));return{harvested};
 });}
const FAVORITE_PREFIX='berry_fav:';
const PLANT_FAVORITE_PREFIX='berry_plant_fav:',MAX_PLANT_FAVORITES=64;
function plantingProfile(berries){
 if(!Array.isArray(berries)||!berries.length||berries.length>3||berries.some(k=>k!==null&&!rules.base.has(k))||!berries.some(Boolean))throw Error('Plantation favorite invalide.');
 const keys=[...berries];while(keys.at(-1)===null)keys.pop();
 return{key:createHash('sha256').update(JSON.stringify(keys)).digest('hex'),berries:keys};
}
async function plantingFavorites(id,c=dbPool){
 const[rows]=await c.execute("SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'berry!_plant!_fav:%' ESCAPE '!'",[id]);
 return rows.flatMap(row=>{try{const p=plantingProfile(JSON.parse(row.flag_value));return row.flag_key===PLANT_FAVORITE_PREFIX+p.key?[p]:[];}catch{return[];}}).slice(0,MAX_PLANT_FAVORITES);
}
function plantFavorite(id,p){return housing().mutation(id,'berry-plant-favorite',p,async(h,c)=>{
 const{definition}=device(h,p,'berries'),profile=plantingProfile(p.berries);
 if(typeof p.favorite!=='boolean'||profile.berries.length>definition.slots)throw Error('Plantation favorite invalide.');
 const flag=PLANT_FAVORITE_PREFIX+profile.key;
 if(p.favorite){const saved=await plantingFavorites(id,c);if(!saved.some(x=>x.key===profile.key)&&saved.length>=MAX_PLANT_FAVORITES)throw Error('Tu as déjà 64 plantations favorites. Retire-en une avant d’en ajouter.');await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,flag,JSON.stringify(profile.berries)]);}
 else await c.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[id,flag]);
 return{plantFavorite:{...profile,favorite:p.favorite}};
});}
function favorite(id,p){return housing().mutation(id,'berry-favorite',p,async(h,c)=>{
 device(h,p,'mutator');
 if(!/^[a-f0-9]{64}$/.test(p.recipeKey||'')||typeof p.favorite!=='boolean')throw Error('Favori de recette invalide.');
 const[[known]]=await c.execute('SELECT recipe_key FROM berry_recipe_discoveries WHERE user_id=? AND recipe_key=? FOR UPDATE',[id,p.recipeKey]);
 if(!known)throw Error('Cette recette n’a pas encore été découverte.');
 if(p.favorite)await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'1') ON DUPLICATE KEY UPDATE flag_value='1'",[id,FAVORITE_PREFIX+p.recipeKey]);
 else await c.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[id,FAVORITE_PREFIX+p.recipeKey]);
 return{favorite:{key:p.recipeKey,value:p.favorite}};
 });}
async function panel(id,h,p){
 const{definition}=device(h,p,p.kind==='mutator'?'mutator':'berries');
 const[rows]=await dbPool.execute('SELECT recipe_key,ingredients_json,family_key,attempts FROM berry_recipe_discoveries WHERE user_id=? ORDER BY first_at DESC',[id]);
 const[favorites]=await dbPool.execute("SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'berry!_fav:%' ESCAPE '!'",[id]);const favoriteKeys=new Set(favorites.map(r=>r.flag_key.slice(FAVORITE_PREFIX.length)));
 return{kind:p.kind,home:h,furnitureId:p.furnitureId,floor:p.floor,slots:definition.slots||0,serverNow:Date.now(),items:await items.loadUserItems(id),plantFavorites:p.kind==='mutator'?[]:await plantingFavorites(id),recipes:rows.map(r=>({...rules.recipe(typeof r.ingredients_json==='string'?JSON.parse(r.ingredients_json):r.ingredients_json),favorite:favoriteKeys.has(r.recipe_key),attempts:Number(r.attempts)}))};
}
module.exports={crops,plant,plantMany,plantFavorite,plantingProfile,harvest,harvestAll,mutate,favorite,panel};

const rules=require('../game/berries/rules');
const housing=()=>require('./housingRepository');
const furniture=require('../game/housing/rules');
const items=require('./itemRepository');
const {dbPool}=require('../config/database');
async function crops(id,c=dbPool){const[rows]=await c.execute('SELECT furniture_id,slot_index,berry_key,planted_at FROM housing_berry_crops WHERE user_id=?',[id]);return rows.map(r=>({furnitureId:r.furniture_id,slot:Number(r.slot_index),berryKey:r.berry_key,plantedAt:Number(r.planted_at)}));}
function device(h,p,kind){
 const placement=h.floors[p.floor]?.placements.find(x=>x.id===p.furnitureId),definition=furniture.items.get(placement?.key);
 if(!placement||definition?.device!==kind)throw Error('Cet équipement n’est plus installé.');
 return{placement,definition};
}
async function debit(c,id,key,quantity){const[r]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,id,key,quantity]);if(r.affectedRows!==1)throw Error('Il te manque des baies ou des cristaux.');}
async function credit(c,id,key){await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[id,key]);}
function plant(id,p){return housing().mutation(id,'berry-plant',p,async(h,c)=>{
 const{definition}=device(h,p,'berries');
 if(!Number.isInteger(p.slot)||p.slot<0||p.slot>=definition.slots||!rules.base.has(p.berryKey))throw Error('Choisis un emplacement vide et une baie classique.');
 const[[old]]=await c.execute('SELECT slot_index FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=? FOR UPDATE',[id,p.furnitureId,p.slot]);if(old)throw Error('Une baie pousse déjà ici.');
 await debit(c,id,p.berryKey,1);await debit(c,id,'crystal_shard',rules.catalog.crystalCost);
 const crop={furnitureId:p.furnitureId,slot:p.slot,berryKey:p.berryKey,plantedAt:Date.now()};
 await c.execute('INSERT INTO housing_berry_crops(user_id,furniture_id,slot_index,berry_key,planted_at) VALUES(?,?,?,?,?)',[id,p.furnitureId,p.slot,p.berryKey,crop.plantedAt]);
 h.crops=[...(h.crops||[]),crop];return{crop};
 });}
function harvest(id,p){return housing().mutation(id,'berry-harvest',p,async(h,c)=>{
 const{definition}=device(h,p,'berries');if(!Number.isInteger(p.slot)||p.slot<0||p.slot>=definition.slots)throw Error('Emplacement invalide.');
 const[[row]]=await c.execute('SELECT berry_key,planted_at FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=? FOR UPDATE',[id,p.furnitureId,p.slot]);
 if(!row||rules.growth({plantedAt:Number(row.planted_at)}).stage!=='mature')throw Error('Cette baie n’est pas encore mûre.');
 const key='corrupted_'+row.berry_key;await credit(c,id,key);
 await c.execute('DELETE FROM housing_berry_crops WHERE user_id=? AND furniture_id=? AND slot_index=?',[id,p.furnitureId,p.slot]);
 h.crops=(h.crops||[]).filter(x=>x.furnitureId!==p.furnitureId||x.slot!==p.slot);return{itemKey:key};
 });}
function mutate(id,p){return housing().mutation(id,'berry-mutate',p,async(h,c)=>{
 device(h,p,'mutator');const r=rules.recipe(p.ingredients),counts=new Map();for(const key of r.ingredients)counts.set(key,(counts.get(key)||0)+1);
 for(const[key,n]of [...counts].sort())await debit(c,id,key,n);
 const result=rules.mutate(r.ingredients);await credit(c,id,result.itemKey);
 await c.execute('INSERT INTO berry_recipe_discoveries(user_id,recipe_key,ingredients_json,family_key) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE attempts=attempts+1',[id,r.key,JSON.stringify(r.ingredients),r.family]);
 return{mutation:result};
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
 return{kind:p.kind,home:h,furnitureId:p.furnitureId,floor:p.floor,slots:definition.slots||0,serverNow:Date.now(),items:await items.loadUserItems(id),recipes:rows.map(r=>({...rules.recipe(typeof r.ingredients_json==='string'?JSON.parse(r.ingredients_json):r.ingredients_json),favorite:favoriteKeys.has(r.recipe_key),attempts:Number(r.attempts)}))};
}
module.exports={crops,plant,harvest,harvestAll,mutate,favorite,panel};

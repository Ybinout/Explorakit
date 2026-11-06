const {transaction}=require('./corruptionRepository');
const {recipe}=require('../game/corruption/heldCrafting');
async function craft(userId,payload){
 const r=recipe(payload?.itemKey);
 return transaction(userId,'held_craft',payload,async c=>{
  for(const {key,quantity}of r.cost){
   const [spent]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,userId,key,quantity]);
   if(spent.affectedRows!==1)throw Error('Composants insuffisants. Aucun objet ni cristal n’a été consommé.');
  }
  await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,r.key]);
  return {created:true,itemKey:r.key,cost:r.cost};
 });
}
module.exports={craft};

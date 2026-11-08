const {withTransaction}=require('../config/database');
const training=require('../game/items/automaticTraining');
const {rowToPokemon}=require('./teamRepository');
const {persistResult}=require('./medicineRepository');
async function step(userId,goal,options={}){
 return withTransaction(async c=>{
  const [[owner]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);if(!owner)throw Error('Dresseur introuvable.');
  require('../game/social/tradeLocks').assertUnlocked(userId,options.leaseToken);
  await require('./darkBattleRepository').assertInactive(userId,c);
  const [[row]]=await c.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',[userId,goal.pokemonUuid]);
  if(!row)throw Error('Ce Pokémon ne fait plus partie de ton équipe.');
  const pokemon=rowToPokemon(row),[[item]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=? FOR UPDATE',[userId,goal.itemKey]);
  const change=training.batch(pokemon,goal,Number(item?.quantity)||0,options);
  if(change.consumed){
   const [spent]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[change.consumed,userId,goal.itemKey,change.consumed]);
   if(!spent.affectedRows)throw Error('Le stock a changé. Réessaie.');
   await persistResult(c,pokemon.uuid,change.result);const {trainingChange,...updates}=change.result;Object.assign(pokemon,updates);
  }
  return {...change,pokemon};
 });
}
module.exports={step};

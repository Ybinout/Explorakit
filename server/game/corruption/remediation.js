const {createHash}=require('node:crypto');
const balance=require('./balance'),modules=require('./modules'),mutation=require('./pokemon');
const teams=require('../../persistence/teamRepository');
function cleanRow(row,plateTypes={}){
 const corruption=mutation.normalize(row.corruption);
 if(!corruption||!balance.restricted(row.pokemon_id))return null;
 const p=teams.rowToPokemon(row),refund=new Map(),add=(key,n=1)=>refund.set(key,(refund.get(key)||0)+n);
 for(const [family,installed]of Object.entries(corruption.modules)){
  const item=modules.get(installed.itemKey),m=item.corruptionModule;
  if(['move','ability'].includes(family))add(item.key);
  // Refund the plaques used by the currently installed modules, not old
  // replaced modules or failed syntheses. Crystals are outside this refund.
  const type=m.type||plateTypes[family];
  if(type)add('dark_plate_'+type.toLowerCase(),require('../../../data/game/corruption_recipes.json').families[family].plates);
 }
 const modifiedMove=mutation.moduleOf(p,'move')?.move;
 if(modifiedMove){const slot=p.abilities.indexOf(modifiedMove);if(slot>=0){
  // Legacy modules did not record the forgotten move. Remove only their own
  // slot instead of inventing a replacement or rewriting the remaining set.
  p.abilities.splice(slot,1);p.movePp.splice(slot,1);
  if(!p.abilities.length){const move=require('../models/moveLearning').availableLevelMoves(p.data.id,p.level).at(-1);if(!move)throw Error('Aucune capacité naturelle de repli.');p.abilities=[move];p.movePp=[require('../battle/battleResources').getMaxMovePp(move)];}
 }}
 p.corruption=null;
 p.data=require('../../../data/game/pokedex.json').find(d=>d.id===p.data.id);
 [p.type1,p.type2]=p.data.type;
 p.passiveAbility=require('../abilities/abilityDex').normalizeSpeciesAbility(p.data.id,row.passive_ability,require('../abilities/abilityDex').createDeterministicRandom(p.uuid));
 if(p.heldItem&&!require('../items/heldItemPolicy').canHold(p,p.heldItem)){add(p.heldItem);p.heldItem=null;}
 p.recalculateStats();p.currentHp=Math.min(p.maxHp,Math.max(0,Number(row.current_hp)||0));
 const values=teams.pokemonToRow(p,row.team_id,row.position),canonical=Object.fromEntries(teams.POKEMON_COLUMNS.map((key,i)=>[key,values[i]]));
 const changed={...row,corruption:null,passive_ability:canonical.passive_ability,held_item:canonical.held_item,current_hp:canonical.current_hp};
 for(const key of ['current_attack','current_defense','current_special_attack','current_special_defense','current_speed','ability1','ability2','ability3','ability4','move1_pp','move2_pp','move3_pp','move4_pp'])changed[key]=canonical[key];
 return{before:row,after:changed,refund:[...refund].filter(([,n])=>n>0).map(([key,quantity])=>({key,quantity})),modules:corruption.modules};
}
function receiptId(userId,uuid){const hash=createHash('sha256').update('legendary-uncorrupt-v1:'+userId+':'+uuid).digest('hex');return hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);}
module.exports={cleanRow,receiptId};

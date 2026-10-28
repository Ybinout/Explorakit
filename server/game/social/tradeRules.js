const {createHash}=require('node:crypto');
const catalog=new Map(require('../../../data/game/items.json').items.map(i=>[i.key,i]));
const storage=require('../storage/pokemonStorage');
const {encodePokemon}=require('../../persistence/pokemonStorageRepository');
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
const MAX_ITEMS=6;
function itemAllowed(key){const i=catalog.get(key);return !!i&&i.category!=='key'&&!i.purchaseLimit&&key!=='exp_share';}
function normalizeOffer(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Offre invalide.');
 const uuid=value.pokemonUuid??null;
 if(uuid!==null&&(typeof uuid!=='string'||!/^[0-9a-f-]{36}$/i.test(uuid)))fail('Pokémon invalide.');
 const items=value.items??[];if(!Array.isArray(items)||items.length>MAX_ITEMS)fail('Choisis au maximum six objets différents.');
 const keys=new Set();
 const result=items.map(i=>{if(!i||!itemAllowed(i.key)||keys.has(i.key))fail('Cet objet ne peut pas être échangé.');if(!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99)fail('Quantité invalide.');keys.add(i.key);return{key:i.key,quantity:i.quantity};}).sort((a,b)=>a.key.localeCompare(b.key));
 return{pokemonUuid:uuid,items:result};
}
function findPokemon(snapshot,uuid){
 const index=snapshot.team.findIndex(p=>p.uuid===uuid),entry=snapshot.entries.find(e=>e.pokemon.uuid===uuid);
 if(index>=0&&entry)fail('Ce Pokémon apparaît à deux emplacements. Rouvre ton PC.');
 return index>=0?{pokemon:snapshot.team[index],source:{kind:'team',index}}:entry?{pokemon:entry.pokemon,source:{kind:'box',box:entry.box,slot:entry.slot}}:null;
}
function checkOffer(snapshot,offer){
 let selected=null;
 if(offer.pokemonUuid){selected=findPokemon(snapshot,offer.pokemonUuid);if(!selected)fail('Ce Pokémon n’est plus dans ton équipe ou ton PC.');if(selected.pokemon.isEgg)fail('Un Œuf ne peut pas être proposé.');if(selected.pokemon.heldItem&&!itemAllowed(selected.pokemon.heldItem))fail('Retire son objet personnel avant de proposer ce Pokémon.');}
 for(const i of offer.items)if((snapshot.items[i.key]||0)<i.quantity)fail(`Tu n’as plus assez de ${catalog.get(i.key).name}.`);
 return selected;
}
function planTrade(snapshots,offers){
 const selected=snapshots.map((s,i)=>checkOffer(s,offers[i]));
 if(selected[0]&&selected[1]&&selected[0].pokemon.uuid===selected[1].pokemon.uuid)fail('Ce Pokémon ne peut pas être proposé des deux côtés.');
 const plans=snapshots.map(s=>({team:[...s.team],entries:s.entries.map(e=>({...e})),items:{...s.items},received:null}));
 for(let i=0;i<2;i++){
  const selectedPokemon=selected[i];if(selectedPokemon){if(selectedPokemon.source.kind==='team')plans[i].team.splice(selectedPokemon.source.index,1);else plans[i].entries=plans[i].entries.filter(e=>e.pokemon.uuid!==selectedPokemon.pokemon.uuid);}
  for(const item of offers[i].items)plans[i].items[item.key]-=item.quantity;
 }
 for(let i=0;i<2;i++){
  const incoming=selected[1-i]?.pokemon,own=selected[i];
  if(incoming){
   if(own?.source.kind==='team')plans[i].team.splice(own.source.index,0,incoming);
   else if(plans[i].team.length<6)plans[i].team.push(incoming);
   else plans[i].entries.push({...storage.freeSlot(plans[i].entries),pokemon:incoming});
   plans[i].received=incoming;
  }
  for(const item of offers[1-i].items)plans[i].items[item.key]=(plans[i].items[item.key]||0)+item.quantity;
  if(!plans[i].team.some(storage.isAble))fail('Chaque dresseur doit garder au moins un Pokémon apte dans son équipe.');
 }
 return plans;
}
function review(snapshots,rawOffers,ids){
 const offers=rawOffers.map(normalizeOffer),selected=snapshots.map((s,i)=>checkOffer(s,offers[i]));
 const empty=offers.every(o=>!o.pokemonUuid&&!o.items.length);let error='';
 if(empty)error='Ajoute au moins un Pokémon ou un objet à l’échange.';
 else try{planTrade(snapshots,offers);}catch(e){error=e.message;}
 const assets=selected.map((p,i)=>({pokemon:p?{source:p.source,data:JSON.parse(encodePokemon(p.pokemon))}:null,stock:offers[i].items.map(item=>[item.key,snapshots[i].items[item.key]])}));
 const digest=createHash('sha256').update(JSON.stringify({ids,offers,assets})).digest('hex');
 return{digest,offers,error,summaries:offers.map((o,i)=>({pokemon:selected[i]?storage.view([selected[i].pokemon],[]).team[0]:null,source:selected[i]?.source||null,items:o.items.map(item=>({...item,name:catalog.get(item.key).name,description:catalog.get(item.key).description||'',category:catalog.get(item.key).category}))}))};
}
function inventory(snapshot){const result=storage.view(snapshot.team,snapshot.entries);for(const p of [...result.team,...result.entries.map(e=>e.pokemon)]){const original=findPokemon(snapshot,p.uuid).pokemon;p.unavailableReason=original.isEgg?'Les Œufs ne sont pas échangeables.':original.heldItem&&!itemAllowed(original.heldItem)?'Retire son objet personnel avant de le proposer.':'';}return{...result,items:Object.entries(snapshot.items).filter(([key,n])=>n>0&&itemAllowed(key)).map(([key,quantity])=>({key,quantity,name:catalog.get(key).name,category:catalog.get(key).category,description:catalog.get(key).description||'',fieldUse:catalog.get(key).fieldUse||null})).sort((a,b)=>a.name.localeCompare(b.name,'fr'))};}
module.exports={MAX_ITEMS,catalog,itemAllowed,normalizeOffer,checkOffer,planTrade,review,inventory};

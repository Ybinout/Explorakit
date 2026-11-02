const {onAccountEvent}=require('../accountConnection');
const workstations=require('../../game/corruption/workstations');
const modules=require('../../game/corruption/modules');
const repository=require('../../persistence/corruptionRepository');
const {loadUserItems}=require('../../persistence/itemRepository');
const dark=require('../../persistence/darkContinentRepository');
const LOCKED='Je ne comprends rien à tout ce charabia… Peut-être devrais-je en apprendre plus sur ces cristaux.';
function registerCorruptionHandlers({socket,userId,getPlayer,canUse,canInteract}){
 const player=()=>{const p=getPlayer();if(!p||p.inbattle||p.inventoryBusy||p.superTournamentActive||!canUse())throw Error('Termine ton action avant de manipuler les modules.');return p;};
 async function open(){const p=getPlayer(),station=workstations.stationAt(p);if(!station||!canInteract()||p.inbattle||p.inventoryBusy)return false;
  const state=await dark.loadState(userId),unlocked=state.owned;
  socket.emit('corruptionPanel',{station:station.family,unlocked,message:unlocked?'':LOCKED,items:unlocked?await loadUserItems(userId):[]});return true;
 }
 onAccountEvent(socket,'corruption:craft',async(data,ack)=>{let locked;try{const p=player(),station=workstations.stationAt(p);if(!station||station.family!==data?.family)throw Error('Installe-toi sur le siège de la bonne station du laboratoire.');locked=p;p.inventoryBusy=true;
   const result=await repository.craft(userId,data),items=await loadUserItems(userId);socket.emit('bagUpdated',{items});if(typeof ack==='function')ack({success:true,...result,items});
  }catch(e){if(e.code)console.error('Fabrication corrompue :',e.message);if(typeof ack==='function')ack({success:false,message:e.code?'La sauvegarde est indisponible. Réessaie pour retrouver le résultat de cette opération.':e.message});}finally{if(locked)locked.inventoryBusy=false;}});
 onAccountEvent(socket,'corruption:install',async(data,ack)=>{let locked;try{const p=player();if(!modules.get(data?.itemKey))throw Error('Module introuvable.');locked=p;p.inventoryBusy=true;
   const result=await repository.install(userId,data);p.equipe.pokemons=result.equipe.pokemons;const items=await loadUserItems(userId),pcState=data.source==='box'?await require('../../persistence/pokemonStorageRepository').loadStorage(userId):null;
   socket.emit('teamStateChanged',{equipe:p.equipe,reason:'corruption'});socket.emit('bagUpdated',{items});if(pcState)socket.emit('pcUpdated',pcState);
   if(typeof ack==='function')ack({success:true,...result,equipe:p.equipe,items,pcState});
  }catch(e){if(e.code)console.error('Installation corrompue :',e.message);if(typeof ack==='function')ack({success:false,message:e.code?'La sauvegarde est indisponible. Rouvre la fiche avant de réessayer.':e.message});}finally{if(locked)locked.inventoryBusy=false;}});
 return{interact:open};
}
module.exports={registerCorruptionHandlers,LOCKED};

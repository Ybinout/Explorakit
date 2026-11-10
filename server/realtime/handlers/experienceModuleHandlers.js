const {onAccountEvent}=require('../accountConnection');
const repository=require('../../persistence/experienceModuleRepository');
const {loadUserItems}=require('../../persistence/itemRepository');
function registerExperienceModuleHandlers({socket,userId,getPlayer,canUse=()=>true}){
 onAccountEvent(socket,'darkAerial:set',async(payload,ack)=>{const reply=typeof ack==='function'?ack:()=>{},p=getPlayer();if(!p||p.inbattle||p.inventoryBusy||!canUse())return reply({success:false,message:'Termine ton action avant de régler le module.'});p.inventoryBusy=true;try{const state=await require('../../persistence/darkAerialRepository').setActive(userId,payload?.active);const items=await loadUserItems(userId);const flight=await require('../../persistence/flightRepository').loadFlightState(userId);socket.emit('bagUpdated',{items});socket.emit('flightState',flight);reply({success:true,items,flight,state});}catch(e){reply({success:false,message:e.code?'Enregistrement indisponible.':e.message});}finally{p.inventoryBusy=false;}});
 onAccountEvent(socket,'setExperienceModule',async(payload,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{},player=getPlayer();
  if(!player||player.inbattle||player.inventoryBusy||!canUse())return reply({success:false,message:'Attends la fin de l’action en cours.'});
  player.inventoryBusy=true;
  try{
   const state=await repository.setActive(userId,payload?.active);
   player.experienceModuleActive=state.active;
   socket.emit('experienceModuleState',state);
   const items=await loadUserItems(userId);socket.emit('bagUpdated',{items});reply({success:true,items,experienceModule:state});
  }catch(error){if(error.code)console.error('Module d’expérience indisponible:',error.message);reply({success:false,message:error.code?'Sauvegarde indisponible. Réessaie dans un instant.':error.message});}
  finally{player.inventoryBusy=false;}
 });
}
module.exports={registerExperienceModuleHandlers};

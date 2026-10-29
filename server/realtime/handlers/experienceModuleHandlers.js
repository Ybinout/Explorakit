const {onAccountEvent}=require('../accountConnection');
const repository=require('../../persistence/experienceModuleRepository');
const {loadUserItems}=require('../../persistence/itemRepository');
function registerExperienceModuleHandlers({socket,userId,getPlayer,canUse=()=>true}){
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

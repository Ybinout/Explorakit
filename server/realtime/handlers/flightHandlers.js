const {onAccountEvent}=require('../accountConnection');
const repository=require('../../persistence/flightRepository');
const {flightDestination}=require('../../game/world/flightTravel');
function registerFlightHandlers({socket,userId,getPlayer,canUse,setBusy,travel,loadState=repository.loadFlightState,now=Date.now,getFriendLocation,loadProgress=()=>require('../../persistence/progressionRepository').loadProgressState(userId),verifyFriend=async()=>true}){
 let busy=false,lastFlight=-Infinity;
 for(const event of ['flyToHouse','flyToFriend','flyToTown'])onAccountEvent(socket,event,async(data,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{},player=getPlayer();
  if(busy||!player||player.inbattle||player.inventoryBusy||player.isInteracting||!canUse())return reply({success:false,message:'Termine ton action avant de prendre ton envol.'});
  const dark=require('../../game/world/darkContinent');if(dark.isMap(player.currentmap))return reply({success:false,message:dark.EXIT_MESSAGE});
  if(now()-lastFlight<3000)return reply({success:false,message:'Attends un instant avant de repartir.'});
  busy=true;setBusy(true);player.inventoryBusy=true;
  try{
   require('../../game/social/tradeLocks').assertUnlocked(userId);
   const state=await loadState(userId);if(!state.unlocked)return reply({success:false,message:'Raphael te confiera le module Vol après ta victoire.'});
   if(state.owned===false)return reply({success:false,message:'Le Module Vol doit être dans ton sac.'});
   let target;
   if(event==='flyToHouse'){
    if(!state.house)return reply({success:false,message:'Tu ne possèdes plus cette maison.'});
    const {map,x,y}=state.house;target={map,x,y};
   }else if(event==='flyToFriend'){
    const id=require('../../persistence/socialMessageRepository').userId(data?.targetId);const progress=await loadProgress();
    if(!await verifyFriend(id))throw Object.assign(Error('Ce dresseur ne fait pas partie de tes amis.'),{statusCode:403});
    if(!getFriendLocation)throw Error('Ce voyage est indisponible.');target=require('../../game/world/friendFlight').destination(getFriendLocation(id),state,progress);
   }else{target=flightDestination(data?.map);if(!target)return reply({success:false,message:'Cette destination ne permet pas d’atterrir.'});if(!state.visited.includes(target.map))return reply({success:false,message:'Tu dois d’abord visiter cette ville.'});}
   if(getPlayer()!==player||!socket.connected||player.inbattle)return;
   await travel(target,player);lastFlight=now();reply({success:true,destination:target});
  }catch(error){reply({success:false,code:error.code==='zone_inaccessible'?error.code:undefined,message:error.statusCode||event==='flyToFriend'?error.message:'Le voyage n’a pas pu être confirmé. Réessaie dans un instant.'});}
  finally{player.inventoryBusy=false;setBusy(false);busy=false;}
 });
}
module.exports={registerFlightHandlers};

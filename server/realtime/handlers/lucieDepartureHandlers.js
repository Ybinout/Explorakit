const {randomUUID}=require('node:crypto');
const {config}=require('../../game/world/lucieDeparture');
const repository=require('../../persistence/lucieDepartureRepository');
const {loadProgressState}=require('../../persistence/progressionRepository');
async function depart({socket,userId,player,getPlayer,setLeaving,emitProgression,syncPeers}) {
 if(player.currentmap!==config.map||player.inbattle||player.inventoryBusy)return;
 player.inventoryBusy=true;player.isMoving=false;
 try {
  if(!await repository.begin(userId))return;
  const progress=await loadProgressState(userId);
  if(!socket.connected||getPlayer()!==player)return;
  setLeaving(true);
  socket.emit('lucieDeparture',{...config,id:randomUUID(),active:true});
  syncPeers(progress); // The originating socket retains the actor until the vortex ends.
  await new Promise(resolve=>setTimeout(resolve,config.duration));
 } finally {
  setLeaving(false);player.inventoryBusy=false;
  if(socket.connected&&getPlayer()===player){emitProgression(await loadProgressState(userId));socket.emit('lucieDeparture',{map:config.map,active:false});}
 }
}
module.exports={depart};

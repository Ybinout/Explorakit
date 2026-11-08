const {onAccountEvent,trackAccountTask}=require('../accountConnection');
const training=require('../../game/items/automaticTraining');
function registerAutomaticTrainingHandlers({socket,userId,getPlayer,canUse=()=>true,repository=require('../../persistence/automaticTrainingRepository'),loadItems=require('../../persistence/itemRepository').loadUserItems,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 let job=null;
 const snapshot=()=>job?{id:job.id,...job.goal,phase:job.phase,used:job.used,stock:job.stock,remaining:job.remaining,before:job.before,current:job.current,message:job.message||''}:null;
 const publish=()=>socket.emit('training:autoState',snapshot());
 const active=()=>job?.phase==='running';
 async function run(p){
  try{
   do{
    if(job.cancelled||!socket.connected||getPlayer()!==p||p.inbattle||!canUse()){job.phase='cancelled';break;}
    const result=await repository.step(userId,job.goal,{leaseToken:job.leaseToken});
    job.before??=result.before;job.stock??=result.remaining+result.consumed;job.used+=result.consumed;job.current=result.after;job.remaining=result.remaining;
    const pokemon=p.equipe.pokemons.find(v=>v.uuid===job.goal.pokemonUuid);if(!pokemon)throw Error('Le Pokémon a quitté ton équipe.');
    Object.assign(pokemon,result.pokemon);
    if(result.reached)job.phase='complete';else if(!result.remaining)job.phase='exhausted';else if(job.cancelled||!socket.connected)job.phase='cancelled';
    socket.emit('teamStateChanged',{equipe:p.equipe,reason:'automatic_training'});publish();
    if(active())await pause(180);
   }while(active());
  }catch(error){job.phase='error';job.message=error.code?'Relances interrompues. Les utilisations déjà confirmées sont sauvegardées.':error.message;if(error.code)console.error('Relances automatiques :',error.message);}
  finally{
   try{socket.emit('bagUpdated',{items:await loadItems(userId)});}catch(error){console.error('Actualisation du sac :',error.message);}
   require('../../game/social/tradeLocks').release([userId],job.leaseToken);p.inventoryBusy=false;publish();
  }
 }
 onAccountEvent(socket,'training:autoStart',async(payload,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{},p=getPlayer();
  try{
   if(typeof payload?.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(payload.id))throw Error('Demande de relance invalide.');
   if(job?.id===payload.id)return reply({success:true,state:snapshot()});
   if(active()||!p||p.inbattle||p.inventoryBusy||!canUse())throw Error('Attends la fin de l’action en cours.');
   const goal=training.normalize(payload);if(!p.equipe?.pokemons?.some(v=>v.uuid===goal.pokemonUuid))throw Error('Choisis un Pokémon de ton équipe.');
   const leaseToken='training:'+socket.id+':'+payload.id;require('../../game/social/tradeLocks').acquire([userId],leaseToken);
   job={id:payload.id,goal,leaseToken,phase:'running',used:0,stock:null,remaining:null,current:null,before:null,cancelled:false};p.inventoryBusy=true;publish();reply({success:true,state:snapshot()});
   trackAccountTask(socket,run(p));
  }catch(error){reply({success:false,message:error.message});}
 });
 onAccountEvent(socket,'training:autoCancel',(payload,ack)=>{
  if(active()&&payload?.id===job.id)job.cancelled=true;
  if(typeof ack==='function')ack({success:true,state:snapshot()});
 });
 socket.once('disconnect',()=>{if(active())job.cancelled=true;});
 return {state:snapshot,cancel:()=>{if(active())job.cancelled=true;}};
}
module.exports={registerAutomaticTrainingHandlers};

const repository=require('../../persistence/flightRepository');
const {flightDestination}=require('../../game/world/flightTravel');
function registerFlightHandlers({socket,userId,getPlayer,canUse,setBusy,travel,loadState=repository.loadFlightState,now=Date.now}){
    let busy=false,lastFlight=-Infinity;
    socket.on('flyToTown',async(data,ack)=>{
        const reply=typeof ack==='function'?ack:()=>{};const player=getPlayer();
        if(busy||!player||player.inbattle||player.inventoryBusy||player.isInteracting||!canUse())return reply({success:false,message:'Termine ton action avant de prendre ton envol.'});
        const target=flightDestination(data?.map);
        if(!target)return reply({success:false,message:'Cette destination ne permet pas d’atterrir.'});
        if(now()-lastFlight<3000)return reply({success:false,message:'Attends un instant avant de repartir.'});
        busy=true;setBusy(true);player.inventoryBusy=true;
        try{
            const state=await loadState(userId);
            if(!state.unlocked)return reply({success:false,message:'Wanda te confiera le module Vol après ta victoire.'});
            if(!state.visited.includes(target.map))return reply({success:false,message:'Tu dois d’abord visiter cette ville.'});
            if(getPlayer()!==player||!socket.connected||player.inbattle)return;
            await travel(target,player);lastFlight=now();
            reply({success:true,destination:target});
        }catch(error){console.error('Vol indisponible:',error.message);reply({success:false,message:'Le voyage n’a pas pu être confirmé. Réessaie dans un instant.'});}
        finally{player.inventoryBusy=false;setBusy(false);busy=false;}
    });
}
module.exports={registerFlightHandlers};

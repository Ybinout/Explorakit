const safari=require('../../game/world/safari');
function registerSafariHandlers({socket,account,getPlayer,canUse,canInteract,travel}){
 let busy=false,lastTravel=0;
 account.on('safari:travel',async(_data,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{};const p=getPlayer();
  if(busy||!p||p.inbattle||p.inventoryBusy||p.superTournamentActive||!canUse()||!safari.near(p))return reply({success:false,message:'Rejoins le guide et termine ton action avant de partir.'});
  if(Date.now()-lastTravel<1500)return reply({success:false,message:'Laisse le temps au guide de préparer le départ.'});
  if(!p.equipe?.pokemons?.some(p=>p.currentHp>0&&!p.isEgg))return reply({success:false,message:'Prépare au moins un compagnon apte au combat.'});
  busy=true;p.inventoryBusy=true;
  try{const target=p.currentmap==='safari1'?safari.LOBBY:safari.ARRIVAL;await travel(target);lastTravel=Date.now();reply({success:true,destination:target});}
  catch(e){console.error('Voyage Safari :',e.message);reply({success:false,message:'Le départ n’a pas pu être confirmé. Réessaie après reconnexion.'});}
  finally{busy=false;p.inventoryBusy=false;}
 });
 return{async interact(){const p=getPlayer(),actor=safari.near(p);if(!actor||!canInteract()||p.inbattle||p.inventoryBusy||busy)return false;socket.emit('safariTravelOffer',{returning:p.currentmap==='safari1',destination:p.currentmap==='safari1'?safari.LOBBY:safari.ARRIVAL,calendar:safari.calendar()});return true;}};
}
module.exports={registerSafariHandlers};

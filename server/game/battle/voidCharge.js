const{randomUUID}=require('node:crypto');
const totalPp=p=>(p?.movePp||[]).reduce((sum,n)=>sum+(Number(n)||0),0);
function recorder(userId,player,io){const battleId=randomUUID();let action=0,disabled=false;return async(result,ppBefore,attacker)=>{
 const serial=++action;
 if(disabled||!Number.isInteger(userId)||userId<=0||result?.actionPrevented||result?.move?.type!=='Electric'||totalPp(attacker)>=ppBefore)return;
 try{const r=await require('../../persistence/voidEndingRepository').charge(userId,`${battleId}:${serial}`);if(!r.available||!r.found||r.charge>=5)disabled=true;
  if(r.changed){
   io.to(player.id).emit('bagUpdated',{items:await require('../../persistence/itemRepository').loadUserItems(userId)});
   io.to(player.id).emit('progressionNotice',{type:'teleporter_charge',charge:r.charge,message:`Téléporteur chargé à ${r.charge}/5`});
  }
 }catch(error){console.error('Charge de l’objet indisponible:',error.message);}
};}
module.exports={totalPp,recorder};

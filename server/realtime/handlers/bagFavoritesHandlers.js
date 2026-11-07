const repo=require('../../persistence/bagFavoritesRepository');
async function register({socket,account,userId}){
 socket.emit('bagFavoritesState',await repo.load(userId));let busy=false,next=0;
 account.on('bag:setFavorite',async(data,ack)=>{const reply=typeof ack==='function'?ack:()=>{};
  if(busy||Date.now()<next)return reply({success:false,message:'Patiente un instant avant de modifier un autre favori.'});busy=true;next=Date.now()+100;
  try{const state=await repo.set(userId,data?.itemKey,data?.favorite);socket.emit('bagFavoritesState',state);reply({success:true,...state});}catch(e){reply({success:false,message:e.code?'Enregistrement indisponible. Réessaie.':e.message});}finally{busy=false;}
 });
}
module.exports={register};

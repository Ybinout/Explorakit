const {getSocialHub}=require('../socialHub');
const {onAccountEvent}=require('../accountConnection');
const repository=require('../../persistence/trainerRepository');
const messages=require('../../persistence/socialMessageRepository');
async function registerSocialHandlers({io,socket,getLocation}){
 const hub=getSocialHub(io),userId=messages.userId(socket.data.user.id);
 let until=0,count=0,messageUntil=0,messageCount=0;
 function command(event,fn,isMessage=false){onAccountEvent(socket,event,async(data={},ack)=>{
  if(typeof data==='function'){ack=data;data={};}
  const reply=typeof ack==='function'?ack:()=>{};
  try{
   if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(Error('Requête invalide.'),{statusCode:400});
   const now=Date.now();if(now>=until){until=now+10000;count=0;}if(++count>40)throw Object.assign(Error('Patiente un instant avant de réessayer.'),{statusCode:429});
   if(isMessage){if(now>=messageUntil){messageUntil=now+10000;messageCount=0;}if(++messageCount>12)throw Object.assign(Error('Laisse un instant à tes amis pour répondre.'),{statusCode:429});}
   reply({success:true,...await fn(data)});
  }catch(error){if(!error.statusCode)console.error('Carnet social :',error.message);reply({success:false,message:error.statusCode?error.message:'Le carnet est temporairement indisponible.'});}
 });}
 command('social:refresh',async()=>{await hub.reload(userId);return{state:hub.state(userId)};});
 command('social:online',d=>{const result=hub.onlineDirectory(userId,d.offset??0);if(d.targetId!=null){const targetId=messages.userId(d.targetId);result.target={id:targetId,...hub.presence(targetId)};}return result;});
 command('social:search',async d=>{const result=await repository.search(userId,d.query,d.offset??0);return{...result,entries:result.entries.filter(p=>p.id!==userId).map(p=>({...p,...hub.presence(p.id)}))};});
 command('social:friend',async d=>{const target=messages.userId(d.targetId),result=await repository.friendAction(userId,target,d.action);await hub.friendsChanged(userId,target);return{...result,state:hub.state(userId)};});
 command('social:history',d=>messages.history(userId,d.targetId,d.before));
 command('social:send',async d=>({message:await hub.directMessage(userId,d)}),true);
 command('social:read',d=>hub.read(userId,d.targetId,d.through));
 command('social:color',async d=>{const result=await repository.setFriendColor(userId,d.targetId,d.color);await hub.reload(userId);return{...result,state:hub.state(userId)};});
 command('social:details',d=>require('../../persistence/friendProfileRepository').details(userId,d.targetId,d.view));
 // Old cached clients get an explicit answer; no group state or operation remains.
 for(const event of ['groupInvite','groupAnswer','groupLeave','groupKick','groupMessage'])command('social:'+event,()=>{throw Object.assign(Error('Les amis se retrouvent désormais directement sur la minimap.'),{statusCode:410});});
 const actions=new Set(['presence:activity','playerAction','Space','actionResponse','social:send','social:friend','fishing:start','fishing:reel','useMedicine','useTrainingItem','buyShopItem','sellShopItem']);
 const active=event=>{if(actions.has(event))hub.activity(socket);};
 socket.onAny(active);socket.once('disconnect',()=>socket.offAny(active));
 try{await hub.attach(socket,getLocation);}catch(error){console.error('Chargement du carnet social :',error.message);socket.emit('social:error',{message:'Le carnet est temporairement indisponible.'});}
 return hub;
}
module.exports={registerSocialHandlers};

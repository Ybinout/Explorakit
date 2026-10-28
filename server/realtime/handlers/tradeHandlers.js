const {onAccountEvent}=require('../accountConnection');
const {getTradeManager}=require('../tradeManager');
function registerTradeHandlers({io,socket,...context}){
 const manager=getTradeManager(io),id=Number(socket.data.user.id);manager.attach({...context,id,socket,username:socket.data.user.username});
 let until=0,count=0;
 const operations={request:d=>manager.request(id,d.targetId),answer:d=>manager.answer(id,d),inventory:async d=>({inventory:await manager.inventory(id,d)}),offer:d=>manager.offer(id,d),ready:d=>manager.ready(id,d),edit:d=>manager.edit(id,d),confirm:d=>manager.confirm(id,d),cancel:d=>manager.cancel(id,d),close:d=>manager.close(id,d),refresh:d=>manager.refresh(id,d)};
 for(const[name,fn]of Object.entries(operations))onAccountEvent(socket,'trade:'+name,async(data={},ack)=>{
  if(typeof data==='function'){ack=data;data={};}const reply=typeof ack==='function'?ack:()=>{};
  try{if(Date.now()>=until){until=Date.now()+10000;count=0;}if(++count>40)throw Object.assign(Error('Patiente un instant entre deux actions.'),{statusCode:429});if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(Error('Requête invalide.'),{statusCode:400});const result=await fn(data);reply({success:true,...(name==='inventory'?result:{state:result})});}
  catch(error){if(!error.statusCode)console.error('Échange indisponible :',error.message);reply({success:false,message:error.statusCode?error.message:'L’échange est temporairement indisponible.',state:manager.view(id)});}
 });return manager;
}
module.exports={registerTradeHandlers};

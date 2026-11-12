const repo=require('../../persistence/talentTreeRepository'),catalog=require('../../game/talents/catalog');
function register({socket,account,userId,getPlayer,canUse=()=>true,canInteract=canUse}){
 let busy=false,at=0,count=0;
 const valid=()=>{const p=getPlayer();if(!p||p.inbattle||p.raidActive||p.inventoryBusy||busy||!canUse())throw Error('Termine ton activité avant de modifier tes talents.');return p;};
 async function open(){const p=getPlayer();if(!p||p.inbattle||p.raidActive||p.inventoryBusy||busy||!canInteract())return;socket.emit('talentTreePanel',await repo.state(userId));}
 for(const action of ['open','purchase','buy','refund'])account.on('talents:'+action,async(data,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{};let p,acquired=false;
  try{if(Date.now()-at>1000){at=Date.now();count=0;}if(++count>6)throw Error('Patiente un instant.');
   p=valid();if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>4096)throw Error('Confirmation invalide.');busy=true;p.inventoryBusy=true;acquired=true;
   if(action==='purchase'&&require('../../game/magicIsland/rules').near(p)?.name!=='magic_neighbor')throw Error('Retrouve le chercheur sur l’Île Magique pour acheter son module.');
   const result=action==='open'?null:await repo[action](userId,data),state=await repo.state(userId);
   if(action!=='open'){
    const effects=require('../../game/talents/effects');effects.attach(p.equipe,state.bonuses);
    socket.emit('bagUpdated',{items:await require('../../persistence/itemRepository').loadUserItems(userId)});socket.emit('whitepeak:wallet',{balance:state.money});
    if(action==='purchase'&&!result.duplicate)socket.emit('uniqueItemReceived',{key:catalog.moduleKey,name:'Module Arbre de Talents'});
   }
   if(action==='open')socket.emit('talentTreePanel',state);reply({success:true,state,result});
  }catch(e){if(e.code)console.error('Talents:',e.code);reply({success:false,message:e.code?'Sauvegarde indisponible. Réessaie la même confirmation.':e.message});}
  finally{if(acquired){p.inventoryBusy=false;busy=false;}}
 });
 return{open};
}
module.exports={register};

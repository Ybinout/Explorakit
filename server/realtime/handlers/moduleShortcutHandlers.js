const repository=require('../../persistence/moduleShortcutRepository');
async function registerModuleShortcutHandlers({socket,account,userId,getPlayer,canUse=()=>true}) {
    socket.emit('moduleShortcutState',await repository.load(userId));
    account.on('setModuleShortcut',async(data,ack)=>{
        const reply=typeof ack==='function'?ack:()=>{},p=getPlayer();
        if(!p||p.inbattle||p.inventoryBusy||!canUse())return reply({success:false,message:'Termine ton action avant de modifier le raccourci.'});
        p.inventoryBusy=true;
        try{const state=await repository.assign(userId,data?.itemKey);socket.emit('moduleShortcutState',state);reply({success:true,...state});}
        catch(error){reply({success:false,message:error.code?'Sauvegarde indisponible. Réessaie dans un instant.':error.message});}
        finally{p.inventoryBusy=false;}
    });
}
module.exports={registerModuleShortcutHandlers};

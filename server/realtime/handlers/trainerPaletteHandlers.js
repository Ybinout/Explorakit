const { onAccountEvent } = require('../accountConnection');
const {EventEmitter}=require('node:events');
const {normalizeTrainerPalette}=require('../../game/world/trainerPalette');
const {saveUserSpritePalette}=require('../../persistence/playerRepository');
const changes=new EventEmitter();changes.setMaxListeners(0);
const writes=new Map();
function saveInOrder(id,key,save) {
    const task=(writes.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
        await save(id,key);changes.emit('change',id,key);return key;
    });
    writes.set(id,task);task.finally(()=>{if(writes.get(id)===task)writes.delete(id);}).catch(()=>{});
    return task;
}
function registerTrainerPaletteHandlers({socket,userId,getPlayer,broadcast,save=saveUserSpritePalette}) {
    let busy=false,closed=false;
    const changed=(id,key)=>{
        const p=getPlayer();if(closed||id!==userId||!p)return;
        p.spritePalette=key;broadcast(p,key);
    };
    changes.on('change',changed);
    socket.once('disconnect',()=>{closed=true;changes.off('change',changed);});
    onAccountEvent(socket, 'setTrainerPalette',async(payload={},acknowledge)=>{
        const reply=typeof acknowledge==='function'?acknowledge:()=>{};
        const key=normalizeTrainerPalette(payload?.palette),p=getPlayer();
        if(closed||!p||!key||busy)return reply({success:false,message:'Couleur indisponible. Réessaie.'});
        if(p.spritePalette===key)return reply({success:true,palette:key});
        busy=true;
        try{await saveInOrder(userId,key,save);reply({success:true,palette:key});}
        catch(error){console.error('Enregistrement couleur dresseur:',error.message);reply({success:false,message:'Impossible d’enregistrer la couleur. Réessaie.'});}
        finally{busy=false;}
    });
}
module.exports={registerTrainerPaletteHandlers};

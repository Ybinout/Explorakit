const repository = require('../../persistence/pokemonStorageRepository');
const { requireComputer } = require('../../game/world/pokemonComputer');
const { loadUserItems } = require('../../persistence/itemRepository');
function registerPokemonComputerHandlers({socket,io,userId,getPlayer,getPeers,canUse}) {
    async function access(payload, ack, mutate) {
        const reply=typeof ack==='function'?ack:()=>{};
        const p=getPlayer(),peers=getPeers();
        try {
            if(!p || !canUse() || peers.some(a=>a.inbattle || a.inventoryBusy)) throw Error('Attends la fin de l’action en cours.');
            requireComputer(p);
        } catch(e) { reply({success:false,message:e.message});return; }
        for(const peer of peers)peer.inventoryBusy=true;
        try {
            const result=mutate?await repository.mutateStorage(userId,payload):{success:true,state:await repository.loadStorage(userId)};
            if(result.equipe)for(const peer of getPeers())peer.equipe.pokemons=result.equipe.pokemons;
            if(mutate){
                const items=await loadUserItems(userId);result.items=items;
                for(const peer of getPeers()){io.to(peer.id).emit('teamStateChanged',{equipe:peer.equipe,reason:'pc'});io.to(peer.id).emit('bagUpdated',{items});io.to(peer.id).emit('pcUpdated',result.state);}
            }
            if(!mutate)socket.emit('pcOpened',result.state);
            reply(result);return result;
        } catch(e) {
            if(e.code)console.error('PC indisponible:',e.message);
            const message=e.code?'Le PC est temporairement indisponible. Rouvre-le pour vérifier ton équipe.':e.message;
            reply({success:false,message});if(!mutate)socket.emit('progressionNotice',{message});
        } finally {for(const peer of peers)peer.inventoryBusy=false;}
    }
    const open=()=>access(undefined,undefined,false);
    socket.on('pc:open',(_payload,ack)=>access(undefined,ack,false));
    socket.on('pc:action',(payload,ack)=>access(payload,ack,true));
    return {open};
}
module.exports={registerPokemonComputerHandlers};

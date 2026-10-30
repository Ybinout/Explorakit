const {onAccountEvent}=require('../accountConnection');
const {reorderPokemonMoves}=require('../../persistence/moveOrderRepository');
function registerMoveOrderHandlers({socket,userId,getPlayer,canUse=()=>true,persist=reorderPokemonMoves}) {
    onAccountEvent(socket,'reorderMoves',async(payload,ack)=>{
        const reply=typeof ack==='function'?ack:()=>{},p=getPlayer();
        if(!p || p.inbattle || p.inventoryBusy || !canUse())return reply({success:false,message:'Attends la fin de l’action en cours.'});
        const pokemon=p.equipe?.pokemons?.find(poke=>poke.uuid===payload?.pokemonUuid);
        if(!pokemon)return reply({success:false,message:'Ce Pokémon ne t’appartient pas.'});
        p.inventoryBusy=true;
        try {
            const result=await persist(userId,pokemon.uuid,payload);
            Object.assign(pokemon,result);
            socket.emit('teamStateChanged',{equipe:p.equipe,reason:'move_order'});
            reply({success:true,equipe:p.equipe});
        }catch(error){
            if(error.code)console.error('Ordre des capacités non enregistré:',error.message);
            reply({success:false,message:error.code?'Sauvegarde indisponible. Rouvre la fiche avant de réessayer.':error.message});
        }finally{p.inventoryBusy=false;}
    });
}
module.exports={registerMoveOrderHandlers};

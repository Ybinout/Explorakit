function registerPositionRecoveryHandlers({socket,getPlayer,canUse,recover,now=Date.now}) {
    let busy=false;
    socket.on('recoverPosition',async (data,ack) => {
        if (typeof data === 'function') ack=data;
        const reply=typeof ack==='function'?ack:()=>{};
        const player=getPlayer();
        if (busy || !player || player.inbattle || player.inventoryBusy || !canUse()) {
            return reply({success:false,message:'Termine ton action avant de débloquer ton personnage.'});
        }
        if (Number.isFinite(player.lastPositionRecovery) && now()-player.lastPositionRecovery < 10000) {
            return reply({success:false,message:'Patiente quelques secondes avant de réessayer.'});
        }
        busy=true;
        try {
            await recover(player); // Coordinates and map are always chosen by the server.
            player.lastPositionRecovery=now();
            reply({success:true,message:'Personnage replacé sur une case accessible à proximité.'});
        } catch (error) {
            console.error('Repositionnement indisponible:',error.message);
            reply({success:false,message:'Impossible de sauvegarder le repositionnement. Réessaie dans un instant.'});
        } finally { busy=false; }
    });
}
module.exports={registerPositionRecoveryHandlers};

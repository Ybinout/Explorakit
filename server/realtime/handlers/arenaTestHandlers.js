const policy = require('../../game/world/arenaTests');
const repository = require('../../persistence/arenaTestRepository');
const { loadProgressState } = require('../../persistence/progressionRepository');

function registerArenaTestHandlers({socket,getPlayer,getPeers,canUse,emitProgression}) {
    let busy = false;
    socket.on('admin:rearmArenas', async (_payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const user = socket.data.user;
        if (!policy.isOwner(user)) return reply({success:false,message:'Accès réservé au compte de test.'});
        const player = getPlayer();
        if (busy || !player || !canUse() || getPeers().some(p=>p.inbattle||p.inventoryBusy))
            return reply({success:false,message:'Termine le combat ou le dialogue avant de réactiver les arènes.'});
        busy = true; player.inventoryBusy = true;
        try {
            const {count} = await repository.rearm(user);
            const progress = await loadProgressState(user.id);
            if (socket.connected && getPlayer() === player) emitProgression(progress);
            reply({success:true,count,state:policy.publicState(user,progress)});
        } catch (error) {
            console.error('Réactivation des arènes:',error.message);
            reply({success:false,message:'Réactivation impossible. Réessaie dans un instant.'});
        } finally { busy = false; player.inventoryBusy = false; }
    });
}
module.exports = { registerArenaTestHandlers };

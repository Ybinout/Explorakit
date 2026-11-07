// Socket boundary only: the manager serializes mutations and commits before publishing.
function registerRaidHandlers({
  manager,
  socket,
  account,
  userId,
  getPlayer,
  username,
  canUse,
  travel,
  afterFinish
}) {
  const context = {
    id: Number(userId),
    username,
    socket,
    getPlayer,
    canUse,
    travel,
    afterFinish,
    supported: socket.handshake?.auth?.corruptionRaids === 1
  };
  let windowAt = 0,
    count = 0;
  const command = (name, work) => account.on('raid:' + name, async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (!context.supported) throw Error('Actualise le jeu pour participer aux raids.');
      const now = Date.now();
      if (now - windowAt > 1000) {
        windowAt = now;
        count = 0;
      }
      if (++count > 12) throw Error('Patiente un instant.');
      const result = await work(data || {});
      reply({
        success: true,
        ...result
      });
    } catch (error) {
      if (error.code) console.error('Commande raid :', error.message);
      reply({
        success: false,
        message: error.code ? 'La faille est temporairement indisponible.' : error.message
      });
    }
  });
  command('open', d => manager.open(context.id, d.riftId));
  command('enter', async d => ({
    state: await manager.enter(context.id, d.riftId)
  }));
  command('inventory', () => ({
    pokemons: manager.inventory(context.id)
  }));
  command('select', d => manager.select(context.id, d).then(() => ({})));
  command('extra', d => manager.extra(context.id, Number(d.ownerId)).then(() => ({})));
  command('ready', () => manager.readyPlayer(context.id).then(() => ({})));
  command('start', () => manager.start(context.id).then(() => ({})));
  command('action', d => manager.action(context.id, d).then(() => ({})));
  command('chat', d => manager.chat(context.id, d.text).then(() => ({})));
  command('leave', () => manager.leave(context.id).then(() => ({})));
  command('remove', d => manager.remove(context.id, Number(d.userId)).then(() => ({})));
  command('invite', d => manager.invite(context.id, Number(d.userId)).then(() => ({})));
  command('invitation', d => manager.accept(context.id, d.id, d.accept === true).then(() => ({})));
  command('tutorial', () => manager.tutorial(context.id).then(() => ({})));
  account.onClose(() => manager.detach(context));
  return {
    async initialize() {
      await manager.attach(context);
    },
    async interact() {
      if (!context.supported) return false;
      const r = manager.nearby(context.id);
      if (!r) return false;
      socket.emit('raid:open', await manager.open(context.id, r.id));
      return true;
    }
  };
}
module.exports = {
  registerRaidHandlers
};

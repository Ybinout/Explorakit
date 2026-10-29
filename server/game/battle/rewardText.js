// New clients pace reward reading locally; older clients keep their original delay.
// This only presents rewards already computed by the authoritative battle.
async function rewardText(player, io, message, wait, delayMs = 900) {
    const capable = io.sockets?.sockets?.get(player.id)?.handshake?.auth?.rewardPlayback === true;
    io.to(player.id).emit('battleText', { message, ...(capable ? { reward: true, readMs: delayMs } : {}) });
    if (!capable && delayMs > 0) await wait(delayMs);
}
module.exports = { rewardText };

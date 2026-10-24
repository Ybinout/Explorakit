// One real-world clock for Adventure, Rift and Colosseum. No player preference
// and no timer per connection; clients resynchronise on reconnect/foreground.
function registerWorldClock(socket, now = Date.now) {
    const snapshot = () => ({ serverTime: now(), timeZone: 'Europe/Paris', cycle: 'real-day' });
    socket.emit('worldClockState', snapshot());
    socket.on('worldClock:sync', reply => {
        if (typeof reply === 'function') reply(snapshot());
    });
}
module.exports = { registerWorldClock };

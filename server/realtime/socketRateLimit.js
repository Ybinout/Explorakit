// One shared bucket per authenticated account, including simultaneous sockets.
function createSocketRateLimit({ now = Date.now, windowMs = 10000, limit = 160 } = {}) {
    const buckets = new Map();
    let lastSweep = 0;
    return (socket) =>
        socket.use((packet, next) => {
            const time = now();
            if (time - lastSweep >= windowMs) {
                for (const [key, bucket] of buckets) if (bucket.until <= time) buckets.delete(key);
                lastSweep = time;
            }
            const key = socket.data.user.id;
            let bucket = buckets.get(key);
            if (!bucket || bucket.until <= time) {
                bucket = { count: 0, until: time + windowMs };
                if (buckets.size >= 10000 && !buckets.has(key)) return socket.disconnect(true);
                buckets.set(key, bucket);
            }
            if (++bucket.count <= limit) return next();
            const acknowledge = packet[packet.length - 1];
            if (typeof acknowledge === 'function')
                acknowledge({
                    ok: false,
                    success: false,
                    code: 'rate_limit',
                    message: 'Trop d’actions. Patiente quelques secondes.',
                });
        });
}
module.exports = { createSocketRateLimit };

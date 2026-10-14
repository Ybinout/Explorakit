function rateLimit({ limit = 60, windowMs = 60000, now = Date.now } = {}) {
    const entries = new Map();
    let lastSweep = 0;
    return (req, res, next) => {
        const time = now();
        if (time - lastSweep > windowMs) {
            for (const [k, v] of entries) if (v.until <= time) entries.delete(k);
            lastSweep = time;
        }
        const key = req.user?.id || req.ip || req.socket?.remoteAddress;
        let item = entries.get(key);
        if (!item || item.until <= time) {
            if (entries.size >= 10000) return res.status(429).send({ message: 'Réessaie dans un instant.' });
            item = { count: 0, until: time + windowMs };
            entries.set(key, item);
        }
        if (++item.count > limit) {
            res.set('Retry-After', String(Math.ceil((item.until - time) / 1000)));
            return res.status(429).send({ message: 'Trop de tentatives. Réessaie dans une minute.' });
        }
        next();
    };
}
module.exports = { rateLimit };

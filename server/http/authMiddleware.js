const { verifyAccessToken } = require('../config/auth');

function getBearerToken(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') return null;
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}

function normalizeUser(payload) {
    const id = Number.parseInt(payload?.sub, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Identité invalide');
    return {
        id,
        username: typeof payload.username === 'string' ? payload.username : ''
    };
}

function authenticateHttp(req, res, next) {
    try {
        const token = getBearerToken(req.headers.authorization);
        if (!token) return res.status(401).send({ message: 'Authentification requise.' });
        req.user = normalizeUser(verifyAccessToken(token));
        return next();
    } catch (error) {
        return res.status(401).send({ message: 'Session invalide ou expirée.' });
    }
}

function authenticateSocket(socket, next) {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string' || !token) return next(new Error('Authentification requise.'));
        socket.data.user = normalizeUser(verifyAccessToken(token));
        return next();
    } catch (error) {
        return next(new Error('Session invalide ou expirée.'));
    }
}

module.exports = { authenticateHttp, authenticateSocket, getBearerToken };

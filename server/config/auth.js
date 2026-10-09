const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET est obligatoire en production.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'explorakit-local-development-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signAccessToken(user) {
    return jwt.sign(
        {
            sub: String(user.id),
            username: user.username
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

module.exports = {
    signAccessToken,
    verifyAccessToken
};

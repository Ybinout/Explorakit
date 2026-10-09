const DEFAULT_DIALOGUE_TTL_MS = 120000;

function createDialogueAuthorization({ name, map, x, y }, now = Date.now()) {
    if (typeof name !== 'string' || !name || typeof map !== 'string' || !map) return null;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    return { name, map, x, y, expiresAt: now + DEFAULT_DIALOGUE_TTL_MS };
}

function isDialogueCompletionAllowed(authorization, request, now = Date.now()) {
    if (!authorization || !request) return false;
    if (authorization.name !== request.name || authorization.map !== request.map) return false;
    if (authorization.expiresAt < now) return false;
    if (!Number.isInteger(request.playerX) || !Number.isInteger(request.playerY)) return false;
    const distance = Math.abs(request.playerX - authorization.x) + Math.abs(request.playerY - authorization.y);
    return distance <= 1;
}

module.exports = {
    DEFAULT_DIALOGUE_TTL_MS,
    createDialogueAuthorization,
    isDialogueCompletionAllowed
};

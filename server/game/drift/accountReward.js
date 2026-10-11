const { DURATIONS } = require('./lobbyStore');
const REWARD_VERSION = 1;
const COINS_PER_PLAYER_MINUTE = 2.5;
const MAX_EXPLORATION_MS = Math.max(...DURATIONS) * 60000;

function calculateAccountReward(participantCount, explorationMs, hasWinner = true) {
    if (!Number.isInteger(participantCount) || participantCount < 2 || participantCount > 16) {
        throw new RangeError('La récompense RiftMon requiert entre 2 et 16 participants.');
    }
    if (!Number.isInteger(explorationMs) || explorationMs < 0 || explorationMs > MAX_EXPLORATION_MS) {
        throw new RangeError(`La durée d’exploration RiftMon doit être comprise entre 0 et ${MAX_EXPLORATION_MS / 60000} minutes.`);
    }
    if (typeof hasWinner !== 'boolean') throw new TypeError('La présence d’un vainqueur RiftMon doit être explicite.');
    return {
        version: REWARD_VERSION,
        participantCount,
        explorationMs,
        coinsPerPlayerMinute: COINS_PER_PLAYER_MINUTE,
        coinsAwarded: hasWinner ? Math.floor(participantCount * explorationMs * COINS_PER_PLAYER_MINUTE / 60000) : 0
    };
}

module.exports = { REWARD_VERSION, COINS_PER_PLAYER_MINUTE, MAX_EXPLORATION_MS, calculateAccountReward };

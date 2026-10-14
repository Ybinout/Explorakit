const { waveInfo } = require('../drift/colosseum');
const INITIAL_RATING = 1000;
const K = 48;
const names = ['Bronze', 'Argent', 'Or', 'Platine', 'Diamant'];
const keys = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const eloThresholds = [0, 1200, 1400, 1600, 1800];
const scoreAt = wins => Array.from({ length: wins }, (_, i) => waveInfo(i + 1).points).reduce((a, b) => a + b, 0);
const colosseumThresholds = [0, 10, 20, 30, 40].map(scoreAt);
function rank(value, thresholds, played = true) {
    if (!played) return { key: 'unranked', name: 'Non classé', minimum: 0, next: { name: 'Bronze', minimum: thresholds[0] }, progress: 0 };
    const index = thresholds.reduce((last, threshold, i) => value >= threshold ? i : last, 0);
    const next = index < names.length - 1 ? { name: names[index + 1], minimum: thresholds[index + 1] } : null;
    return { key: keys[index], name: names[index], minimum: thresholds[index], next,
        progress: next ? Math.max(0, Math.min(100, Math.floor(100 * (value - thresholds[index]) / (next.minimum - thresholds[index])))) : 100 };
}
const riftRank = (rating = INITIAL_RATING, games = 0) => rank(rating, eloThresholds, games > 0);
const colosseumRank = (score = 0, wins = 0) => rank(score, colosseumThresholds, wins > 0);

// Elimination rounds define shared places. Time spent hiding in exploration
// and the order of simultaneous eliminations never break a tie.
function placements(ids, report, winnerId) {
    if (!report || report.mode === 'colosseum' || !Array.isArray(report.players)
        || report.players.length !== ids.length || new Set(report.players.map(p => p.id)).size !== ids.length
        || !report.players.every(p => ids.includes(p.id))) return null;
    const rounds = ids.map(userId => ({ userId, round: userId === winnerId ? Infinity : Math.max(0,
        ...(report.matches || []).filter(m => m.players?.includes(userId) && ['finished', 'bye'].includes(m.status)).map(m => Number(m.round) || 0)) }));
    return rounds.map(row => ({ userId: row.userId, place: 1 + rounds.filter(other => other.round > row.round).length }));
}
function calculateRatings(players) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 16
        || new Set(players.map(p => p.userId)).size !== players.length
        || !players.every(p => Number.isSafeInteger(p.rating) && p.rating >= 0 && Number.isInteger(p.place) && p.place >= 1 && p.place <= players.length))
        throw Error('Classement Rift invalide.');
    const result = players.map(p => {
        const adjustment = players.filter(q => q.userId !== p.userId).reduce((sum, q) => {
            const expected = 1 / (1 + 10 ** ((q.rating - p.rating) / 400));
            const actual = p.place < q.place ? 1 : p.place === q.place ? .5 : 0;
            return sum + K * (actual - expected) / (players.length - 1);
        }, 0);
        return { userId: p.userId, place: p.place, before: p.rating, adjustment, delta: Math.floor(adjustment) };
    });
    // Largest-remainder rounding keeps the integer adjustments balanced.
    let remainder = -result.reduce((sum, p) => sum + p.delta, 0);
    for (const p of [...result].sort((a,b) => (b.adjustment-b.delta)-(a.adjustment-a.delta) || a.userId-b.userId)) {
        if (remainder-- > 0) p.delta++;
    }
    return result.map(({ adjustment, ...p }) => ({ ...p, delta: Math.max(-p.before, p.delta), after: Math.max(0, p.before+p.delta) }));
}
module.exports = { INITIAL_RATING, K, riftRank, colosseumRank, eloThresholds, colosseumThresholds, placements, calculateRatings };

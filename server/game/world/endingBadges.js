const catalog = require('../../../data/game/progression.json');
const arenaTests = require('./arenaTests');

// A private admin replay has its own choice and claim. Never rewrite the
// original reward, but use the replay consistently for the case and its gates.
function effectiveEndingBadges(badges, flags = {}, owner) {
    if (flags.admin_void_replay !== 'true' || !arenaTests.isOwner(owner)) return badges;
    const endings = catalog.badges.filter(b => b.exclusiveGroup === 'professor_finale');
    const keys = new Set(endings.map(b => b.key));
    const resolution = flags.admin_void_defeated === 'true'
        ? (flags.admin_void_resolution === 'pardon' ? 'pardon' : 'violence') : null;
    return [
        ...badges.filter(b => !keys.has(b.key)),
        ...endings.map(definition => ({
            ...definition,
            ...badges.find(b => b.key === definition.key),
            earned: definition.ending === resolution && flags.admin_void_claimed === 'true',
            cracked: Boolean(resolution && definition.ending !== resolution),
            awardedAt: null
        }))
    ];
}

module.exports = { effectiveEndingBadges };

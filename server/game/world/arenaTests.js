const catalog = require('../../../data/game/progression.json');
const { hasCompletedBattle, meetsRequirements } = require('./storyProgression');

// This is a testing privilege for the existing owner account, not a username-based role.
function isOwner(user) { return user?.id === 4 && user?.username === 'binout'; }
const champions = Object.entries(catalog.npcBattles)
    .filter(([, definition]) => definition.enabled !== false && definition.experienceKind === 'arena')
    .map(([name, definition]) => ({name, definition, flag:`admin_arena_replay:${definition.battleKey}`}));
function won(champion, progress = {}) {
    return hasCompletedBattle(champion.definition, progress)
        || Object.entries(champion.definition.reward?.flags || {}).some(([key,value]) => value === 'true' && progress.flags?.[key] === 'true');
}
function eligible(user, progress) {
    return module.exports.isOwner(user) ? champions.filter(c => won(c, progress) && meetsRequirements(c.definition, progress)) : [];
}
function canReplay(user, name, progress) {
    return eligible(user, progress).some(c => c.name === name && progress.flags?.[c.flag] === 'ready');
}
function publicState(user, progress) {
    if (!module.exports.isOwner(user)) return {allowed:false};
    const unlocked = eligible(user, progress);
    return {allowed:true,total:champions.length,unlocked:unlocked.length,ready:unlocked.filter(c=>progress.flags?.[c.flag]==='ready').length};
}
module.exports = { isOwner, champions, eligible, canReplay, publicState };

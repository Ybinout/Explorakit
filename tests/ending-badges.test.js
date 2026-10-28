const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveEndingBadges } = require('../server/game/world/endingBadges');
const catalog = require('../data/game/progression.json');
const owner = { id: 4, username: 'binout' };
const saved = catalog.badges.map(b => ({ ...b, earned: b.key === 'violence_badge', awardedAt: '2026-10-01' }));
const replay = { admin_void_replay: 'true', admin_void_defeated: 'true', admin_void_resolution: 'pardon', admin_void_claimed: 'true' };

test('private replay projects only its choice without mutating the original badges', () => {
    const before = structuredClone(saved);
    const badges = effectiveEndingBadges(saved, replay, owner);
    assert.equal(badges.find(b => b.key === 'pardon_badge').earned, true);
    assert.equal(badges.find(b => b.key === 'pardon_badge').cracked, false);
    assert.equal(badges.find(b => b.key === 'violence_badge').earned, false);
    assert.equal(badges.find(b => b.key === 'violence_badge').cracked, true);
    assert.equal(badges.find(b => b.key === 'pardon_badge').awardedAt, null);
    assert.deepEqual(saved, before);
    assert.deepEqual(badges.filter(b => b.exclusiveGroup !== 'professor_finale'), saved.filter(b => b.exclusiveGroup !== 'professor_finale'));
});

test('no replay or unauthorized identity retains the real badges, even with forged replay flags', () => {
    for (const identity of [undefined, { id: 9, username: 'binout' }, { id: 4, username: 'someone' }]) {
        assert.equal(effectiveEndingBadges(saved, replay, identity), saved);
    }
    assert.equal(effectiveEndingBadges(saved, {}, owner), saved);
});

test('reset hides both endings; Violence is earned only after claiming it, including legacy replay', () => {
    for (const flags of [
        { admin_void_replay: 'true' },
        { ...replay, admin_void_defeated: 'false' }
    ]) {
        const endings = effectiveEndingBadges([], flags, owner);
        assert.equal(endings.length, 2);
        assert(endings.every(b => !b.earned && !b.cracked));
    }
    for (const resolution of ['violence', '']) {
        const flags = { ...replay, admin_void_resolution: resolution, admin_void_claimed: 'false' };
        let badges = effectiveEndingBadges([], flags, owner);
        assert(badges.every(b => !b.earned));
        assert(badges.find(b => b.key === 'pardon_badge').cracked);
        badges = effectiveEndingBadges([], { ...flags, admin_void_claimed: 'true' }, owner);
        assert(badges.find(b => b.key === 'violence_badge').earned);
        assert(!badges.find(b => b.key === 'pardon_badge').earned);
    }
});

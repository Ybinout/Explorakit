const test = require('node:test');
const assert = require('node:assert/strict');
test('latest patch has a stable short receipt key and brief plain text in both supported languages', () => {
    const patch = require('../data/game/latest_patch.json');
    assert.match(patch.version, /^[a-z0-9-]{1,80}$/);
    assert.match(patch.date, /^\d{4}-\d{2}-\d{2}$/);
    assert(Number.isFinite(Date.parse(patch.date)));
    for (const language of ['fr','en']) {
        const copy = patch[language];
        assert(copy.title.length > 0 && copy.title.length <= 70);
        assert(copy.items.length >= 1 && copy.items.length <= 3);
        assert(copy.items.join(' ').length <= 400);
        assert(!/[<>]/.test(copy.title + copy.items.join('')));
    }
});

test('public history keeps every release, newest first including same-day housing', () => {
    const list = require('../server/game/world/patchHistory').history();
    assert.equal(list[0].version,require('../data/game/latest_patch.json').version);
    for(let i=1;i<list.length;i++)assert(list[i-1].date>=list[i].date,'Newest patches must appear first');
    for(const version of ['2026-11-12-ile-magique-balls-motisma','2026-11-12-equipes-entrainement','2026-11-12-sable-grele','2026-11-12-corrections-attaques','2026-11-11-bilan-raids','2026-11-11-infos-sac','2026-11-10-plantations-favorites','2026-11-10-xp-haut-niveau'])assert(list.some(p=>p.version===version),'Missing public patch '+version);
    assert(list.some(p=>p.version==='2026-11-09-brumes-bonbons-double-toucher'));
    assert(list.some(p=>p.version==='2026-11-09-dark-continent-2'));
    assert(list.some(p=>p.version==='2026-11-09-culture-baies'));
    assert.equal(new Set(list.map((p) => p.version)).size, list.length);
    assert(list.some((p) => p.version === '2026-11-08-confort-raids-entrainement'));
});

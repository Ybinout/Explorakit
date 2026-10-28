const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../data/game/progression.json');
const entries = require('../data/game/interact.json');
const { getSentenceForName, getEndSentenceInformation } = require('../server/game/world/interactionRepository');
const champions = ['moon', 'champion_hoze', 'champion_raphael', 'champion_ana', 'champion_wanda', 'champion_7p'];
const definition = name => entries.find(d => d.name === name);
function progress(rescued) {
    return { flags: { ...Object.fromEntries(catalog.storySteps.map(s => [s.flag, 'true'])), lucie_rescued: String(rescued) },
        completedNpcBattles: champions.map(name => ({ battleKey: catalog.npcBattles[name].battleKey })) };
}

test('all six champions acknowledge the actual rescue, retaining their portraits and granting nothing again', () => {
    for (const name of champions) {
        const [sentences, key] = getSentenceForName(name, progress(true));
        assert.equal(key, name + '_rescued');
        assert(sentences.some(s => /Lucie|retrouvée/.test(s.text)), name);
        assert(sentences.every(s => s.imageName === definition(name).sentences[0].imageName));
        assert.equal(getEndSentenceInformation(key), undefined);
        assert(!sentences.some(s => /Voici sa clé|personne ici ne l’a revue|pourrait être en grand danger|Prends le Badge/.test(s.text)));
    }
    const raph = getSentenceForName('champion_raphael', progress(true))[0];
    assert(raph.some(s => s.text.includes('la vérité se trouve parfois sous les choses')));
});

test('the house victory alone is not a rescue; old post-victory clues remain until the lab rescue', () => {
    const before = progress(false);
    assert.equal(before.flags.lucie_freed, 'true');
    for (const name of champions) assert.equal(getSentenceForName(name, before)[1], name + '_after');
    // A late flag never bypasses a champion battle or its access requirements.
    assert.equal(getSentenceForName('champion_ana', { flags: { lucie_rescued: 'true' } })[1], 'champion_ana_locked');
});

test('private admin replays preserve original introductions and the projected rescue chronology', () => {
    for (const name of champions) {
        const saved = progress(true), copy = structuredClone(saved);
        assert.equal(getSentenceForName(name, { ...saved, testReplays: [name] })[1], name);
        assert.equal(getSentenceForName(name, saved, { replayArena: true })[1], name);
        const reset = { ...saved, flags: { ...saved.flags, admin_professor_departure: 'armed', admin_lab_rescued: 'false' } };
        assert.equal(getSentenceForName(name, reset)[1], name + '_after');
        reset.flags.admin_lab_rescued = 'true';
        assert.equal(getSentenceForName(name, reset)[1], name + '_rescued');
        assert.deepEqual(saved, copy);
    }
});

test('Wanda does not refer to Gwenn; his father owns the tunnel demand; Ana no longer invents Raphael’s warning', () => {
    for (const entry of entries.filter(d => d.name.startsWith('champion_wanda') || d.name.startsWith('wanda_professor'))) {
        assert(entry.sentences.every(s => !/Gwenn/i.test(s.text)), entry.name);
    }
    assert(definition('gwenn_father').sentences.some(s => /Bats-le, puis je libérerai le tunnel/.test(s.text)));
    assert(definition('champion_ana').sentences[0].text.includes('ma famille'));
    assert(!definition('champion_ana').sentences.some(s => /Raphael a dû te prévenir/.test(s.text)));
});

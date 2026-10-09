const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createDialogueAuthorization,
    isDialogueCompletionAllowed
} = require('../server/game/world/interactionAuthorization');

test('une action de dialogue exige le nom, la carte et la proximité validés par le serveur', () => {
    const authorization = createDialogueAuthorization({ name: 'centre', map: 'centre', x: 9, y: 5 }, 1000);
    assert.equal(isDialogueCompletionAllowed(authorization, {
        name: 'centre', map: 'centre', playerX: 9, playerY: 6
    }, 2000), true);
    assert.equal(isDialogueCompletionAllowed(authorization, {
        name: 'moon', map: 'centre', playerX: 9, playerY: 6
    }, 2000), false);
    assert.equal(isDialogueCompletionAllowed(authorization, {
        name: 'centre', map: 'centre', playerX: 20, playerY: 20
    }, 2000), false);
});

test('une autorisation de dialogue expire et empêche les rejeux tardifs', () => {
    const authorization = createDialogueAuthorization({ name: 'moon', map: 'ville1', x: 9, y: 8 }, 1000);
    assert.equal(isDialogueCompletionAllowed(authorization, {
        name: 'moon', map: 'ville1', playerX: 9, playerY: 9
    }, authorization.expiresAt + 1), false);
});

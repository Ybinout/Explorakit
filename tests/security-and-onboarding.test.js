const test = require('node:test');
const assert = require('node:assert/strict');

const { signAccessToken, verifyAccessToken } = require('../server/config/auth');
const { getBearerToken } = require('../server/http/authMiddleware');
const { createStarterPokemon, normalizeCredentials } = require('../server/persistence/userRepository');
const { pokemonToRow, rowToPokemon } = require('../server/persistence/teamRepository');
const { toPublicPlayer } = require('../server/realtime/playerState');

test('un jeton signé contient uniquement l’identité serveur attendue', () => {
    const token = signAccessToken({ id: 42, username: 'Sacha' });
    const payload = verifyAccessToken(token);
    assert.equal(payload.sub, '42');
    assert.equal(payload.username, 'Sacha');
    assert.equal(getBearerToken(`Bearer ${token}`), token);
});

test('les identifiants faibles sont refusés avant accès à la base', () => {
    assert.throws(() => normalizeCredentials('ab', 'motdepasse'), /3 et 50/);
    assert.throws(() => normalizeCredentials('Sacha', 'court'), /8 et 128/);
});

test('le starter est jouable et sérialisable sans perdre son UUID', () => {
    const starter = createStarterPokemon();
    const rowValues = pokemonToRow(starter, 7, 1);
    const keys = [
        'uuid', 'team_id', 'position', 'pokemon_id', 'name', 'level', 'experience',
        'iv_attack', 'iv_defense', 'iv_hp', 'iv_special_attack', 'iv_special_defense',
        'iv_speed', 'nature', 'k', 'current_hp', 'status', 'passive_ability', 'held_item', 'current_attack', 'current_defense',
        'current_special_attack', 'current_special_defense', 'current_speed',
        'ability1', 'ability2', 'ability3', 'ability4',
        'move1_pp', 'move2_pp', 'move3_pp', 'move4_pp'
    ];
    const hydrated = rowToPokemon(Object.fromEntries(keys.map((key, index) => [key, rowValues[index]])));

    assert.equal(starter.level, 5);
    assert.equal(starter.experience, 64);
    assert.equal(hydrated.uuid, starter.uuid);
    assert.equal(hydrated.data.id, 1);
    assert.deepEqual(hydrated.abilities, ['Tackle', 'Growl', 'Vine Whip', 'Growth']);
});

test("l'état public d'un joueur n'expose ni équipe ni données privées", () => {
    const publicPlayer = toPublicPlayer({
        id: 'socket-1', userId: 42, username: 'Sacha', x: 80, y: 208,
        sprite: 'sprite.png', direction: 'down', currentmap: 'start',
        equipe: { pokemons: [{ uuid: 'secret' }] }, password_hash: 'secret'
    });

    assert.equal(publicPlayer.username, 'Sacha');
    assert.equal(publicPlayer.currentmap, 'start');
    assert.equal('equipe' in publicPlayer, false);
    assert.equal('password_hash' in publicPlayer, false);
});

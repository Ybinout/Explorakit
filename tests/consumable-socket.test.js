const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
const { signAccessToken } = require('../server/config/auth');
const { registerDriftLobbies } = require('../server/realtime/driftLobbyHandler');
const { decode } = require('../server/game/drift/checkpointCodec');
const economy = require('../server/game/drift/economy');
const factory = require('../server/game/drift/pokemonFactory');
const command = (socket, name, payload = {}) => new Promise((resolve,reject) => socket.timeout(4000).emit(name,payload,(error,result)=>error?reject(error):resolve(result)));

for (const mode of ['rift', 'colosseum-30', 'colosseum-60']) {
    test(`${mode}: bag healing is owned, consumed once, persisted and never revives a KO`, { timeout: 15000 }, async () => {
        let checkpoint;
        const server = http.createServer(), io = new Server(server);
        const cleanup = registerDriftLobbies(io, { checkpointRepository: { async save(bytes) { checkpoint = bytes; } } });
        server.listen(0, '127.0.0.1');await once(server, 'listening');
        const sockets = [], users = [{ id: 801, username: 'Bag tester' }, { id: 802, username: 'Other trainer' }];
        try {
            for (const user of users) {
                const socket = client(`http://127.0.0.1:${server.address().port}/drift`, { autoConnect: false, auth: { token: signAccessToken(user) }, transports: ['websocket'], reconnection: false });
                sockets.push(socket);const ready = once(socket, 'drift:bootstrap');socket.connect();await ready;
            }
            const [socket, other] = sockets;
            if (mode === 'rift') {
                const { lobby } = await command(socket, 'drift:create', { capacity: 2, durationMinutes: 20 });
                await command(other, 'drift:join', { code: lobby.code });
                await command(socket, 'drift:ready', { ready: true });await command(other, 'drift:ready', { ready: true });
                await command(socket, 'drift:start');await command(other, 'drift:enter');
            } else await command(socket, 'colosseum:start', { durationMinutes: Number(mode.split('-')[1]) });
            await command(socket, 'drift:enter');
            const p = cleanup.runtime.playerFor(users[0]), pokemon = factory.create(7, 30);
            p.equipe.pokemons = [pokemon];pokemon.currentHp = 1;
            p.items = { drift_potion: 1, potion: 1, super_potion: 1, antidote: 1, oran_berry: 1, sitrus_berry: 1, lum_berry: 1, revive: 1 };
            const use = (itemKey, pokemonUuid = pokemon.uuid) => command(socket, 'drift:heal', { itemKey, pokemonUuid });
            assert.equal((await use('potion', 'foreign-pokemon')).success, false);
            assert.equal(p.items.potion, 1);assert.equal(pokemon.currentHp, 1);
            const healed = await use('drift_potion');assert.equal(healed.success, true);
            assert.equal(pokemon.currentHp, 21);assert.equal(p.items.drift_potion, 0);
            assert.equal((await use('drift_potion')).success, false);
            const savedPlayer = decode(checkpoint).runs.get(p.run.id).players.get(users[0].id);
            assert.equal(savedPlayer.equipe.pokemons[0].currentHp, 21);assert.equal(savedPlayer.items.drift_potion, 0);
            for (const [key, amount] of [['potion', 20], ['super_potion', 50], ['oran_berry', 10], ['sitrus_berry', Math.floor(pokemon.maxHp / 4)]]) {
                pokemon.currentHp = 1;
                const replies = await Promise.all([use(key), use(key)]);
                assert.equal(replies.filter(r => r.success).length, 1);
                assert.equal(pokemon.currentHp, 1 + amount);assert.equal(p.items[key], 0);
            }
            pokemon.currentHp = pokemon.maxHp;pokemon.status = 'badly_poison';
            assert.equal((await use('antidote')).success, true);assert.equal(pokemon.status, 'normal');
            assert.equal((await use('lum_berry')).success, false);assert.equal(p.items.lum_berry, 1);
            pokemon.status = 'paralyze';assert.equal((await use('lum_berry')).success, true);assert.equal(pokemon.status, 'normal');
            p.items.potion = 2;pokemon.currentHp = 0;
            assert.equal((await use('potion')).success, false);assert.equal((await use('revive')).success, false);
            assert.equal(pokemon.currentHp, 0);assert.equal(p.items.potion, 2);
            pokemon.currentHp = 1;p.inbattle = true;
            assert.equal((await use('potion')).success, false);assert.equal(p.items.potion, 2);p.inbattle = false;
            p.run.phase = 'colosseum_ready';assert.equal((await use('potion')).success, false);p.run.phase = 'exploration';
            // Level-up decisions use the same owned, checkpointed command channel in all three formats.
            const learner = factory.create(1, 5);
            learner.gainExperience(learner.getNextLevelExpForLevel(14) - learner.experience);
            p.equipe.pokemons.push(learner);
            const learn = (data) => command(socket, 'drift:learnMove', data);
            const choice = { pokemonUuid: learner.uuid, choiceId: learner.pendingMoves[0].id, slot: 0 };
            assert.equal((await learn({ ...choice, pokemonUuid: 'foreign' })).success, false);
            p.inbattle = true;assert.equal((await learn(choice)).success, false);p.inbattle = false;
            p.run.phase = 'colosseum_ready';
            const replies = await Promise.all([learn(choice), learn(choice)]);
            assert.equal(replies.filter(r=>r.success).length, 1);
            assert.equal(learner.abilities[0], 'Leech Seed');assert.equal(learner.abilities.length, 4);
            const learned = decode(checkpoint).runs.get(p.run.id).players.get(users[0].id).equipe.pokemons[1];
            assert.deepEqual(learned.pendingMoves, learner.pendingMoves);assert.equal(learned.abilities[0], 'Leech Seed');
            assert.equal((await learn({pokemonUuid:learner.uuid,choiceId:learner.pendingMoves[0].id,slot:null})).success,true);
            p.run.phase = 'exploration';

            assert(!economy.shop(p).catalog.some(i => i.key === 'revive'));
            assert.equal((await use('potion')).success, true);
            socket.disconnect();const ready = once(socket, 'drift:bootstrap');socket.connect();await ready;
            const restored = await command(socket, 'drift:enter');
            assert.equal(restored.state.team[1].pendingMoves[0].move, 'Sleep Powder');assert.equal(restored.state.team[1].abilities[0], 'Leech Seed');
            assert.equal(restored.state.team[0].currentHp, 21);assert.equal(restored.state.items.find(i=>i.key==='potion').quantity, 1);
        } finally {
            sockets.forEach(s=>s.disconnect());cleanup();await new Promise(resolve=>io.close(resolve));
        }
    });
}

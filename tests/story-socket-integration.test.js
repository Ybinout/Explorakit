const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const shouldRun = process.env.RUN_MYSQL_TESTS === '1';
const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;

function event(socket, name, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(name, listener);
            reject(new Error(`Événement ${name} absent`));
        }, 12000);
        const listener = (payload) => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(name, listener);
            resolve(payload);
        };
        socket.on(name, listener);
    });
}

test('Socket réel : chapitres I et II, prérequis, combats, scènes et récompenses après reconnexion', { skip: !shouldRun, timeout: 60000 }, async () => {
    assert.match(testDatabaseName, /test/i);
    assert.equal(process.env.DB_NAME, testDatabaseName, 'Utiliser npm run test:mysql pour isoler les données');
    const { io } = require(path.resolve(__dirname, '../vue-explorakit/node_modules/socket.io-client'));
    const { dbPool } = require('../server/config/database');
    const { loadEquipe, editEquipe } = require('../server/persistence/teamRepository');
    const { loadProgressState } = require('../server/persistence/progressionRepository');
    const port = Number(process.env.STORY_TEST_PORT || 31238);
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['server/index.js'], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, PORT: String(port), DB_NAME: testDatabaseName, NODE_ENV: 'test', BATTLE_DELAY_SCALE: '0', JWT_SECRET: 'story-test-only' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let userId;
    let socket;
    let token;
    let serverErrors = '';
    child.stderr.on('data', chunk => { serverErrors = (serverErrors + String(chunk)).slice(-8000); });
    const main = (state) => state.quests.find((quest) => quest.key === 'main_sister_search');
    const at = async (map, x, y) => {
        if (socket) {
            // Une sauvegarde explicitement acquittée évite une écriture de position tardive.
            await new Promise((resolve, reject) => socket.timeout(5000).emit('requestGameSave', (error, result) => {
                if (error || !result?.success) reject(error || new Error(`Sauvegarde avant ${map} refusée : ${result?.message || result?.code || 'sans motif'}\n${serverErrors}`));
                else resolve();
            }));
            socket.disconnect();
        }
        await dbPool.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', [map, x * 32 + 16, y * 32 + 16, userId]);
        socket = io(url, { autoConnect: false, auth: { token }, transports: ['websocket'], reconnection: false });
        const ready = event(socket, 'progressionState');
        socket.connect();
        return ready;
    };
    const speak = async (expectedName) => {
        const response = event(socket, 'dialogue');
        socket.emit('Space');
        const dialogue = await response;
        assert.equal(dialogue[1], expectedName);
        return dialogue;
    };
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Serveur de test indisponible')), 10000);
            child.stdout.on('data', (chunk) => {
                if (String(chunk).includes('Server is running')) { clearTimeout(timer); resolve(); }
            });
            child.once('error', (error) => { clearTimeout(timer); reject(error); });
            child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Serveur arrêté : ${code}`)); });
        });
        const response = await fetch(`${url}/api/users`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: `story_socket_${Date.now()}`, password: 'story-test-password', starterId: 7, sprite: 'sprite.png' })
        });
        assert.equal(response.status, 201);
        const registration = await response.json();
        userId = registration.user.id;
        token = registration.token;
        // Mother: a real authorised conversation heals every slot, including a K.O.
        // A fabricated/replayed completion must never trigger healing from a distance.
        const { getMaxMovePp } = require('../server/game/battle/battleResources');
        const healingTeam = await loadEquipe(userId);
        healingTeam.ajouterPokemon(require('../server/game/drift/pokemonFactory').create(1, 5));
        healingTeam.pokemons.forEach((p, index) => {
            p.currentHp = index === 0 ? 1 : 0;
            p.status = index === 0 ? 'poison' : 'sleep';
            p.movePp = p.abilities.map(() => 0);
        });
        await editEquipe(userId, healingTeam);
        await dbPool.execute("UPDATE users SET respawn_map='centre',respawn_x=304,respawn_y=432,center_return_map='route4',center_return_x=720,center_return_y=144 WHERE id=?", [userId]);
        const checkpoint = async () => (await dbPool.execute('SELECT respawn_map,respawn_x,respawn_y,center_return_map,center_return_x,center_return_y FROM users WHERE id=?', [userId]))[0][0];
        const savedCheckpoint = await checkpoint();
        await at('start', 6, 9);
        let refused = event(socket, 'interactionRejected');
        socket.emit('onEndDialogue', 'dia0');
        assert.equal((await refused).reason, 'invalid_or_expired_dialogue');
        assert.deepEqual((await loadEquipe(userId)).pokemons.map(p => p.currentHp), [1, 0]);
        const expectHealthy = team => {
            assert.equal(team.pokemons.length, 2);
            for (const p of team.pokemons) {
                assert.equal(p.currentHp, p.maxHp);
                assert.equal(p.status, 'normal');
                assert.deepEqual(p.movePp, p.abilities.map(getMaxMovePp));
            }
        };
        for (let visit = 0; visit < 2; visit++) {
            await speak('dia0');
            const healed = event(socket, 'teamStateChanged', payload => payload.reason === 'heal');
            socket.emit('onEndDialogue', 'dia0');
            expectHealthy((await healed).equipe);
            expectHealthy(await loadEquipe(userId));
            assert.deepEqual(await checkpoint(), savedCheckpoint, 'Maman ne remplace pas le dernier Centre');
        }
        refused = event(socket, 'interactionRejected');
        socket.emit('onEndDialogue', 'dia0');
        assert.equal((await refused).reason, 'invalid_or_expired_dialogue');
        await at('start', 6, 9);
        expectHealthy(await loadEquipe(userId));
        // Finish the connection's saves before preparing the independent story fixture.
        await new Promise((resolve, reject) => socket.timeout(5000).emit('requestGameSave', (error, result) => {
            if (error || !result?.success) reject(error || new Error(`Sauvegarde après soin refusée : ${result?.message || result?.code || 'sans motif'}\n${serverErrors}`));
            else resolve();
        }));
        socket.disconnect();
        socket = null;
        // Fixture puissante : ce test vérifie les contrats réseau, pas la difficulté humaine.
        const team = await loadEquipe(userId);
        team.pokemons.splice(1);
        const pokemon = team.pokemons[0];
        pokemon.experience = pokemon.getNextLevelExpForLevel(200);
        pokemon.level = pokemon.calculateLevelFromExperience(pokemon.experience);
        pokemon.recalculateStats();
        pokemon.abilities = [];
        pokemon.movePp = [];
        pokemon.addAbility('Surf');
        pokemon.addAbility('Ice Beam');
        await editEquipe(userId, team);
        await at('gen_arene5', 13, 6);
        await speak('champion_hoze_locked');
        const rejection = event(socket, 'interactionRejected');
        socket.emit('onEndDialogue', 'champion_hoze');
        assert.equal((await rejection).reason, 'invalid_or_expired_dialogue');
        assert.equal((await loadProgressState(userId)).completedNpcBattles.length, 0);

        await at('ville1_arene', 13, 6);
        await speak('moon');
        socket.once('requestAction', () => socket.emit('actionResponse', { action: 'flee' }));
        const escaped = event(socket, 'teamStateChanged', (payload) => payload.reason === 'trainer_battle_end');
        socket.emit('onEndDialogue', 'moon');
        await escaped;
        assert.equal(main(await loadProgressState(userId)).progress, 0);
        let attacks = 0;
        let expectedExperience = pokemon.experience;
        const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
        const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
        const dialogues = require('../data/game/interact.json');
        const battles = [['moon', 'ville1_arene'], ['champion_hoze', 'gen_arene5'], ['champion_raphael', 'gen_arene4'], ['champion_ana', 'gen_arene3'], ['champion_wanda', 'gen_arene2']];
        for (const [index, [name, map]] of battles.entries()) {
            await at(map, 13, 6);
            await speak(name);
            const moneyBefore = (await loadProgressState(userId)).money;
            socket.on('requestAction', () => socket.emit('actionResponse', { action: 'attack', number: attacks++ % 2 }));
            const victoryScene = event(socket, 'dialogue', (payload) => payload[1] === `${name}_after`);
            const battleResult = event(socket, 'endbattle');
            socket.emit('onEndDialogue', name);
            const scene = await victoryScene;
            const summary = (await battleResult).summary;
            const trainerTeam = getPnjTeam(dialogues.find((entry) => entry.name === name).team);
            expectedExperience += trainerTeam.pokemons.reduce((sum, opponent) => sum + calculateBattleExperience(opponent, BATTLE_EXPERIENCE_MULTIPLIERS.arena, pokemon), 0);
            assert.equal((await loadEquipe(userId)).pokemons[0].experience, expectedExperience, `${name} : bonus XP arène transmis et sauvegardé`);
            assert.ok(scene[0].length >= 2);
            const progress = await loadProgressState(userId);
            assert.equal(summary.outcome, 'victory');
            assert.equal(summary.money, progress.money - moneyBefore, `${name} : le bilan reflète la récompense de chapitre attribuée`);
            assert.ok(summary.experience[0].xpGained > 0);
            assert.equal(main(progress).progress, index + 1);
            assert.equal(main(progress).status, 'active');
            socket.emit('onEndDialogue', `${name}_after`);
        }
        await at('gen_arene1', 13, 6);
        await speak('clara_letter');
        const ending = event(socket, 'progressionState', (state) => main(state).status === 'completed');
        socket.emit('onEndDialogue', 'clara_letter');
        assert.equal(main(await ending).progress, 6);
        const reconnect = await at('gen_arene1', 13, 6);
        assert.equal(main(reconnect).status, 'completed');
        await speak('clara_letter_after');
        // Un dresseur de ville fonctionne aussi, sans modifier le chapitre terminé.
        await at('ville1', 11, 11);
        await speak('town_lina');
        socket.on('requestAction', () => socket.emit('actionResponse', { action: 'attack', number: 0 }));
        const townWin = event(socket, 'dialogue', (payload) => payload[1] === 'town_lina_after');
        socket.emit('onEndDialogue', 'town_lina');
        await townWin;
        const state = await at('ville1', 11, 11);
        await speak('town_lina_after');
        assert.equal(main(state).status, 'completed');
        assert.equal(state.money, 12150);

        // The second chapter is played through real authorised conversations and a battle.
        const pnjs = JSON.parse(require('node:fs').readFileSync(path.resolve(__dirname, '../data/game/pnjs.jsonc'), 'utf8')).pnjs;
        const visit = async name => {
            const npc = pnjs.find(p => p.name === name);
            assert(npc, name);
            await at(npc.map, npc.x, npc.y + 1);
        };
        await visit('town_ch2_nora');
        await speak('ch2_nora_locked');
        for (const [npc, dialogue, flag] of [
            ['town_ch2_iris', 'ch2_iris', 'ch2_registry'],
            ['town_ch2_nora', 'ch2_nora', 'ch2_witness']
        ]) {
            await visit(npc);
            await speak(dialogue);
            const updated = event(socket, 'progressionState', progress => progress.flags[flag] === 'true');
            socket.emit('onEndDialogue', dialogue);
            await updated;
        }
        await visit('town_ch2_soren');
        await speak('ch2_soren');
        socket.on('requestAction', () => socket.emit('actionResponse', { action: 'attack', number: 0 }));
        const defeated = event(socket, 'dialogue', payload => payload[1] === 'ch2_soren_after');
        socket.emit('onEndDialogue', 'ch2_soren');
        await defeated;
        await visit('town_ch2_clara');
        await speak('ch2_clara');
        const reunion = event(socket, 'progressionState', progress => progress.flags.chapter2_complete === 'true');
        socket.emit('onEndDialogue', 'ch2_clara');
        assert.equal((await reunion).quests.find(q => q.key === 'clara_chapter2').status, 'completed');
        await visit('town_ch2_clara');
        await speak('ch2_clara_after');
        assert.equal((await loadProgressState(userId)).money, 15150);

    } finally {
        socket?.disconnect();
        if (child.exitCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
        if (userId) await dbPool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await dbPool.end();
    }
});

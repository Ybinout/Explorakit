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

test('Socket réel : Lucie, Wayne → Aspha → Mounir → Hoze → Gwenn → Raphael → Mathilde → Ana → Wanda → 7p → Lucie, refus/fuite/reprise et retrouvailles', { skip: !shouldRun, timeout: 60000 }, async () => {
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
    const at = async (map, x, y, heal = false) => {
        if (socket) {
            // Une sauvegarde explicitement acquittée évite une écriture de position tardive.
            await new Promise((resolve, reject) => socket.timeout(5000).emit('requestGameSave', (error, result) => {
                if (error || !result?.success) reject(error || new Error(`Sauvegarde avant ${map} refusée : ${result?.message || result?.code || 'sans motif'}\n${serverErrors}`));
                else resolve();
            }));
            socket.disconnect();
        }
        if(heal){const fresh=await loadEquipe(userId);require('../server/game/world/playerRecovery').healTeam(fresh);await editEquipe(userId,fresh);}
        await dbPool.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', [map, x * 32 + 16, y * 32 + 16, userId]);
        socket = io(url, { autoConnect: false, auth: { token }, transports: ['websocket'], reconnection: false });
        const ready = event(socket, 'progressionState');
        socket.connect();
        return ready;
    };
    const speak = async (expectedName) => {
        const response = event(socket, 'dialogue');
        socket.emit('Space');
        const dialogue = await response.catch(error => { throw new Error(`${expectedName}: ${error.message} ${serverErrors}`); });
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
        // Stable network/story fixture, independent of starter IV/K rolls and boss AI RNG.
        pokemon.k = 4;
        pokemon.iv = Object.fromEntries(['hp','attack','defense','specialAttack','specialDefense','speed'].map(stat => [stat,31]));
        pokemon.ev = {hp:252,attack:0,defense:0,specialAttack:252,specialDefense:0,speed:4};
        pokemon.nature = 'Modest';
        pokemon.passiveAbility = 'Torrent';
        pokemon.experience = pokemon.getNextLevelExpForLevel(200);
        pokemon.level = pokemon.calculateLevelFromExperience(pokemon.experience);
        pokemon.recalculateStats();
        pokemon.abilities = [];
        pokemon.movePp = [];
        pokemon.addAbility('Surf');
        pokemon.addAbility('Ice Beam');
        await editEquipe(userId, team);
        await at('ville_safe1_arene',13,5);
        await speak('champion_hoze_locked');
        const rejection=event(socket,'interactionRejected');socket.emit('onEndDialogue','champion_hoze');
        assert.equal((await rejection).reason,'invalid_or_expired_dialogue');
        await at('route2',25,6);await speak('aspha_route2_locked');
        await at('gen_route8',22,17);await speak('gwenn_route8_locked');
        const gwennRejected=event(socket,'interactionRejected');socket.emit('onEndDialogue','gwenn_route8');
        assert.equal((await gwennRejected).reason,'invalid_or_expired_dialogue');
        await at('ville_safe1',25,8);await speak('mathilde_pikapika_locked');
        const mathildeRejected=event(socket,'interactionRejected');socket.emit('onEndDialogue','mathilde_pikapika');assert.equal((await mathildeRejected).reason,'invalid_or_expired_dialogue');
        assert.equal((await loadProgressState(userId)).completedNpcBattles.length,0);
        for(const [map,name]of [['ville3_arene','champion_ana'],['ville4_arene','champion_wanda'],['ville5_arene','champion_7p']]){await at(map,13,5);await speak(name+'_locked');const blocked=event(socket,'interactionRejected');socket.emit('onEndDialogue',name);assert.equal((await blocked).reason,'invalid_or_expired_dialogue');}
        let attacks=0,expectedExperience=pokemon.experience;
        const {calculateBattleExperience,reduceActiveOverlevelExperience,BATTLE_EXPERIENCE_MULTIPLIERS}=require('../server/game/models/progression');
        const {getPnjTeam}=require('../server/game/world/pnjTeamFactory');
        const catalog=require('../data/game/progression.json'),dialogues=require('../data/game/interact.json');
        const battles=[['dia1','start',18,3],['aspha_route2','route2',25,6],['moon','ville1_arene',13,5],['champion_hoze','ville_safe1_arene',13,5],['gwenn_route8','gen_route8',22,17],['champion_raphael','gen_arene5',13,5],['mathilde_pikapika','ville_safe1',25,8],['champion_ana','ville3_arene',13,5],['champion_wanda','ville4_arene',13,5],['champion_7p','ville5_arene',13,5]];
        for(const [name,map,x,y] of battles) {
            await at(map,x,y,true);await speak(name);
            if(['aspha_route2','gwenn_route8','mathilde_pikapika'].includes(name)) {
                const progressBeforeFlee=main(await loadProgressState(userId)).progress;
                socket.once('requestAction',()=>socket.emit('actionResponse',{action:'flee'}));
                const escaped=event(socket,'teamStateChanged',p=>p.reason==='trainer_battle_end');socket.emit('onEndDialogue',name);await escaped;
                assert.equal(main(await loadProgressState(userId)).progress,progressBeforeFlee);
                await at(map,x,y);await speak(name);
            }
            const before=await loadProgressState(userId),trace=[];socket.on('battleText',p=>{trace.push(p.message);if(trace.length>12)trace.shift();});socket.on('endbattle',p=>trace.push(JSON.stringify(p.summary)));
            socket.on('requestAction',()=>socket.emit('actionResponse',{action:'attack',number:attacks++%2}));
            const victoryScene=event(socket,'dialogue',p=>p[1]===`${name}_after`),battleResult=event(socket,'endbattle');
            const gateId=name==='dia1'?'wayne_route1':name==='aspha_route2'?'aspha_lake':name==='gwenn_route8'?'gwenn_ocreville':name==='mathilde_pikapika'?'mathilde_route5':null;
            const openedGate=gateId?event(socket,'storyGatesState',p=>p.gates.some(g=>g.id===gateId&&!g.locked)):null;
            socket.emit('onEndDialogue',name);const scene=await victoryScene.catch(e=>{throw Error(name+': '+e.message+' '+JSON.stringify(trace)+' '+serverErrors);}),summary=(await battleResult).summary;
            if(openedGate)await openedGate;
            const trainerTeam=getPnjTeam(dialogues.find(e=>e.name===name).team),kind=catalog.npcBattles[name].experienceKind;
            expectedExperience+=trainerTeam.pokemons.reduce((sum,opponent)=>sum+reduceActiveOverlevelExperience(calculateBattleExperience(opponent,BATTLE_EXPERIENCE_MULTIPLIERS[kind],pokemon),opponent,pokemon),0);
            assert.equal((await loadEquipe(userId)).pokemons[0].experience,expectedExperience,`${name}: XP sauvegardée`);
            assert(scene[0].length>=2);const progress=await loadProgressState(userId);
            if(name==='moon')assert(progress.badges.some(b=>b.key==='lake_badge'&&b.earned));
            assert.equal(summary.outcome,'victory');assert.equal(summary.money,progress.money-before.money);assert(summary.experience[0].xpGained>0);
            const storyStep=catalog.storySteps.findIndex(step=>catalog.npcBattles[name].reward.flags[step.flag]==='true');
            assert.equal(main(progress).progress,storyStep<0?main(before).progress:storyStep+1);assert.equal(main(progress).status,'active');
            assert(scene[0].some(line=>line.text.includes(name==='dia1'?'Aspha':name==='aspha_route2'?'Mounir':name==='moon'?'Hoze':name==='champion_hoze'?'Raphael':name==='gwenn_route8'?'Ocreville':name==='mathilde_pikapika'?'Route 5':name==='champion_raphael'?'Ana':name==='champion_ana'?'Wanda':'Lucie')));
            socket.emit('onEndDialogue',`${name}_after`);
        }
        const beforeReunion=await at('route2_maison',13,9);assert.equal(main(beforeReunion).progress,8);await speak('lucie_route2');const reunited=event(socket,'progressionState',p=>main(p).status==='completed');socket.emit('onEndDialogue','lucie_route2');await reunited;
        const final=await at('ville5_arene',13,5);await speak('champion_7p_after');
        assert.equal(main(final).progress,9);assert.equal(main(final).status,'completed');
        assert(final.badges.some(b=>b.key==='lake_badge'&&b.earned));
        assert(final.badges.some(b=>b.key==='dune_badge'&&b.earned));
        assert.equal(final.quests.some(q=>q.key==='clara_chapter2'),false);
        const money=final.money;
        await at('ville_safe1',25,8);await speak('mathilde_pikapika_after');
        const replayMathilde=event(socket,'interactionRejected');socket.emit('onEndDialogue','mathilde_pikapika');assert.equal((await replayMathilde).reason,'invalid_or_expired_dialogue');
        assert.equal((await loadProgressState(userId)).money,money);
        assert.equal((await require('../server/persistence/progressionRepository').completeNpcBattle(userId,'mathilde_pikapika')).reason,'already_completed');
        await at('gen_route8',22,17);await speak('gwenn_route8_after');
        const replay=event(socket,'interactionRejected');socket.emit('onEndDialogue','gwenn_route8');assert.equal((await replay).reason,'invalid_or_expired_dialogue');
        assert.equal((await loadProgressState(userId)).money,money);
        assert.equal((await require('../server/persistence/progressionRepository').completeNpcBattle(userId,'gwenn_route8')).reason,'already_completed');
        await at('ville3_arene',13,5);await speak('champion_ana_after');assert.equal((await loadProgressState(userId)).money,money);
        const archivist=require('../server/game/world/pnjStore').getPnjsForMap('gen_arene1').find(p=>p.interactionName==='clara_letter');await at('gen_arene1',archivist.x,archivist.y+1);await speak('clara_letter_locked');
        const blocked=event(socket,'interactionRejected');socket.emit('onEndDialogue','clara_letter');
        assert.equal((await blocked).reason,'invalid_or_expired_dialogue');assert.equal((await loadProgressState(userId)).money,money);
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

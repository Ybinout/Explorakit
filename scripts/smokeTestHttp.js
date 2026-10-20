const { spawn } = require('child_process');
const path = require('path');
const { getDatabaseConfig, mysql } = require('./databaseConnection');
const { io } = require(path.resolve(__dirname, '..', 'vue-explorakit', 'node_modules', 'socket.io-client'));

const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;
if (!/test/i.test(testDatabaseName)) {
    console.error('Le test HTTP refuse une base dont le nom ne contient pas « test ».');
    process.exit(1);
}

const port = Number(process.env.HTTP_TEST_PORT || 31234);
const baseUrl = `http://127.0.0.1:${port}/api`;

function waitForServer(child) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Démarrage serveur trop long.')), 10000);
        child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('Server is running')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr.on('data', (chunk) => {
            const output = String(chunk).trim();
            if (output) console.error(output);
        });
        child.once('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Le serveur de test s'est arrêté (${code}).`));
        });
    });
}

async function request(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${response.status} ${pathname}: ${payload.message || 'erreur'}`);
    return { response, payload };
}

function connectAuthenticatedSocket(token, expectedUserId, { expectBlackout = false } = {}) {
    return new Promise((resolve, reject) => {
        const socket = io(`http://127.0.0.1:${port}`, {
            autoConnect: false,
            auth: { token },
            transports: ['websocket']
        });
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Connexion Socket.IO trop longue.'));
        }, 10000);
        let authenticatedPlayer = null;
        let blackoutPayload = null;
        let relocatedMap = null;
        let progressionState = null;
        let pokedexState = null;
        let saveResult = null;
        let saveRequested = false;
        const finishIfComplete = () => {
            if (!authenticatedPlayer) return;
            if (expectBlackout && (!blackoutPayload || !relocatedMap)) return;
            if (!progressionState || !pokedexState) return;
            if (!saveRequested) {
                saveRequested = true;
                setTimeout(() => {
                    socket.emit('requestGameSave', (payload = {}) => {
                        if (!payload.success) {
                            clearTimeout(timeout);
                            socket.disconnect();
                            reject(new Error(payload.message || 'Sauvegarde Socket.IO impossible.'));
                            return;
                        }
                        saveResult = payload;
                        finishIfComplete();
                    });
                }, 25);
                return;
            }
            if (!saveResult) return;
            clearTimeout(timeout);
            socket.disconnect();
            resolve({
                authenticated: true,
                blackout: blackoutPayload,
                relocatedMap,
                progressionState,
                pokedexState,
                saveResult
            });
        };
        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(error);
        });
        socket.on('playersList', (players) => {
            const currentPlayer = players?.[socket.id];
            if (currentPlayer?.userId !== expectedUserId) {
                clearTimeout(timeout);
                socket.disconnect();
                reject(new Error("L'identité Socket.IO ne correspond pas au jeton."));
                return;
            }
            authenticatedPlayer = currentPlayer;
            finishIfComplete();
        });
        socket.on('newmap', (payload = {}) => {
            if (payload.reason === 'blackout') relocatedMap = payload.mapname;
            finishIfComplete();
        });
        socket.on('blackout', (payload = {}) => {
            blackoutPayload = payload;
            finishIfComplete();
        });
        socket.on('progressionState', (payload = {}) => {
            progressionState = payload;
            finishIfComplete();
        });
        socket.on('pokedexState', (payload = {}) => {
            pokedexState = payload;
            finishIfComplete();
        });
        socket.connect();
    });
}

async function run() {
    const child = spawn(process.execPath, ['server/index.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PORT: String(port),
            DB_NAME: testDatabaseName,
            NODE_ENV: 'test',
            JWT_SECRET: 'integration-http-secret-not-for-production'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const username = `http_${Date.now()}`;
    let userId = null;
    try {
        await waitForServer(child);
        const registration = await request('/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username,
                password: 'mot-de-passe-http',
                sprite: 'sprite2.png',
                starterId: 7
            })
        });
        userId = registration.payload.user.id;
        const token = registration.payload.token;
        if (!token) throw new Error("L'inscription n'a pas renvoyé de jeton.");

        const authorization = { authorization: `Bearer ${token}` };
        const team = await request(`/users/${userId}/team`, { headers: authorization });
        const items = await request(`/users/${userId}/items`, { headers: authorization });
        const progress = await request(`/users/${userId}/progress`, { headers: authorization });
        const pokedex = await request(`/users/${userId}/pokedex`, { headers: authorization });
        const login = await request('/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: 'mot-de-passe-http' })
        });

        if (team.payload.pokemons?.[0]?.pokemon_id !== 7) throw new Error('Le starter HTTP attendu est absent.');
        if (items.payload.items?.length !== 4) throw new Error("L'inventaire HTTP est incomplet.");
        if (!['main_sister_search','first_challenge'].every(key => progress.payload.quests?.some(quest => quest.key === key))) throw new Error('Les quêtes initiales sont absentes.');
        if (progress.payload.quests.some(quest => ['clara_chapter2','refuges','valpierre_passage'].includes(quest.key))) throw new Error('Une quête de la suite archivée est visible.');
        if (pokedex.payload.caught !== 1 || !pokedex.payload.entries?.find((entry) => entry.id === 7)?.caught) {
            throw new Error("Le starter n'est pas enregistré dans le Pokédex.");
        }
        if (login.payload.user?.id !== userId || !login.payload.token) throw new Error('La reconnexion HTTP a échoué.');
        const equipped = await request(
            `/teams/${team.payload.id}/pokemons/${team.payload.pokemons[0].uuid}/held-item`,
            {
                method: 'PUT',
                headers: { ...authorization, 'content-type': 'application/json' },
                body: JSON.stringify({ itemKey: 'oran_berry' })
            }
        );
        if (equipped.payload.heldItem !== 'oran_berry') throw new Error("L'objet tenu n'a pas ete equipe.");

        const knockoutConnection = await mysql.createConnection(getDatabaseConfig(testDatabaseName));
        try {
            await knockoutConnection.execute(
                `UPDATE pokemons p
                 INNER JOIN teams t ON t.id = p.team_id
                 SET p.current_hp = 0
                 WHERE t.user_id = ?`,
                [userId]
            );
        } finally {
            await knockoutConnection.end();
        }

        const socketResult = await connectAuthenticatedSocket(token, userId, { expectBlackout: true });
        await new Promise((resolve) => setTimeout(resolve, 150));

        const verificationConnection = await mysql.createConnection(getDatabaseConfig(testDatabaseName));
        let healedPokemonCount;
        let savedMap;
        try {
            const [[position]] = await verificationConnection.execute('SELECT map FROM users WHERE id = ?', [userId]);
            const [[healing]] = await verificationConnection.execute(
                `SELECT COUNT(*) AS healed_count
                 FROM pokemons p
                 INNER JOIN teams t ON t.id = p.team_id
                 WHERE t.user_id = ? AND p.current_hp > 0`,
                [userId]
            );
            savedMap = position?.map;
            healedPokemonCount = Number(healing?.healed_count || 0);
        } finally {
            await verificationConnection.end();
        }

        if (socketResult.relocatedMap !== 'maison' || savedMap !== 'maison' || healedPokemonCount < 1) {
            throw new Error('La recuperation apres defaite totale a echoue.');
        }
        if (!socketResult.saveResult?.success || !socketResult.progressionState?.quests?.some(quest => quest.key === 'main_sister_search')) {
            throw new Error('La synchronisation explicite ou la reprise de progression a échoué.');
        }

        console.log(JSON.stringify({
            success: true,
            userId,
            starterId: 7,
            itemTypes: 4,
            heldItemEquipped: 'oran_berry',
            socketAuthenticated: socketResult.authenticated,
            progressionReloaded: true,
            manualSave: true,
            blackoutRecovery: {
                healed: true,
                relocatedMap: socketResult.relocatedMap,
                persistedMap: savedMap
            }
        }, null, 2));
    } finally {
        if (userId) {
            const connection = await mysql.createConnection(getDatabaseConfig(testDatabaseName));
            try {
                await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
            } finally {
                await connection.end();
            }
        }
        child.kill('SIGTERM');
    }
}

run().catch((error) => {
    console.error(`Test HTTP échoué : ${error.message}`);
    process.exitCode = 1;
});

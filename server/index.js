const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const userRoutes = require('./http/routes');
const socketHandler = require('./realtime/socketHandler');
const { registerDriftLobbies } = require('./realtime/driftLobbyHandler');
const checkpointRepository = require('./persistence/riftCheckpointRepository');
const riftAccountRepository = require('./persistence/riftAccountRepository');
const { authenticateSocket } = require('./http/authMiddleware');
const { DIST_DIR } = require('./config/paths');

const app = express();
app.set('trust proxy','loopback');
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 256 * 1024 });
const limitSocket = require('./realtime/socketRateLimit').createSocketRateLimit();
io.on('connection', limitSocket);
io.use(authenticateSocket);
app.use(express.json({ limit: '256kb' }));

// Servez les fichiers statiques de votre application Vue
app.use(express.static(DIST_DIR, { setHeaders: require('./http/staticAssets').staticAssetHeaders }));

app.use('/api', userRoutes);

app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

socketHandler(io);
let drift;
async function start() {
    const durable=process.env.NODE_ENV!=='test' || process.env.RIFT_DURABILITY==='1';
    const initialCheckpoint=durable?await checkpointRepository.load():null;
    drift=registerDriftLobbies(io, { accountRepository: riftAccountRepository, colosseumRepository: require('./persistence/colosseumRepository'), checkpointRepository:durable?checkpointRepository:null, initialCheckpoint });
    await drift.runtime.reconcileSettlements();
    server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Server is running on port ${PORT}`));
}
let stopping=false;
async function stop() {
    if(stopping)return; stopping=true;
    drift?.();
    try { await drift?.checkpoint(); } catch(error) { console.error('Sauvegarde finale:',error.message); process.exitCode=1; }
    io.close(); server.close();
    await require('./config/database').dbPool.end();
    process.exit(process.exitCode || 0);
}
process.on('SIGTERM',stop); process.on('SIGINT',stop);

const PORT = Number(process.env.PORT || 3000);
start().catch(error=>{console.error('Démarrage refusé:',error.message);process.exit(1);});

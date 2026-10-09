const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const userRoutes = require('./http/routes');
const socketHandler = require('./realtime/socketHandler');
const { authenticateSocket } = require('./http/authMiddleware');
const { DIST_DIR } = require('./config/paths');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
io.use(authenticateSocket);
app.use(express.json({ limit: '256kb' }));

// Servez les fichiers statiques de votre application Vue
app.use(express.static(DIST_DIR));

app.use('/api', userRoutes);

app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

socketHandler(io);

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

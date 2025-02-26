const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
// const userRoutes = require('./routes/userRoutes');
const userRoutes = require('./routes/allRoute');
const path = require('path');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(bodyParser.json());
const socketHandler = require('./socketHandler');
// const v8 = require('v8');

// const memoryStats = v8.getHeapStatistics();
// console.log(memoryStats);

// Servez les fichiers statiques de votre application Vue
app.use(express.static(path.join(__dirname, './dist')));

app.use('/api', userRoutes);

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, './dist', 'index.html'));
});

socketHandler(io);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
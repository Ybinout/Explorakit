const express = require('express');
const bodyParser = require('body-parser');
const userRoutes = require('./routes/userRoutes');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(bodyParser.json());

// Servez les fichiers statiques de votre application Vue
app.use(express.static(path.join(__dirname, './dist')));

app.use('/api/users', userRoutes);

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, './dist', 'index.html'));
});

let players = {};

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log(`L'utilisateur ${userId} s'est connecté avec le socket ID ${socket.id}`);
    players[socket.id] = {
        x: 50,  // Position initiale, par exemple
        y: 50,
        isInteracting: false,
        interactionAsset: null
        // ... autres propriétés nécessaires
    };

    socket.on('playerAction', (action) => {
        const player = players[socket.id];
        // console.log('test');
        switch (action) {
            case 'interact':
                // Traitez l'interaction ici (e.g. commencez un dialogue)
                break;
            case 'move_z':
                player.y -= 5;
                break;
            case 'move_s':
                player.y += 5;
                break;
            case 'move_q':
                player.x -= 5;
                break;
            case 'move_d':
                player.x += 5;
                break;
            // ... Traitez les autres mouvements ici ...
        }
        console.log(players[socket.id]);
        // Envoyez la mise à jour au client
        socket.emit('update', { player: players[socket.id] });
    });

    socket.on('disconnect', () => {
        console.log(`L'utilisateur ${userId} s'est déconnecté`);
    });

});






const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
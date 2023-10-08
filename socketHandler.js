
// socketHandler.js
const { loadCollisionData, changeMapData, getNextMap, battleMapData } = require('./mapdata.js');
const Equipe = require('./equipe.js');
const Pokemon = require('./pokemon.js');
const CreatePokemon = require('./createwild.js');
const startBattle = require('./wildBattle.js');
let players = {};

const socketHandler = (io) => {
    io.on('connection', (socket) => {
        const equipe = new Equipe();

        //ici faire les requette necessaire pour récupérer les données de l equipe
        const test = new Pokemon(1, "test", 0, 0, null, "Timid", null);
        equipe.ajouterPokemon(test);


        const userId = socket.handshake.query.userId;
        console.log(`L'utilisateur ${userId} s'est connecté avec le socket ID ${socket.id}`);
        let currentmap = 'pk1'
        let collisionData2D = loadCollisionData(currentmap);
        let changemap2D = changeMapData(currentmap);
        let battlemap2D = battleMapData(currentmap);
        // Ajoutez le nouveau joueur à la liste
        players[socket.id] = {
            id:socket.id,
            x: 144,
            y: 144,
            isInteracting: false,
            interactionAsset: null,
            currentmap: 'pk1',
            equipe: equipe,
        };

        const sameMapPlayers = {};
        for (const id in players) {
            if (players[id].currentmap === currentmap) {
                sameMapPlayers[id] = players[id];
            }
        }

        socket.emit('playersList', sameMapPlayers);

        for (const id in players) {
            if (players[id].currentmap === currentmap) {
                io.to(id).emit('newPlayer', { id: socket.id, player: players[socket.id] });
            }
        }
        const tileWidth = 32;
        const tileHeight = 32;
        const moveDelay = 180;
        let canMove = true;

        socket.on('playerAction', (action) => {

            if (!canMove) return;
            const player = players[socket.id];

            let newPlayerX = player.x;
            let newPlayerY = player.y;

            switch (action) {
                case 'move_z':
                    newPlayerY -= tileHeight;
                    break;
                case 'move_s':
                    newPlayerY += tileHeight;
                    break;
                case 'move_q':
                    newPlayerX -= tileWidth;
                    break;
                case 'move_d':
                    newPlayerX += tileWidth;
                    break;
            }

            // Convertir les coordonnées du joueur en indices de matrice
            const matrixX = Math.floor(newPlayerX / tileWidth);
            const matrixY = Math.floor(newPlayerY / tileHeight);

            // Vérifiez si le joueur peut se déplacer à ces coordonnées
            if (collisionData2D[matrixY] && collisionData2D[matrixY][matrixX] === 0) {
                player.x = newPlayerX;
                player.y = newPlayerY;
                for (const id in players) {
                    if (players[id].currentmap === currentmap) {
                        io.to(id).emit('playerMoved', { id: socket.id, player: player });
                    }
                }
                canMove = false;
                setTimeout(() => {
                    canMove = true;
                }, moveDelay);
            }
            if (battlemap2D[matrixY] && battlemap2D[matrixY][matrixX] != 0) {
                const randomNumber = Math.floor(Math.random() * 15);
                if (randomNumber === 0) {
                    console.log("Triggered!");

                    // Émettre un événement au joueur qui a déclenché la condition
                    socket.emit('battletrigger', { message: 'Vous avez déclenché la condition!' });
                    async function utiliserCreatePokemon() {
                        try {
                            const pokemonsauvage = await CreatePokemon(currentmap);
                            // console.log('laaaaaaaaaaaaaaaaaa', pokemonsauvage);
                            return pokemonsauvage;
                        } catch (erreur) {
                            console.error(erreur);
                        }
                    }

                    utiliserCreatePokemon()
                        .then((pokemonsauvage) => {
                            // Votre code ici après que utiliserCreatePokemon soit terminée
                            //appelle de la battle pokemon
                            startBattle(player , pokemonsauvage , io)
                            // console.log('Pokémon créé:', pokemonsauvage);
                        })
                        .catch((erreur) => {
                            console.error(erreur);
                        });


                }
            }
            if (changemap2D[matrixY] && changemap2D[matrixY][matrixX] != 0) {
                let nextMapData = getNextMap(currentmap, matrixX, matrixY);
                if (nextMapData) {
                    const oldMap = currentmap;
                    currentmap = nextMapData.nextMap;
                    player.x = nextMapData.nextX;
                    player.y = nextMapData.nextY;
                    player.currentmap = currentmap;

                    // Informez les autres joueurs du changement de carte
                    for (const id in players) {
                        if (players[id].currentmap === oldMap) {
                            io.to(id).emit('playerLeft', { id: socket.id });
                        }
                        if (players[id].currentmap === currentmap) {
                            io.to(id).emit('playerJoined', { id: socket.id, player: player });
                        }
                    }

                    collisionData2D = loadCollisionData(currentmap);
                    changemap2D = changeMapData(currentmap);
                    battlemap2D = battleMapData(currentmap);
                    for (const id in players) {
                        if (players[id].currentmap === player.currentmap) {
                            io.to(id).emit('playerMoved', { id: socket.id, player: player });
                        }
                    }

                    const sameMapPlayers = getPlayersInMap(currentmap);
                    // console.log(sameMapPlayers);
                    socket.emit('playersList', sameMapPlayers);


                    // console.log('ça va emit');
                    // Emit the updated players list to the current player
                    // socket.emit('playersList', sameMapPlayers);
                    for (const id in players) {
                        if (players[id].currentmap === currentmap && id !== socket.id) {
                            io.to(id).emit('newPlayer', { id: socket.id, player: players[socket.id] });
                        }
                    }
                    socket.emit('newmap', { mapname: currentmap, playersList: sameMapPlayers });
                }
                function getPlayersInMap(mapname) {
                    const mapPlayers = {};
                    for (const id in players) {
                        if (players[id].currentmap === mapname) {
                            mapPlayers[id] = players[id];
                        }
                    }
                    return mapPlayers;
                }
            }
        });

        socket.on('disconnect', () => {
            // Retirez le joueur de la liste
            delete players[socket.id];

            // Informez tous les clients que ce joueur s'est déconnecté
            io.emit('playerDisconnected', { id: socket.id });
        });
    });

};

module.exports = socketHandler;

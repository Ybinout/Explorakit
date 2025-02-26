
// socketHandler.js
const { loadCollisionData, changeMapData, getNextMap, battleMapData, InteractMapData } = require('./mapdata.js');
const { editEquipe, loadEquipe } = require('./actionequipe.js');
const Equipe = require('./equipe.js');
const Pokemon = require('./pokemon.js');
const CreatePokemon = require('./createwild.js');
const startBattle = require('./wildBattle.js');
const {  getSentenceForMapAndPosition } = require('./interact.js');
const axios = require('axios');
let players = {};

const socketHandler = (io) => {
    io.on('connection', async (socket) => {
        const userId = socket.handshake.query.userId;

        console.log('le user ==', userId);

        // const equipe = new Equipe();

        // //ici faire les requette necessaire pour récupérer les données de l equipe
        // const test = new Pokemon(269, "test", 0, 0, {
        //     attack: 31,
        //     defense: 31,
        //     hp: 31,
        //     specialDefense: 31,
        //     speed: 31,
        //     specialAttack: 31
        // }, "Timid", 1);

        // test.addAbility("Frenzy Plant");
        // test.addAbility("Pound");
        // test.addAbility("Pound");
        // test.addAbility("Pound");
        // test.gainExperience(2000000);
        // equipe.ajouterPokemon(test);
        // equipe.ajouterPokemon(test);

        // const dataToSend = {
        //     data: equipe
        // };


        // editEquipe(userId ,equipe)
        // const toto =  loadEquipe(userId)
        const equipe = await loadEquipe(userId);
        console.log(equipe);

        // axios.put(`http://localhost:3000/api/users/user/${userId}/equipe`, dataToSend)
        // .then(response => {
        //     // console.log('Equipe ajoutée avec succès. ID:', response.data.equipeId);
        // })
        // .catch(error => {
        //     console.error('Erreur lors de lajout de léquipe:', error);
        // });




        let currentmap = 'start'
        let collisionData2D = loadCollisionData(currentmap);
        let changemap2D = changeMapData(currentmap);
        let battlemap2D = battleMapData(currentmap);

        // Ajoutez le nouveau joueur à la liste 896 * 640
        players[socket.id] = {
            id: socket.id,
            x: 80,
            y: 208,
            isInteracting: false,
            interactionAsset: null,
            currentmap: 'start',
            equipe: equipe,
            inbattle: false
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

        let interactmap = InteractMapData(currentmap);

        socket.on('Space', (action) => {
            console.log('Space');

            const player = players[socket.id];

            let newPlayerX = player.x;
            let newPlayerY = player.y;

            // Convertir les coordonnées du joueur en indices de matrice
            const matrixX = Math.floor(newPlayerX / tileWidth);
            const matrixY = Math.floor(newPlayerY / tileHeight);

            const adjacentPositions = [
                { x: matrixX, y: matrixY - 1 },  // Au-dessus
                { x: matrixX, y: matrixY + 1 },  // En-dessous
                { x: matrixX - 1, y: matrixY },  // À gauche
                { x: matrixX + 1, y: matrixY }   // À droite
            ];

            let interactionDetected = false;

            adjacentPositions.forEach(pos => {
                if (pos.x >= 0 && pos.x < interactmap[0].length && pos.y >= 0 && pos.y < interactmap.length) {
                    if (interactmap[pos.y][pos.x] !== 0) {
                        interactionDetected = true;
                        console.log(`Interaction detected at position (${pos.x}, ${pos.y}) , ${currentmap}`);
                        
                        // Appel de la fonction pour obtenir la sentence
                        const sentence = getSentenceForMapAndPosition(currentmap, pos.x);


                        if (sentence) {
                            console.log(`Dialogue: ${sentence}`);
                            // Ici, tu peux gérer l'affichage de la sentence
                            io.to(socket.id).emit('dialogue', sentence);
                        } else {
                            console.log('No dialogue found for this position.');
                        }
                    }
                }
            });

            if (!interactionDetected) {
                console.log('No interaction detected near the player.');
            }

        });

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

                    // Émettre un événement au joueur qui a déclenché la condition
                    socket.emit('battletrigger', { message: 'Vous avez déclenché la condition!' });
                    async function utiliserCreatePokemon() {
                        try {
                            const pokemonsauvage = await CreatePokemon(currentmap);
                            pokemonsauvage.addAbility("Pound");
                            pokemonsauvage.addAbility("Pound");
                            pokemonsauvage.addAbility("Pound");
                            pokemonsauvage.addAbility("Pound");
                            pokemonsauvage.gainExperience(5000);
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
                            startBattle(player, pokemonsauvage, io, userId, equipe)

                            // editEquipe(userId, equipe)

                            // console.log('Pokémon créé:', pokemonsauvage);
                        })
                        .catch((erreur) => {
                            console.error(erreur);
                        });


                }
            }
            if (changemap2D[matrixY] && changemap2D[matrixY][matrixX] != 0) {
                console.log('toto ?');

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

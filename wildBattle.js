
// player composé de son equipe
const {useattack} = require('./calculateInteraction.js');
const { editEquipe } = require('./actionequipe.js');

async function startBattle(player, wildPokemon, io, id, equipe) {

    displayIntroAnimation(player, wildPokemon, io); //envoi par socket un trigger qui affiche le pokemon WEBSOCKET //////////////////////////////////////////////

    let tours = 0
    let actionPlayer = null
    let actionWildpokemon = null

    //tant que  le wildpokemon a des hp
    while (wildPokemon.currentHp > 0) {

        if (player.equipe.pokemons[0].currentHp < 0) {
            player = playerChangePokemon(player);
        }

        try {
            let response = await playerTurn(player, io);

            // Traitez la réponse ici
            let actionPlayer = response.action;

            if (actionPlayer == 'flee') {
                io.to(player.id).emit('endbattle');
                break; // Sortez de la boucle
            } else if (actionPlayer == 'attack') {
                console.log('errer');
                
                if (player.equipe.pokemons[0].speed > wildPokemon.speed) {
                    performAttack(player.equipe.pokemons[0], wildPokemon, response.number);
                    displayIntroAnimation(player, wildPokemon, io);

                    if (wildPokemon.currentHp <= 0 || player.equipe.pokemons[0].currentHp <= 0) {
                        endBattle(player, io);
                        await editEquipe(id, equipe);
                        return true; // Sortez de la boucle
                    }

                    performAttack(wildPokemon, player.equipe.pokemons[0], getRandomNumber());
                    displayIntroAnimation(player, wildPokemon, io);

                    if (wildPokemon.currentHp <= 0 || player.equipe.pokemons[0].currentHp <= 0) {
                        endBattle(player, io);
                        await editEquipe(id, equipe);
                        return true; // Sortez de la boucle
                    }

                } else {
                    performAttack(wildPokemon, player.equipe.pokemons[0], getRandomNumber());
                    displayIntroAnimation(player, wildPokemon, io);

                    if (wildPokemon.currentHp <= 0 || player.equipe.pokemons[0].currentHp <= 0) {
                        endBattle(player, io);
                        await editEquipe(id, equipe);
                        return true; // Sortez de la boucle
                    }

                    performAttack(player.equipe.pokemons[0], wildPokemon, response.number);
                    displayIntroAnimation(player, wildPokemon, io);

                    if (wildPokemon.currentHp <= 0 || player.equipe.pokemons[0].currentHp <= 0) {
                        endBattle(player, io);
                        await editEquipe(id, equipe);
                        return true; // Sortez de la boucle
                    }
                }
            }
        } catch (error) {
            // Traitez l'erreur ici
        }

        tours++;
    }


    // endBattle(player.pokemon, wildPokemon); //donner les golds / et XP
}
function getRandomNumber() {
    return Math.floor(Math.random() * 4);
}

function playerTurn(player, io) {
    return new Promise((resolve, reject) => {
        // Récupérez la socket pour ce joueur en particulier
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket) {
            return reject(new Error("Socket non trouvée pour le joueur: " + player.id));
        }

        // Émettez l'événement pour demander une action au joueur
        playerSocket.emit('requestAction', { message: 'Quelle est votre prochaine action ?' });

        // Écoutez la réponse du joueur
        const responseListener = (response) => {
            // Retirez le listener pour ne pas accumuler de listeners inutiles
            playerSocket.off('actionResponse', responseListener);
            // Gérez la réponse
            switch (response.action) {
                case "attack":
                    resolve(response);
                    break;
                case "flee":
                    resolve(response);
                    break;
                default:
                    reject(new Error("Action inconnue reçue du client: " + response.action));
            }
        };

        playerSocket.on('actionResponse', responseListener);

        // Gérez le délai d'attente avec setTimeout
        setTimeout(() => {
            // Retirez le listener pour éviter de recevoir une réponse après le délai d'attente
            playerSocket.off('actionResponse', responseListener);
            reject(new Error("Erreur : Délai d'attente dépassé en attendant la réponse du joueur"));
        }, 30000); // Ici, nous attendons 30 secondes avant d'expirer
    });
}






function endBattle(player, io) {
    //gain d experinece 
    // envoi un signale qui vide la battle scene et la cache
    io.to(player.id).emit('endbattle', { message: 'Fin du combat' });
}

function wildPokemonTurn(player, wildPokemon) {
    return getRandomMove(wildPokemon);


}

function displayIntroAnimation(player, wildPokemon, io) {
    io.to(player.id).emit('introAnimation', { player: player, wildPokemon: wildPokemon });
}


function playerChangePokemon(player) {
    //envoi par socket un trigger qui demande le changement de pokemon ou fuite  WEBSOCKET ///////////////////////////////////////////////////////////////////////////////


}


function actionTerrain(terrain, pokemonWild, player) {
}

function performAttack(pokemon1, pokemon2, atk) {

    useattack(pokemon1.getAtkName(atk), pokemon1, pokemon2)
}

module.exports = startBattle;

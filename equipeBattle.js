const useattack = require('./calculateInteraction.js');
const { editEquipe } = require('./actionequipe.js');

async function startTeamBattle(player, enemyTeam, io, id) {
    // enemyTeam : { pokemons: [Pokemon1, Pokemon2, ...] }
    // equipe    : { pokemons: [Pokemon1, Pokemon2, ...] } (équipe du joueur)
    // player    : contient notamment player.id pour la socket

    console.log('Démarrage du combat d\'équipe.');

    let currentEnemyIndex = 0;
    let currentEnemy = enemyTeam.pokemons[currentEnemyIndex];

    displayIntroAnimation(player, currentEnemy, io);

    let tours = 0;

    // Tant qu'il reste au moins un Pokémon vivant dans l'équipe ennemie ET dans l'équipe du joueur
    while (
        currentEnemyIndex < enemyTeam.pokemons.length &&
        hasAlivePokemon(enemyTeam.pokemons) &&
        hasAlivePokemon(player.equipe.pokemons)
    ) {
        // Vérifie si le Pokémon actif (index 0) côté joueur est KO
        if (player.equipe.pokemons[0].currentHp <= 0) {
            // On force un changement de Pokémon côté joueur
            playerChangePokemon(player.equipe, io, player.id);

            // Si après tentative de switch, on n'a plus de pokémon vivant, fin du combat
            if (!hasAlivePokemon(player.equipe.pokemons)) {
                endBattle(player, io, false);
                await editEquipe(id, player.equipe);
                return false;
            }
        }

        // Vérifie si le Pokémon actif côté ennemi est KO
        if (currentEnemy.currentHp <= 0) {
            currentEnemyIndex++;
            if (currentEnemyIndex >= enemyTeam.pokemons.length) {
                // L'équipe ennemie n'a plus de Pokémon valide
                endBattle(player, io, true);
                await editEquipe(id, player.equipe);
                return true;
            }
            // Sélection du prochain Pokémon
            currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
            displayIntroAnimation(player, currentEnemy, io);
        }

        try {
            // Tour du joueur
            let response = await playerTurn(player, io);

            let actionPlayer = response.action;
            if (actionPlayer === 'flee') {
                // Le joueur fuit => fin du combat
                io.to(player.id).emit('endbattle');
                break;
            } else if (actionPlayer === 'attack') {
                // Compare la vitesse pour déterminer qui attaque en premier
                if (player.equipe.pokemons[0].speed >= currentEnemy.speed) {
                    // Attaque du joueur
                    performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                    displayIntroAnimation(player, currentEnemy, io);

                    if (currentEnemy.currentHp <= 0) continue;
                    if (player.equipe.pokemons[0].currentHp <= 0) continue;

                    // Attaque de l’ennemi
                    performAttack(currentEnemy, player.equipe.pokemons[0], getRandomNumber());
                    displayIntroAnimation(player, currentEnemy, io);

                } 
                else {
                    // Attaque de l’ennemi d'abord
                    performAttack(currentEnemy, player.equipe.pokemons[0], getRandomNumber());
                    displayIntroAnimation(player, currentEnemy, io);

                    if (player.equipe.pokemons[0].currentHp <= 0) continue;
                    if (currentEnemy.currentHp <= 0) continue;

                    // Attaque du joueur
                    performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                    displayIntroAnimation(player, currentEnemy, io);
                }
            } else if (actionPlayer === 'change') {
                playerChangePokemonByIndex(player.equipe, response.number, io, player.id);
                displayIntroAnimation(player, currentEnemy, io);
                performAttack(currentEnemy, player.equipe.pokemons[0], getRandomNumber());
                displayIntroAnimation(player, currentEnemy, io);
            }
        } catch (error) {
            console.log('Erreur pendant le tour du joueur : ', error);
            // En cas d'erreur, on peut décider de forcer une fuite ou autre
            break;
        }

        tours++;
    }

    // Vérification finale de l’état des équipes
    const playerHasPokemonAlive = hasAlivePokemon(player.equipe.pokemons);
    const enemyHasPokemonAlive = hasAlivePokemon(enemyTeam.pokemons);

    if (!enemyHasPokemonAlive) {
        endBattle(player, io, true);
    } else if (!playerHasPokemonAlive) {
        endBattle(player, io, false);
    } else {
        // Cas où le joueur a fui ou qu’un autre événement a mis fin au combat

        io.to(player.id).emit('endbattle');
    }

    await editEquipe(id, player.equipe);
    return true;
}

// Vérifie si au moins un Pokémon du tableau est vivant
function hasAlivePokemon(pokemons) {
    return pokemons.some(p => p.currentHp > 0);
}

function getRandomNumber() {
    return Math.floor(Math.random() * 4);
}

function playerChangePokemonByIndex(equipe, index, io, playerId) {
    if (index < 0 || index >= equipe.pokemons.length) {
        io.to(playerId).emit('playerNoPokemonLeft', {
            message: 'Index de Pokémon invalide.'
        });
        return;
    }
    // Vérifier que le Pokémon existe et n'est pas KO, etc.
    if (equipe.pokemons[index].currentHp <= 0) {
        io.to(playerId).emit('playerNoPokemonLeft', {
            message: 'Ce Pokémon est KO !'
        });
        return;
    }

    // Faire l'échange
    if (index !== 0) {
        [equipe.pokemons[0], equipe.pokemons[index]] = [equipe.pokemons[index], equipe.pokemons[0]];
    }

    io.to(playerId).emit('playerSwitchedPokemon', {
        message: `Vous avez envoyé ${equipe.pokemons[0].name} au combat !`
    });
}

function playerTurn(player, io) {
    return new Promise((resolve, reject) => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket) {
            return reject(new Error("Socket non trouvée pour le joueur: " + player.id));
        }

        playerSocket.emit('requestAction', { message: 'Quelle est votre prochaine action ?' });

        const responseListener = (response) => {
            playerSocket.off('actionResponse', responseListener);
            console.log(response.action);
            switch (response.action) {
                case "attack":
                    resolve(response);
                    break;
                case "flee":
                    resolve(response);
                    break;
                case "change":
                    resolve(response);
                    break;
                default:
                    reject(new Error("Action inconnue reçue du client: " + response.action));
            }
        };

        playerSocket.on('actionResponse', responseListener);

        setTimeout(() => {
            playerSocket.off('actionResponse', responseListener);
            reject(new Error("Erreur : Délai d'attente dépassé en attendant la réponse du joueur"));
        }, 60000);
    });
}

function performAttack(attacker, defender, moveIndex) {
    useattack(attacker.getAtkName(moveIndex), attacker, defender);
}


function displayIntroAnimation(player, wildPokemon, io) {
    
    io.to(player.id).emit('introAnimation', { player: player, wildPokemon: wildPokemon });
}


// Paramètres : equipe (celle du joueur), io, et l'id du player pour l'émission socket
function playerChangePokemon(equipe, io, playerId) {
    // On cherche le premier Pokémon vivant dans l'équipe
    const nextAlive = equipe.pokemons.findIndex(p => p.currentHp > 0);

    // S’il y a un Pokémon vivant (et qu’il n’est pas déjà en [0])
    if (nextAlive > 0) {
        // On swap le Pokémon en position 0 avec celui trouvé vivant
        const tmp = equipe.pokemons[0];
        equipe.pokemons[0] = equipe.pokemons[nextAlive];
        equipe.pokemons[nextAlive] = tmp;

        io.to(playerId).emit('playerSwitchedPokemon', {
            message: `Vous avez envoyé ${equipe.pokemons[0].name} au combat !`
        });
    } else {
        // Pas de Pokémon vivant disponible
        io.to(playerId).emit('playerNoPokemonLeft', {
            message: 'Plus de Pokémon valide dans votre équipe !'
        });
    }
}

function endBattle(player, io, playerWon) {
    io.to(player.id).emit('endbattle', {
        message: 'Fin du combat',
        playerWon
    });
    // ICI : Ajouter toute la logique de gains d’XP, gold, etc.
}

module.exports = startTeamBattle;

const { useattack, getEffectiveness } = require('./calculateInteraction.js');
const { editEquipe } = require('./actionequipe.js');


async function startTeamBattle(player, enemyTeam, io, id) {
    // enemyTeam : { pokemons: [Pokemon1, Pokemon2, ...] }
    // equipe    : { pokemons: [Pokemon1, Pokemon2, ...] } (équipe du joueur)
    // player    : contient notamment player.id pour la socket
    let usedPokemons = [];
    // console.log('Démarrage du combat d\'équipe.');
    const fs = require('fs');
    const loadData = () => {
        // console.log("DATA NNNNN");

        const data = fs.readFileSync('source_Json/moves.json', 'utf8');
        return JSON.parse(data);
    };

    const moves = loadData();

    let currentEnemyIndex = 0;
    let currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
    console.log("le current enemi est : ", currentEnemy);

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
            const xpWin = currentEnemy.experience * 0.1
            player.equipe.pokemons[0].gainExperience(xpWin)
            console.log("'j'ai win  :", xpWin);
            currentEnemyIndex++;
            if (!hasAlivePokemon(enemyTeam.pokemons)) {
                endBattle(player, io, true);
                await editEquipe(id, player.equipe);
                return true; // Fin du combat
            }
            currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
            displayIntroAnimation(player, currentEnemy, io);
            continue;
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

                // const haveToSwap = determineIfSwap(currentEnemy, enemyTeam, player.equipe.pokemons[0])
                // console.log('le swapping est utile ??? :::', haveToSwap);

                // Compare la vitesse pour déterminer qui attaque en premier
                if (player.equipe.pokemons[0].speed >= currentEnemy.speed) {

                    const haveToSwap = determineIfSwap(currentEnemy, enemyTeam, player.equipe.pokemons[0]);

                    if (haveToSwap !== false) {
                        enemySwapPokemon(enemyTeam, haveToSwap, usedPokemons);
                        currentEnemy = enemyTeam.pokemons[0]; // Met à jour l'ennemi après le swap
                        displayIntroAnimation(player, currentEnemy, io);
                        console.log('Les Pokémon ont été swap');
                    }

                    displayIntroAnimation(player, currentEnemy, io);
                    console.log('les pokemon sont swappppppppppppp');

                    // Attaque du joueur
                    performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                    displayIntroAnimation(player, currentEnemy, io);

                    if (currentEnemy.currentHp <= 0) {
                        const xpWin = currentEnemy.experience * 0.1
                        player.equipe.pokemons[0].gainExperience(xpWin)
                        console.log("'j'ai win  :", xpWin);
                        currentEnemyIndex++;
                        if (!hasAlivePokemon(enemyTeam.pokemons)) {
                            endBattle(player, io, true);
                            await editEquipe(id, player.equipe);
                            return true; // Fin du combat
                        }
                        currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
                        displayIntroAnimation(player, currentEnemy, io);
                        continue;
                    }
                    if (player.equipe.pokemons[0].currentHp <= 0) continue;


                    // Attaque de l’ennemi
                    if (haveToSwap == false) {
                        let bestAttack = getBestAttack(player.equipe.pokemons[0], currentEnemy, moves)
                        performAttack(currentEnemy, player.equipe.pokemons[0], bestAttack);
                        displayIntroAnimation(player, currentEnemy, io);
                    }

                }
                else {
                    // Attaque de l’ennemi d'abord
                    let bestAttack = getBestAttack(player.equipe.pokemons[0], currentEnemy, moves)
                    const attaqueName = currentEnemy.getAtkName(bestAttack)
                    const dmgatk = findDmgAtk(moves, attaqueName, currentEnemy, player.equipe.pokemons[0])
                    const haveToSwap = determineIfSwap(currentEnemy, enemyTeam, player.equipe.pokemons[0]);

                    if (haveToSwap !== false) {
                        console.log('il doit swap');

                        if (dmgatk >= player.equipe.pokemons[0].currentHp) {
                            console.log('il doit swap mais il a plus de degat');

                            performAttack(currentEnemy, player.equipe.pokemons[0], bestAttack);
                            displayIntroAnimation(player, currentEnemy, io);
                            console.log('ici');
                            if (player.equipe.pokemons[0].currentHp <= 0) {
                                playerChangePokemon(player.equipe, io, player.id);
                                if (!hasAlivePokemon(player.equipe.pokemons)) {
                                    endBattle(player, io, false);
                                    await editEquipe(id, player.equipe);
                                    return false; // Fin du combat
                                }
                                displayIntroAnimation(player, currentEnemy, io);
                                continue; // Passe à l'itération suivante
                            }

                            if (currentEnemy.currentHp <= 0) {
                                const xpWin = currentEnemy.experience * 0.1
                                player.equipe.pokemons[0].gainExperience(xpWin)
                                console.log("'j'ai win  :", xpWin);
                                currentEnemyIndex++;
                                if (!hasAlivePokemon(enemyTeam.pokemons)) {
                                    endBattle(player, io, true);
                                    await editEquipe(id, player.equipe);
                                    return true; // Fin du combat
                                }
                                currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
                                displayIntroAnimation(player, currentEnemy, io);
                                continue;
                            }
                            // Attaque du joueur
                            performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                            displayIntroAnimation(player, currentEnemy, io);
                            console.log('fin de performence');
                        } else {
                            console.log(' il doit swap il a pas de degat');
                            enemySwapPokemon(enemyTeam, haveToSwap, usedPokemons);
                            currentEnemy = enemyTeam.pokemons[0]; // Met à jour l'ennemi après le swap
                            displayIntroAnimation(player, currentEnemy, io);
                            console.log('Les Pokémon ont été swap');
                            // Attaque du joueur
                            performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                            displayIntroAnimation(player, currentEnemy, io);
                        }
                    }
                    else {

                        console.log(' ne doit pas swap');
                        performAttack(currentEnemy, player.equipe.pokemons[0], bestAttack);
                        displayIntroAnimation(player, currentEnemy, io);
                        if (player.equipe.pokemons[0].currentHp <= 0) continue;
                        if (currentEnemy.currentHp <= 0) {
                            const xpWin = currentEnemy.experience * 0.1
                            player.equipe.pokemons[0].gainExperience(xpWin)
                            console.log("'j'ai win  :", xpWin);

                            currentEnemyIndex++;
                            if (!hasAlivePokemon(enemyTeam.pokemons)) {
                                endBattle(player, io, true);
                                await editEquipe(id, player.equipe);
                                return true; // Fin du combat
                            }
                            currentEnemy = enemyTeam.pokemons[currentEnemyIndex];
                            displayIntroAnimation(player, currentEnemy, io);
                            continue;
                        }
                        // Attaque du joueur
                        performAttack(player.equipe.pokemons[0], currentEnemy, response.number);
                        displayIntroAnimation(player, currentEnemy, io);
                    }
                    console.log('je display ?');

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

function determineIfSwap(currentEnemy, enemyTeam, player) {
    let currentEffectiveness = getEffectiveness(player.type1, currentEnemy.type1) * (currentEnemy.type2 ? getEffectiveness(player.type1, currentEnemy.type2) : 1);
    if (player.type2) {
        currentEffectiveness *= getEffectiveness(player.type2, currentEnemy.type1) * (currentEnemy.type2 ? getEffectiveness(player.type2, currentEnemy.type2) : 1);
    }

    let bestSwap = false;
    let bestEffectiveness = currentEffectiveness;

    enemyTeam.pokemons.forEach((pokemon, index) => {
        if (pokemon.uuid === currentEnemy.uuid || pokemon.currentHp <= 0) return; // Ne pas swap avec soi-même ou un Pokémon KO

        let swapEffectiveness = getEffectiveness(player.type1, pokemon.type1) * (pokemon.type2 ? getEffectiveness(player.type1, pokemon.type2) : 1);
        if (player.type2) {
            swapEffectiveness *= getEffectiveness(player.type2, pokemon.type1) * (pokemon.type2 ? getEffectiveness(player.type2, pokemon.type2) : 1);
        }

        if (swapEffectiveness < bestEffectiveness) {
            bestEffectiveness = swapEffectiveness;
            bestSwap = index;
        }
    });

    return bestSwap !== false && bestEffectiveness < currentEffectiveness ? bestSwap : false;
}


function enemySwapPokemon(enemyTeam, index, usedPokemons) {
    if (index < 0 || index >= enemyTeam.pokemons.length) return; // Vérifie que l'index est valide
    if (enemyTeam.pokemons[index].currentHp <= 0) return; // Vérifie que le Pokémon n'est pas KO

    // Échanger le Pokémon actuel avec celui à l'index donné
    [enemyTeam.pokemons[0], enemyTeam.pokemons[index]] = [enemyTeam.pokemons[index], enemyTeam.pokemons[0]];

    // Mettre à jour la liste des Pokémon utilisés
    if (!usedPokemons.includes(enemyTeam.pokemons[0].uuid)) {
        usedPokemons.push(enemyTeam.pokemons[0].uuid);
    }
}





//find la meilleur atk
function getBestAttack(me, enemy, moves) {
    console.log("enemy.abilities:", enemy.abilities);

    return enemy.abilities
        .map((ability, index) => {
            const move = moves.find(m => m.ename === ability);
            if (!move) {
                // console.log(`⚠️ ${ability} n'a pas été trouvé dans moves.json`);
                return { index, score: -Infinity };
            }

            // console.log(`✅ ${ability} trouvé avec power: ${move.power}`);

            const stab = (move.type === enemy.type1 || (enemy.type2 && move.type === enemy.type2)) ? 1.5 : 1;
            const effectiveness1 = getEffectiveness(move.type, me.type1) || 1;
            const effectiveness2 = me.type2 ? (getEffectiveness(move.type, me.type2) || 1) : 1;
            const totalEffectiveness = effectiveness1 * effectiveness2;
            const score = move.power * totalEffectiveness * stab;

            // console.log(`⚡ Score de ${ability} :`, score);

            return { index, score };
        })
        .reduce((best, move) => {
            // console.log(`Comparaison : ${best.index} (${best.score}) vs ${move.index} (${move.score})`);
            return (move.score > best.score ? move : best);
        }, { index: -1, score: -Infinity })
        .index;

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
            // console.log(response.action);
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
        }, 120000);
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


function findDmgAtk(moves, attaque, pokemon1, pokemon2) {
    const findAttack = (attaque) => {
        for (let move of moves) {
            if (move.ename === attaque) {
                return move;
            }
        }
        return null;
    };

    const correspondingMove = findAttack(attaque);
    return calculateDamage(pokemon1, pokemon2, correspondingMove)
}

function calculateDamage(pokemonATK, PokemonDFS, ATK) {
    // console.log(ATK ,'dada');
    let Efficacite = getEffectiveness(ATK.type, PokemonDFS.type1) * getEffectiveness(ATK.type, PokemonDFS.type2);
    NivATKan = pokemonATK.level
    Puissanceatk = ATK.power
    STAB = 1;
    if (ATK.type == pokemonATK.type1 || ATK.type == pokemonATK.type2) {
        STAB = 1.5;
    }
    if (ATK.category == 'phy') {
        AttaqueATKan = pokemonATK.currentAttack
        DefenseDFS = PokemonDFS.currentDefense
    } else if (ATK.category == 'spe') {
        AttaqueATKan = pokemonATK.currentSpecialAttack
        DefenseDFS = PokemonDFS.currentSpecialDefense
    }
    let damage = ((((((2 * NivATKan / 5) + 2) * AttaqueATKan * Puissanceatk) / DefenseDFS) / 50) + 2) * STAB * Efficacite;
    // console.log('les dgts',damage);
    return Math.round(damage);
}

function endBattle(player, io, playerWon) {
    io.to(player.id).emit('endbattle', {
        message: 'Fin du combat',
        playerWon
    });
    console.log('endBattle le player a win ? ', playerWon);
    if (playerWon) {
        // player.equipe.pokemons[0].gainExperience(500000)
    }

    // ICI : Ajouter toute la logique de gains d’XP, gold, etc.
}

module.exports = startTeamBattle;

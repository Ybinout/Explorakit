
// player composé de son equipe

function startBattle(player, wildPokemon , io) {
    // console.log('la battle se start avec les deux : ',player);
    displayIntroAnimation(player, wildPokemon , io); //envoi par socket un trigger qui affiche le pokemon WEBSOCKET //////////////////////////////////////////////
    //tant que le pokemon et le wildpokemon ont des hp
    let tours = 0
    let actionPlayer = null
    let actionWildpokemon = null
    while (wildPokemon.currentHp > 0) {
        //permettre au joueur  de changer de pokemon
        if (player.pokemon.currentHp < 0)
            player = playerChangePokemon(player)


        actionPlayer = playerTurn(player, wildPokemon);
        actionWildpokemon = wildPokemonTurn(player, wildPokemon);

        //controle de speed du pokemon
        if (player.pokemon.speed > wildPokemon.speed) {
            performAttack(player, wildPokemon, actionPlayer);
            // il transmet par web socket les info et l animation

            //si un joueur et mort endbattle
            if (wildPokemon.currentHp <= 0 || player.pokemon.currentHp <= 0) {
                endBattle(player, wildPokemon)
                break;
            }
            performAttack(wildPokemon, player, actionWildpokemon);

            if (player.pokemon.currentHp < 0)
                player = playerChangePokemon(player)
        } else {
            performAttack(wildPokemon, player, actionWildpokemon);
            // il transmet par web socket les info et l animation

            //si un joueur et mort endbattle
            if (wildPokemon.currentHp <= 0 || player.pokemon.currentHp <= 0) {
                endBattle(player, wildPokemon)
                break;
            }

            performAttack(player, wildPokemon, actionPlayer);

            if (player.pokemon.currentHp <= 0)
                player = playerChangePokemon(player)
        }

        actionTerrain(terrain, wildPokemon, player)
        tours++;

    }
    endBattle(player.pokemon, wildPokemon); //donner les golds / et XP
}


function playerTurn(player, wildPokemon) {
    //envoi par socket un trigger qui affiche les attaque et possibilité WEBSOCKET ///////////////////////////////////////////////////////////////////////////////
    io.to(player.id).emit('requestAction', { message: 'Quelle est votre prochaine action ?' }, (response) => {
        console.log('l emit a été lancé');
        console.log(response);
        switch (response.action) {
            case "attack":
                return response;
                break;
            case "flee":
                handleFleeAttempt(player);
                break;
            // Ajoutez d'autres cas en fonction des actions possibles
            default:
                console.error("Action inconnue reçue du client:", response.action);
        }
    });
}

function endBattle(player, wildPokemon) {
    //gain d experinece 
    // envoi un signale qui vide la battle scene et la cache
    io.to(player.id).emit('endBattle', { message: 'Fin du combat' });
}

function wildPokemonTurn(player, wildPokemon) {
    return getRandomMove(wildPokemon);


}

function displayIntroAnimation(player, wildPokemon , io) {
    console.log('je suis la ,,,');
    io.to(player.id).emit('introAnimation', { player: player, wildPokemon: wildPokemon });
}


function playerChangePokemon(player) {
    //envoi par socket un trigger qui demande le changement de pokemon ou fuite  WEBSOCKET ///////////////////////////////////////////////////////////////////////////////


}


function actionTerrain(terrain, pokemonWild, player) {

}

function performAttack(pokemon1, pokemon2, atk) {
    //faire intervenir les attaque et leur effet
    // calculateDamage(wildPokemon, player.pokemon, move);
}

// const player = [{
//     client: clients[clientId],
//     equipe: {
//         pokemon1,
//         pokemon2,
//         pokemon3,
//         pokemon4,
//         pokemon5,
//     }
// }]


module.exports = startBattle; 
class Equipe {
    constructor() {
        this.pokemons = [];
    }

    ajouterPokemon(pokemon) {
        if (this.pokemons.length < 6) {
            this.pokemons.push(pokemon);
            // console.log(`${pokemon.truename} a été ajouté à l'équipe !`);
            // console.log(pokemon);
        } else {
            console.log("L'équipe est pleine !");
        }
    }

    afficherEquipe() {
        if (this.pokemons.length === 0) {
            console.log("L'équipe est vide !");
        } else {
            this.pokemons.forEach((pokemon, index) => {
                console.log(`${index + 1}. ${pokemon.name} - Niveau: ${pokemon.level}, PV: ${pokemon.currentHp}`);
            });
        }
    }

    echangerPokemon(position1, position2) {
        if (position1 >= 0 && position1 < this.pokemons.length && position2 >= 0 && position2 < this.pokemons.length) {
            [this.pokemons[position1], this.pokemons[position2]] = [this.pokemons[position2], this.pokemons[position1]];
            console.log(`Les Pokémon aux positions ${position1 + 1} et ${position2 + 1} ont été échangés !`);
        } else {
            console.log("Les positions fournies sont invalides !");
        }
    }

}

// function healEquipe(player) {
//     player.equipe.pokemons.forEach(pokemon => {
//         pokemon.currentHp = pokemon.maxHp; // Restaure les PV au maximum
//     });

//     console.log("Tous les Pokémon de l'équipe ont été soignés !");
// }

module.exports = Equipe;
// module.exports = healEquipe;
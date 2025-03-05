const axios = require('axios');
const Equipe = require('./equipe.js'); 
const Pokemon = require('./pokemon.js');

const API_BASE_URL = 'http://localhost:3000/api';

async function editEquipe(userId, equipe) {
    // console.log('Modification de l\'équipe', equipe);

    try {
        // Tenter de récupérer l'équipe de l'utilisateur
        const response = await axios.get(`${API_BASE_URL}/users/${userId}/team`);
        // console.log('Statut de la réponse:', response.status);
        // console.log('Réponse de l\'API pour l\'équipe:', response.data);  

        let teamId;
        if (response.status === 200) {
            teamId = response.data.id;
            // console.log('Équipe existante trouvée, teamId:', teamId);
            // Mettre à jour l'équipe existante
            await axios.put(`${API_BASE_URL}/teams/${teamId}`, {
                team_name: 'Updated Team Name' // Modifiez selon vos besoins
            });
        } else if (response.status === 201) {
            // Si une nouvelle équipe a été créée
            teamId = response.data.id;
            // console.log('Nouvelle équipe créée, teamId:', teamId);
        } else {
            console.error('Erreur inattendue, statut de la réponse:', response.status);
        }

        if (!teamId) {
            console.error('teamId est undefined ou null après la récupération ou la création.');
            return; // Arrêter l'exécution si teamId est incorrect
        }

        // Suppression des Pokémon existants associés à l'équipe
        // console.log(`Suppression des Pokémon existants pour l'équipe ${teamId}`);
        await axios.delete(`${API_BASE_URL}/pokemonsequipe/${teamId}`);
        // console.log('Pokémon existants supprimés.');

        // Gérer chaque Pokémon dans l'équipe
        for (const [index, pokemon] of equipe.pokemons.entries()) {
            const position = index + 1;  // Calculer la position du Pokémon dans l'équipe

            const pokemonData = {
                team_id: teamId,  // Assurez-vous que cette ligne passe bien l'ID correct
                position: position,
                pokemon_id: pokemon.data.id,
                name: pokemon.name,
                level: pokemon.level,
                experience: pokemon.experience,
                iv_attack: pokemon.iv.attack,
                iv_defense: pokemon.iv.defense,
                iv_hp: pokemon.iv.hp,
                iv_special_attack: pokemon.iv.specialAttack,
                iv_special_defense: pokemon.iv.specialDefense,
                iv_speed: pokemon.iv.speed,
                nature: pokemon.nature,
                k: pokemon.k,
                current_hp: pokemon.currentHp,
                current_attack: pokemon.currentAttack,
                current_defense: pokemon.currentDefense,
                current_special_attack: pokemon.currentSpecialAttack,
                current_special_defense: pokemon.currentSpecialDefense,
                current_speed: pokemon.currentSpeed,
                ability1: pokemon.abilities[0],
                ability2: pokemon.abilities[1],
                ability3: pokemon.abilities[2],
                ability4: pokemon.abilities[3]
            };

            try {
                // Vérifier si le Pokémon existe déjà
                const pokemonResponse = await axios.get(`${API_BASE_URL}/pokemons/${pokemon.uuid}`);
                // console.log("Réponse du Pokémon:", pokemonResponse);

                if (pokemonResponse.status === 200) {
                    // Mettre à jour le Pokémon existant
                    await axios.put(`${API_BASE_URL}/pokemons/${pokemon.uuid}`, pokemonData);
                }
            } catch (pokemonError) {
                if (pokemonError.response && pokemonError.response.status === 404) {
                    // console.log(`Pokémon non trouvé, création d'un nouveau Pokémon pour la position ${position}`);
                    try {
                        const createPokemonResponse = await axios.post(`${API_BASE_URL}/pokemons`, {
                            ...pokemonData // Envoyer les données pour créer le Pokémon
                        });
                        // console.log('Nouveau Pokémon créé:', createPokemonResponse.data);
                    } catch (creationError) {
                        console.error(`Erreur lors de la création du Pokémon à la position ${position}:`, creationError.response?.data || creationError.message);
                    }
                } else {
                    console.error(`Erreur inattendue lors de la gestion du Pokémon à la position ${position}:`, pokemonError.response?.data || pokemonError.message);
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la modification de l\'équipe:', error.response?.data || error.message);
    }
}






async function loadEquipe(userId) {
    try {
        // Récupérer l'équipe de l'utilisateur
        const teamResponse = await axios.get(`${API_BASE_URL}/users/${userId}/team`);
        if (teamResponse.status === 200) {
            const equipe = new Equipe();
            const teamId = teamResponse.data.id;

            // Récupérer tous les Pokémon de l'équipe
            const pokemonsResponse = await axios.get(`${API_BASE_URL}/teams/${teamId}/pokemons`);
            if (pokemonsResponse.status === 200) {
                let pokemonsData = pokemonsResponse.data;

                // Trier les Pokémon par position avant de les ajouter à l'équipe
                pokemonsData = pokemonsData.sort((a, b) => a.position - b.position);

                // Charger chaque Pokémon dans l'équipe
                for (const pokemonData of pokemonsData) {
                    const pokemon = new Pokemon(
                        pokemonData.pokemon_id,
                        pokemonData.name,
                        pokemonData.level,
                        pokemonData.experience,
                        {
                            attack: pokemonData.iv_attack,
                            defense: pokemonData.iv_defense,
                            hp: pokemonData.iv_hp,
                            specialAttack: pokemonData.iv_special_attack,
                            specialDefense: pokemonData.iv_special_defense,
                            speed: pokemonData.iv_speed
                        },
                        pokemonData.nature,
                        pokemonData.k
                    );
                    pokemon.currentHp = pokemonData.current_hp;
                    pokemon.currentAttack = pokemonData.current_attack;
                    pokemon.currentDefense = pokemonData.current_defense;
                    pokemon.currentSpecialAttack = pokemonData.current_special_attack;
                    pokemon.currentSpecialDefense = pokemonData.current_special_defense;
                    pokemon.currentSpeed = pokemonData.current_speed;
                    pokemon.abilities = [
                        pokemonData.ability1,
                        pokemonData.ability2,
                        pokemonData.ability3,
                        pokemonData.ability4
                    ].filter(ability => ability !== null);

                    equipe.ajouterPokemon(pokemon);
                }

                return equipe;
            } else {
                console.error('Failed to load pokemons:', pokemonsResponse.data);
            }
        } else {
            console.error('Failed to load team:', teamResponse.data);
        }
    } catch (error) {
        console.error('Error loading team:', error.response?.data || error.message);
    }

    return null; // En cas d'échec, retourner null
}


module.exports = {
    editEquipe,
    loadEquipe
};

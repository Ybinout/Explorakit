const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
// const Pokemon = require('./path/to/pokemon/class'); // Assurez-vous de remplacer par le bon chemin vers votre classe Pokemon
const jwt = require('jsonwebtoken');

const Equipe = require('../equipe.js');
const Pokemon = require('../pokemon.js');

const JWT_SECRET = 'your_jwt_secret_key';

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'pokemon_game'
};

// Ajouter un utilisateur
// Modifier la route d'inscription pour utiliser '/users'
router.post('/users', async (req, res) => {
    const { username, password } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, password]);
        connection.end();

        res.status(201).send({ message: 'User inserted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});


// Modifier un utilisateur
router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, email, password_hash, x, y, map } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'UPDATE users SET username = ?, email = ?, password_hash = ?, x = ?, y = ?, map = ? WHERE id = ?',
            [username, email, password_hash, x, y, map, id]
        );
        connection.end();

        res.status(200).send({ message: 'User updated!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Supprimer un utilisateur
router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM users WHERE id = ?', [id]);
        connection.end();

        res.status(200).send({ message: 'User deleted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Ajouter une équipe
router.post('/teams', async (req, res) => {
    const { user_id, team_name } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'INSERT INTO teams (user_id, team_name) VALUES (?, ?)',
            [user_id, team_name]
        );
        connection.end();

        res.status(201).send({ message: 'Team inserted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Modifier une équipe
router.put('/teams/:id', async (req, res) => {
    const { id } = req.params;
    const { team_name } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'UPDATE teams SET team_name = ? WHERE id = ?',
            [team_name, id]
        );
        connection.end();

        res.status(200).send({ message: 'Team updated!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Supprimer une équipe
router.delete('/teams/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM teams WHERE id = ?', [id]);
        connection.end();

        res.status(200).send({ message: 'Team deleted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

function normalizePokemonData(data) {
    return {
        team_id: data.team_id || null,
        position: data.position || null,
        pokemon_id: data.pokemon_id || null,
        name: data.name || null,
        level: data.level || null,
        experience: data.experience || null,
        iv_attack: data.iv_attack || null,
        iv_defense: data.iv_defense || null,
        iv_hp: data.iv_hp || null,
        iv_special_attack: data.iv_special_attack || null,
        iv_special_defense: data.iv_special_defense || null,
        iv_speed: data.iv_speed || null,
        nature: data.nature || null,
        k: data.k || null,
        current_hp: data.current_hp || null,
        current_attack: data.current_attack || null,
        current_defense: data.current_defense || null,
        current_special_attack: data.current_special_attack || null,
        current_special_defense: data.current_special_defense || null,
        current_speed: data.current_speed || null,
        ability1: data.ability1 || null,
        ability2: data.ability2 || null,
        ability3: data.ability3 || null,
        ability4: data.ability4 || null
    };
}

// Ajouter un Pokémon
router.post('/pokemons', async (req, res) => {
    const {
        team_id, pokemon_id, name, level, experience, iv_attack, iv_defense, iv_hp, iv_special_attack,
        iv_special_defense, iv_speed, nature, k, current_hp, current_attack, current_defense,
        current_special_attack, current_special_defense, current_speed, ability1, ability2,
        ability3, ability4, position
    } = normalizePokemonData(req.body); // Normaliser les données ici

    const uuid = uuidv4(); // Générer un UUID pour le Pokémon

    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // Log avant insertion pour vérifier les données
            (uuid, team_id, position, pokemon_id, name, level, experience, iv_attack, iv_defense, iv_hp, 
             iv_special_attack, iv_special_defense, iv_speed, nature, k, current_hp, current_attack, 
             current_defense, current_special_attack, current_special_defense, current_speed, ability1, 
             ability2, ability3, ability4) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuid, team_id, position, pokemon_id, name, level, experience, iv_attack, iv_defense, iv_hp,
            iv_special_attack, iv_special_defense, iv_speed, nature, k, current_hp, current_attack,
            current_defense, current_special_attack, current_special_defense, current_speed,
            ability1, ability2, ability3, ability4]
        );
        
        connection.end();
        res.status(201).send({ message: 'Pokemon inserted!', uuid });
    } catch (error) {
        console.error('Erreur lors de l\'insertion du Pokémon:', error);
        res.status(500).send({ message: 'Database error', error });
    }
});



// Modifier un Pokémon
router.put('/pokemons/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const {
        team_id, pokemon_id, name, level, experience, iv_attack, iv_defense, iv_hp, iv_special_attack,
        iv_special_defense, iv_speed, nature, k, current_hp, current_attack, current_defense,
        current_special_attack, current_special_defense, current_speed, ability1, ability2,
        ability3, ability4, position
    } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            `UPDATE pokemons SET 
            team_id = ?, position = ?, pokemon_id = ?, name = ?, level = ?, experience = ?, 
            iv_attack = ?, iv_defense = ?, iv_hp = ?, iv_special_attack = ?, iv_special_defense = ?, 
            iv_speed = ?, nature = ?, k = ?, current_hp = ?, current_attack = ?, current_defense = ?, 
            current_special_attack = ?, current_special_defense = ?, current_speed = ?, ability1 = ?, 
            ability2 = ?, ability3 = ?, ability4 = ?
            WHERE uuid = ?`,
            [team_id, position, pokemon_id, name, level, experience, iv_attack, iv_defense, iv_hp,
            iv_special_attack, iv_special_defense, iv_speed, nature, k, current_hp, current_attack,
            current_defense, current_special_attack, current_special_defense, current_speed,
            ability1, ability2, ability3, ability4, uuid]
        );
        connection.end();

        res.status(200).send({ message: 'Pokemon updated!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});


// Supprimer un Pokémon
router.delete('/pokemons/:uuid', async (req, res) => {
    const { uuid } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM pokemons WHERE uuid = ?', [uuid]);
        connection.end();

        res.status(200).send({ message: 'Pokemon deleted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

router.delete('/pokemonsequipe/:team', async (req, res) => {
    const { team } = req.params;  // Utilisez `team` ici, qui est l'ID de l'équipe

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM pokemons WHERE team_id = ?', [team]);  // Utilisez `team` ici
        connection.end();

        res.status(200).send({ message: 'Pokemon deleted!' });
    } catch (error) {
        console.error('Erreur lors de la suppression des Pokémon:', error);
        res.status(500).send({ message: 'Database error', error });
    }
});







// Récupérer les informations d'un utilisateur
router.get('/users/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM users WHERE id = ?', [id]);
        connection.end();

        if (rows.length > 0) {
            res.status(200).send(rows[0]);
        } else {
            res.status(404).send({ message: 'User not found!' });
        }
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Récupérer les informations d'une équipe
router.get('/teams/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM teams WHERE id = ?', [id]);
        connection.end();

        if (rows.length > 0) {
            res.status(200).send(rows[0]);
        } else {
            res.status(404).send({ message: 'Team not found!' });
        }
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Récupérer les informations d'un Pokémon
router.get('/pokemons/:uuid', async (req, res) => {
    const { uuid } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM pokemons WHERE uuid = ?', [uuid]);
        connection.end();

        if (rows.length > 0) {
            res.status(200).send(rows[0]);
        } else {
            res.status(404).send({ message: 'Pokemon not found!' });
        }
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// Récupérer l'équipe d'un utilisateur (avec les Pokémon)
router.get('/users/:id/team', async (req, res) => {
    
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [teamRows] = await connection.execute(
            'SELECT * FROM teams WHERE user_id = ?', [id]
        );

        if (teamRows.length === 0) {

            // Créer une nouvelle équipe
            const [createResult] = await connection.execute(
                'INSERT INTO teams (user_id, team_name) VALUES (?, ?)', 
                [id, 'New Team Name']
            );

            const newTeamId = createResult.insertId;

            // Renvoyer l'équipe nouvellement créée
            const newTeam = {
                id: newTeamId,
                user_id: id,
                team_name: 'New Team Name',
                pokemons: []
            };

            connection.end();
            return res.status(201).send(newTeam); // 201 pour Created
        }

        const team = teamRows[0];
        const equipe = new Equipe();
        equipe.id = team.id;  // Assigner l'ID de l'équipe à l'objet `equipe`
        equipe.user_id = team.user_id;  // Assigner l'ID de l'utilisateur à l'objet `equipe`
        equipe.team_name = team.team_name;  // Assigner le nom de l'équipe à l'objet `equipe`

        const [pokemonRows] = await connection.execute(
            'SELECT * FROM pokemons WHERE team_id = ? ORDER BY position', [team.id]
        );

        for (const pokemonData of pokemonRows) {
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
            pokemon.abilities = [pokemonData.ability1, pokemonData.ability2, pokemonData.ability3, pokemonData.ability4].filter(ability => ability !== null);

            equipe.ajouterPokemon(pokemon);
        }

        connection.end();
        res.status(200).send(equipe);
    } catch (error) {
        console.error('Erreur de base de données:', error);
        res.status(500).send({ message: 'Database error', error });
    }
});





router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Requête pour récupérer l'utilisateur par son nom d'utilisateur
        const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
        connection.end();

        if (rows.length === 0) {
            // Si aucun utilisateur n'est trouvé avec ce nom d'utilisateur
            return res.status(404).send({ message: 'User not found!' });
        }

        const user = rows[0];

        // Comparer le mot de passe fourni avec celui stocké dans la base de données
        if (user.password_hash === password) {
            // Si les mots de passe correspondent
            res.send({ message: 'Login successful!', user: { id: user.id, username: user.username } });
        } else {
            // Si les mots de passe ne correspondent pas
            res.status(401).send({ message: 'Invalid credentials!' });
        }
    } catch (error) {
        // Gestion des erreurs et logs
        console.error('Database error:', error);
        res.status(500).send({ message: 'Database error', error });
    }
});


router.get('/teams/:teamId/pokemons', async (req, res) => {
    const { teamId } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Récupérer tous les Pokémon appartenant à l'équipe spécifiée
        const [pokemonRows] = await connection.execute(
            'SELECT * FROM pokemons WHERE team_id = ? ORDER BY position',
            [teamId]
        );

        connection.end();

        if (pokemonRows.length > 0) {
            res.status(200).send(pokemonRows);
        } else {
            res.status(404).send({ message: 'No Pokémon found for this team!' });
        }
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send({ message: 'Database error', error });
    }
});


module.exports = router;

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'explorakit'
};

router.post('/', async (req, res) => {
    const { nom, mdp } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('INSERT INTO users (nom, mdp) VALUES (?, ?)', [nom, mdp]);
        connection.end();

        res.status(201).send({ message: 'User inserted!' });
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

router.post('/login', async (req, res) => {
    const { nom, mdp } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM users WHERE nom = ?', [nom]);
        connection.end();

        if (rows.length && rows[0].mdp === mdp) {
            res.send({ message: 'Login successful!' });
        } else {
            res.status(401).send({ message: 'Login failed' });
        }
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});

// router.post('/equipe', async (req, res) => {
//     const { data } = req.body;
//     try {
//         const connection = await mysql.createConnection(dbConfig);
//         const [result] = await connection.execute('INSERT INTO equipe (data) VALUES (?)', [JSON.stringify(data)]);
//         connection.end();

//         const equipeId = result.insertId;

//         res.status(201).send({ message: 'Equipe inserted!', equipeId: equipeId });
//     } catch (error) {
//         res.status(500).send({ message: 'Database error', error });
//     }
// });

router.put('/user/:userId/equipe', async (req, res) => {
    const { data } = req.body;
    const userId = req.params.userId; // Récupère l'ID de l'utilisateur à partir de l'URL

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Récupère l'équipe actuelle de l'utilisateur
        const [rows] = await connection.execute('SELECT equipe FROM users WHERE id = ?', [userId]);
        const currentEquipeId = rows[0]?.equipe;

        if (currentEquipeId) {
            // Met à jour l'équipe existante
            await connection.execute('UPDATE equipe SET data = ? WHERE id = ?', [JSON.stringify(data), currentEquipeId]);
            res.status(200).send({ message: 'Existing equipe updated!', equipeId: currentEquipeId });
        } else {
            // Insère une nouvelle équipe
            const [result] = await connection.execute('INSERT INTO equipe (data) VALUES (?)', [JSON.stringify(data)]);
            const equipeId = result.insertId;

            // Met à jour le champ equipe de l'utilisateur
            await connection.execute('UPDATE users SET equipe = ? WHERE id = ?', [equipeId, userId]);

            res.status(200).send({ message: 'New equipe inserted for user!', equipeId: equipeId });
        }

        connection.end();
    } catch (error) {
        res.status(500).send({ message: 'Database error', error });
    }
});




module.exports = router;

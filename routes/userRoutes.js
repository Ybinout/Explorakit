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

module.exports = router;

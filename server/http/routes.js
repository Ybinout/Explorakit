const express = require('express');
const { dbPool, withTransaction } = require('../config/database');
const { signAccessToken } = require('../config/auth');
const { authenticateHttp } = require('./authMiddleware');
const { authenticateUser, createUserWithStarter } = require('../persistence/userRepository');
const { getTeamPokemons, getTeamRecord, rowToPokemon } = require('../persistence/teamRepository');
const { equipHeldItem, loadUserItems } = require('../persistence/itemRepository');
const { loadPokedex, loadProgressState } = require('../persistence/progressionRepository');
const { getProfile: getRiftProfile } = require('../persistence/riftAccountRepository');

const router = express.Router();
const {rateLimit}=require('./rateLimit');
router.use(['/users','/login'], (req,res,next)=>req.method==='POST'?authLimit(req,res,next):next());
const authLimit=rateLimit({limit:20});

function parsePositiveId(value) {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function ownsRequestedUser(req) {
    return parsePositiveId(req.params.id) === req.user.id;
}

async function getOwnedTeam(teamId, userId, executor = dbPool) {
    const [rows] = await executor.execute(
        'SELECT id, user_id, team_name FROM teams WHERE id = ? AND user_id = ? LIMIT 1',
        [teamId, userId]
    );
    return rows[0] || null;
}

router.post('/users', async (req, res) => {
    try {
        const user = await createUserWithStarter(req.body?.username, req.body?.password, {
            sprite: req.body?.sprite,
            starterId: req.body?.starterId
        });
        return res.status(201).send({
            message: 'Compte créé avec son équipe de départ.',
            user,
            token: signAccessToken(user)
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send({ message: "Ce nom d'utilisateur existe déjà." });
        }
        if (error.message?.includes('doit contenir') || error.message === 'Starter invalide.') {
            return res.status(400).send({ message: error.message });
        }
        console.error('Erreur inscription:', error.message);
        return res.status(500).send({ message: "Impossible de créer le compte." });
    }
});

router.post('/login', async (req, res) => {
    try {
        const user = await authenticateUser(req.body?.username, req.body?.password);
        if (!user) return res.status(401).send({ message: 'Identifiants invalides.' });
        return res.send({ user, token: signAccessToken(user) });
    } catch (error) {
        console.error('Erreur connexion:', error.message);
        return res.status(500).send({ message: 'Connexion impossible.' });
    }
});

router.use(authenticateHttp);
router.use('/community',require('./trainerRoutes'));
router.use('/rift',rateLimit({limit:90}),require('./riftRoutes'));


router.get('/rift/profile', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        return res.send(await getRiftProfile(req.user.id));
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).send({ message: error.message });
        console.error('Erreur profil RiftMon:', error.message);
        return res.status(503).send({ message: 'Le profil RiftMon est momentanément indisponible.' });
    }
});

router.get('/users/:id/items', async (req, res) => {
    if (!ownsRequestedUser(req)) return res.status(403).send({ message: 'Accès interdit.' });
    try {
        return res.send({ items: await loadUserItems(req.user.id) });
    } catch (error) {
        console.error('Erreur inventaire:', error.message);
        return res.status(500).send({ message: "Impossible de charger l'inventaire." });
    }
});

router.get('/users/:id/team', async (req, res) => {
    if (!ownsRequestedUser(req)) return res.status(403).send({ message: 'Accès interdit.' });
    try {
        const team = await getTeamRecord(req.user.id);
        if (!team) return res.status(404).send({ message: 'Équipe introuvable.' });
        const pokemons = await getTeamPokemons(team.id);
        return res.send({ ...team, pokemons: pokemons.map(row => ({ ...row, ...rowToPokemon(row) })) });
    } catch (error) {
        console.error('Erreur équipe:', error.message);
        return res.status(500).send({ message: "Impossible de charger l'équipe." });
    }
});

router.get('/users/:id/progress', async (req, res) => {
    if (!ownsRequestedUser(req)) return res.status(403).send({ message: 'Accès interdit.' });
    try {
        return res.send(await loadProgressState(req.user.id));
    } catch (error) {
        console.error('Erreur progression:', error.message);
        return res.status(500).send({ message: 'Impossible de charger la progression.' });
    }
});

router.get('/users/:id/pokedex', async (req, res) => {
    if (!ownsRequestedUser(req)) return res.status(403).send({ message: 'Accès interdit.' });
    try {
        return res.send(await loadPokedex(req.user.id));
    } catch (error) {
        console.error('Erreur Pokédex:', error.message);
        return res.status(500).send({ message: 'Impossible de charger le Pokédex.' });
    }
});

router.get('/teams/:teamId/pokemons', async (req, res) => {
    const teamId = parsePositiveId(req.params.teamId);
    if (!teamId) return res.status(400).send({ message: "Identifiant d'équipe invalide." });
    try {
        const team = await getOwnedTeam(teamId, req.user.id);
        if (!team) return res.status(404).send({ message: 'Équipe introuvable.' });
        return res.send(await getTeamPokemons(teamId));
    } catch (error) {
        console.error('Erreur Pokémon:', error.message);
        return res.status(500).send({ message: "Impossible de charger les Pokémon." });
    }
});

router.put('/teams/:teamId/pokemons/reorder', async (req, res) => {
    const teamId = parsePositiveId(req.params.teamId);
    const orderedUuids = req.body?.orderedUuids;
    if (!teamId || !Array.isArray(orderedUuids) || orderedUuids.length > 6) {
        return res.status(400).send({ message: 'Ordre invalide.' });
    }
    if (new Set(orderedUuids).size !== orderedUuids.length || orderedUuids.some((uuid) => typeof uuid !== 'string')) {
        return res.status(400).send({ message: 'UUID invalides ou dupliqués.' });
    }

    try {
        await withTransaction(async (connection) => {
            const team = await getOwnedTeam(teamId, req.user.id, connection);
            if (!team) {
                const error = new Error('Équipe introuvable.');
                error.statusCode = 404;
                throw error;
            }
            const [rows] = await connection.execute(
                'SELECT uuid FROM pokemons WHERE team_id = ? FOR UPDATE',
                [teamId]
            );
            const existing = rows.map((row) => row.uuid).sort();
            const requested = [...orderedUuids].sort();
            if (existing.length !== requested.length || existing.some((uuid, index) => uuid !== requested[index])) {
                const error = new Error("La liste ne correspond pas à l'équipe complète.");
                error.statusCode = 409;
                throw error;
            }
            await connection.execute('UPDATE pokemons SET position = position + 100 WHERE team_id = ?', [teamId]);
            for (const [index, uuid] of orderedUuids.entries()) {
                await connection.execute(
                    'UPDATE pokemons SET position = ? WHERE team_id = ? AND uuid = ?',
                    [index + 1, teamId, uuid]
                );
            }
        });
        return res.send({ message: 'Ordre sauvegardé.' });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).send({ message: error.message });
        console.error('Erreur réorganisation:', error.message);
        return res.status(500).send({ message: "Impossible de sauvegarder l'ordre." });
    }
});

router.put('/teams/:teamId/pokemons/:uuid/held-item', async (req, res) => {
    const teamId = parsePositiveId(req.params.teamId);
    const pokemonUuid = typeof req.params.uuid === 'string' ? req.params.uuid : '';
    const itemKey = req.body?.itemKey || null;
    if (!teamId || !pokemonUuid) {
        return res.status(400).send({ message: 'Objet tenu invalide.' });
    }

    try {
        const heldItem = await equipHeldItem(req.user.id, teamId, pokemonUuid, itemKey);

        return res.send({ heldItem, items: await loadUserItems(req.user.id) });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).send({ message: error.message });
        console.error('Erreur objet tenu:', error.message);
        return res.status(500).send({ message: "Impossible d'équiper cet objet." });
    }
});

module.exports = router;

const router = require('express').Router();
const repository = require('../persistence/patchNotesRepository');

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', async (req, res) => {
    try {
        res.send({ patch: await repository.unread(req.user.id) });
    } catch (error) {
        console.error('Annonce de mise à jour indisponible:', error.message);
        res.status(503).send({ message: 'Annonce momentanément indisponible.' });
    }
});
router.post('/seen', async (req, res) => {
    try {
        await repository.acknowledge(req.user.id, req.body?.version);
        res.send({ success: true });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).send({ message: error.message });
        console.error('Lecture de mise à jour non sauvegardée:', error.message);
        res.status(503).send({ message: 'Lecture non sauvegardée. Réessaie dans un instant.' });
    }
});
module.exports = router;

const express = require('express');
const collection = require('../persistence/riftCollectionRepository');
const colosseum = require('../persistence/colosseumRepository');
const router = express.Router();
const route = (handler) => async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.send(await handler(req));
    } catch (e) {
        if (!e.statusCode) console.error('Collection RiftMon:', e.message);
        res.status(e.statusCode || 503).send({
            message: e.statusCode ? e.message : 'Le carnet est temporairement indisponible.',
        });
    }
};
router.get(
    '/collection',
    route((req) => collection.collection(req.user.id))
);
router.post(
    '/collection/buy',
    route((req) => collection.purchase(req.user.id, req.body?.key))
);
router.post(
    '/collection/equip',
    route((req) => collection.equip(req.user.id, req.body?.type, req.body?.key))
);
router.get(
    '/history',
    route(async (req) => ({ reports: await collection.history(req.user.id) }))
);
router.get('/colosseum/leaderboard', route(req => colosseum.leaderboard(req.user.id, req.query.durationMinutes === undefined ? 60 : Number(req.query.durationMinutes))));
module.exports = router;

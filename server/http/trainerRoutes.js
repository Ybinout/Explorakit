const express = require('express');
const repository = require('../persistence/trainerRepository');
const { rateLimit } = require('./rateLimit');
const router = express.Router();
const route = fn => async (req,res) => {
    res.set('Cache-Control','no-store');
    try { res.send(await fn(req)); }
    catch(e) {
        if(!e.statusCode)console.error('Carnet des dresseurs:',e.message);
        res.status(e.statusCode || 503).send({message:e.statusCode?e.message:'Le carnet est temporairement indisponible.'});
    }
};
router.use(rateLimit({limit:90}));
router.get('/profiles/:id',route(req=>repository.profile(req.user.id,req.params.id)));
router.get('/search',route(req=>repository.search(req.user.id,req.query.q,req.query.offset===undefined?0:Number(req.query.offset))));
router.get('/friends',route(req=>repository.friends(req.user.id)));
router.post('/friends/:id',rateLimit({limit:20}),route(req=>repository.friendAction(req.user.id,req.params.id,req.body?.action)));
router.get('/leaderboard',route(req=>repository.leaderboard(req.user.id)));
module.exports=router;

const {randomInt,randomUUID}=require('node:crypto');
const LOSS_CHANCE=.5;
function resetLiving(team){for(const p of team?.pokemons||[])if(p.currentHp>0)for(const key of ['__darkKoId','__darkKoSurvived','__darkSurvivalSettled','__darkSurvivalProtected'])delete p[key];}
function identity(p){return p.__darkKoId ||= randomUUID();}
function outcome(p,pick=randomInt){if(p.__darkSurvivalProtected||p.heldItem===require('../items/darkSurvivalKit').KEY)return 'kit';return pick(2)===0?'lost':'survived';}
module.exports={LOSS_CHANCE,resetLiving,identity,outcome};

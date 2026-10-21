const storage = require('../storage/pokemonStorage');
const { requireComputer } = require('../world/pokemonComputer');
const economy = require('./economy');
const report = require('./runReport');
function requireAccess(p) {
    economy.requireMutable(p);
    if (p.run.phase !== 'exploration') economy.fail('Le PC est accessible pendant l’exploration uniquement.');
    try { requireComputer(p); } catch(e) { economy.fail(e.message); }
}
function open(p) { requireAccess(p); return storage.view(p.equipe.pokemons,p.storage || [],true); }
function mutate(p, payload) {
    requireAccess(p);
    let plan;
    try { plan = storage.planAction(p.equipe.pokemons,p.storage || [],payload); } catch(e) { economy.fail(e.message); }
    p.equipe.pokemons=plan.team;p.storage=plan.entries;p.ready=false;
    if (plan.released?.heldItem) p.items[plan.released.heldItem]=(p.items[plan.released.heldItem]||0)+1;
    report.syncTeam(p);
    report.event(p,'pc',plan.released?`${plan.released.truename || plan.released.name} a été relâché.`:'Équipe réorganisée au PC du Centre.');
    return {success:true,state:open(p),equipe:p.equipe,items:economy.bag(p)};
}
module.exports={requireAccess,open,mutate};

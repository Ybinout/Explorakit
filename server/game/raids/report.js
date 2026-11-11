// Observations only: never change damage, healing, threat or the simulator RNG.
const own = p => p?.side?.n === 0;
const empty = () => ({damage:0, shield:0, healing:0});
function initialize(sim, partial = false) {
    if (sim.raid && !sim.raid.report) sim.raid.report = {version:1, partial, pokemon:{}};
}
function record(sim, source, metric, amount) {
    if (!sim.raid || sim.raid.threatProjection || !own(source) || !Number.isFinite(amount) || amount <= 0) return;
    const id = source.set?.rift?.uuid;
    if (!id) return;
    initialize(sim, true);
    const totals = sim.raid.report.pokemon[id] ||= empty();
    totals[metric] += amount;
}
function damageSource(target, source, effect) {
    // Native residuals may name the affected Pokémon rather than their author.
    if (['psn','tox','brn'].includes(effect?.id)) return target.statusState?.source || source;
    return source;
}
function damage(sim, target, source, effect, amount, metric = 'damage') {
    if (target?.side?.n === 1) record(sim, damageSource(target, source, effect), metric, amount);
}
function heal(sim, target, source, effect, amount) {
    if (!own(target)) return;
    // Drain identifies the drained foe as source; the beneficiary performed it.
    const author = ['drain','leechseed','poisonheal'].includes(effect?.id) || !source ? target : source;
    record(sim, author, 'healing', amount);
}
function view(battle) {
    const report = battle.sim.raid.report;
    if (!report) return null;
    const trainers = new Map();
    for (const [slot, model] of battle.models.entries()) {
        const p = model.pokemon;
        if (!trainers.has(model.ownerId)) trainers.set(model.ownerId, {
            id:model.ownerId, name:model.ownerName, ...empty(), pokemon:[]
        });
        const trainer = trainers.get(model.ownerId), totals = report.pokemon[p.uuid] || empty();
        for (const metric of ['damage','shield','healing']) trainer[metric] += totals[metric];
        trainer.pokemon.push({slot, uuid:p.uuid, pokemonId:p.data.id, name:p.truename || p.name || p.data.name.french,
            shiny:!!p.shiny, ...totals});
    }
    return {partial:report.partial, trainers:[...trainers.values()]};
}
module.exports = {initialize, damage, heal, view};

const { items } = require('../../../data/game/items.json');
function remainingRepel(player) {
    const n = Number(player?.repelSteps);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 250) : 0;
}
function leadPokemon(player) {
    return player?.equipe?.pokemons?.find(p => p.currentHp > 0 && !p.riftFainted && !p.isEgg);
}
function repelDuration(key) {
    const item = items.find(i => i.key === key && i.category === 'field' && i.repelSteps);
    if (!item) throw Error('Cet objet n’est pas un Repousse.');
    return item.repelSteps;
}
function validateRepel(player, key) {
    const steps = repelDuration(key);
    if (remainingRepel(player)) throw Error('Un Repousse est déjà actif. Attends la fin de son effet.');
    if (!leadPokemon(player)) throw Error('Il faut un Pokémon apte au combat dans ton équipe.');
    return steps;
}
// Call once per accepted tile, before portal/encounter handling. The last step is protected.
function stepRepel(player) {
    const remaining = remainingRepel(player);
    if (!remaining) return null;
    player.repelSteps = remaining - 1;
    return { level: Number(leadPokemon(player)?.level) || 0, remaining: player.repelSteps, expired: player.repelSteps === 0 };
}
function repelsWild(protection, wild) {
    return Boolean(protection && Number(wild?.level) < protection.level);
}
module.exports = { remainingRepel, repelDuration, validateRepel, stepRepel, repelsWild };

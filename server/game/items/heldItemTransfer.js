const { getItemDefinition } = require('../battle/battleResources');

// Plan against authoritative slots; expected items prevent replaying an old drag
// from swapping them straight back. Neither the team nor the bag is mutated.
function planHeldItemTransfer(team, payload) {
    const { sourceUuid, targetUuid, sourceItem, targetItem } = payload || {};
    if (typeof sourceUuid !== 'string' || typeof targetUuid !== 'string' || !sourceUuid || !targetUuid ||
        sourceUuid.length > 64 || targetUuid.length > 64 || sourceUuid === targetUuid ||
        typeof sourceItem !== 'string' || !sourceItem || !(targetItem === null || typeof targetItem === 'string' && targetItem))
        throw Error('Déplacement d’objet invalide.');
    const source = team?.find(p => p.uuid === sourceUuid), target = team?.find(p => p.uuid === targetUuid);
    if (!source || !target || source.isEgg || target.isEgg) throw Error('Choisis deux Pokémon de ton équipe.');
    if ((source.heldItem || null) !== sourceItem || (target.heldItem || null) !== targetItem)
        throw Error('Les objets ont changé. Réessaie avec l’équipe actualisée.');
    if (getItemDefinition(sourceItem)?.category !== 'held' || targetItem && getItemDefinition(targetItem)?.category !== 'held')
        throw Error('Objet tenu invalide.');
    if (sourceItem === targetItem) throw Error('Ces Pokémon tiennent déjà le même objet.');
    return [{ pokemonUuid: sourceUuid, heldItem: targetItem }, { pokemonUuid: targetUuid, heldItem: sourceItem }];
}

module.exports = { planHeldItemTransfer };

const { orderedParty } = require('../battle/partyOrder');
// The chosen first party slot, not the temporarily active fighter after a switch.
function hasEquippedExpShare(pokemons = []) {
    return orderedParty(pokemons)[0]?.heldItem === 'exp_share';
}
module.exports = {hasEquippedExpShare};

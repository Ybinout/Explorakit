const content = require('./content');
// Only the requesting seat's picked Pokémon are used. Legality comes from the
// same complete learnset catalogue as preparation, never from a client flag.
function forMove(move, picked) {
    return picked.map(({ cardId, pokemon: p }) => ({
        cardId,
        pokemonId: p.data.id,
        name: p.truename || p.data.name.french,
        compatible: content.legalMoves(p.data.id).includes(move),
        known: p.abilities.includes(move),
    }));
}
function decorate(card, picked) {
    const view = content.view(card);
    if (card.kind === 'move') view.compatibility = forMove(card.move, picked);
    return view;
}
module.exports = { forMove, decorate };

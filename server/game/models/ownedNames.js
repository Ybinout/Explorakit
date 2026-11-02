// Shared validation for owned Pokémon and private PC labels. Empty restores the default.
const MAX_NAME_LENGTH = 24;
function normalizeName(value) {
    if (typeof value !== 'string' || value.length > 256 || /[\p{Cc}\p{Cf}]/u.test(value)) throw Error('Nom invalide.');
    const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if ([...name].length > MAX_NAME_LENGTH) throw Error(`Le nom doit contenir au maximum ${MAX_NAME_LENGTH} caractères.`);
    if (name && !/^[\p{L}\p{M}\p{N} .’'!?()\-]+$/u.test(name)) throw Error('Utilise des lettres, chiffres et une ponctuation simple.');
    return name;
}
function renamedPokemon(pokemon, payload) {
    if (!pokemon || pokemon.uuid !== payload?.pokemonUuid) throw Error('Ce Pokémon ne t’appartient pas.');
    if (pokemon.isEgg) throw Error('Attends l’éclosion pour lui donner un surnom.');
    if (payload.expectedName !== pokemon.name) throw Error('Son nom a changé. Rouvre sa fiche avant de réessayer.');
    return normalizeName(payload.name) || pokemon.truename;
}
module.exports = {MAX_NAME_LENGTH, normalizeName, renamedPokemon};

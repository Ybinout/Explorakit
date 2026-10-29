const { growthSnapshot, levelGrowth } = require('../models/levelGrowth');
const MAX_LEVEL = 100;
function result(pokemon) {
    if (!pokemon || pokemon.isEgg || pokemon.currentHp <= 0) throw Error('Choisis un Pokémon conscient.');
    if (!Number.isInteger(pokemon.level) || pokemon.level >= MAX_LEVEL) throw Error('Le Super Bonbon ne peut plus augmenter ce niveau.');
    if (pokemon.evolutionState?.pending) throw Error('Termine d’abord l’évolution proposée.');
    const nextExperience = pokemon.getNextLevelExpForLevel(pokemon.level + 1);
    const gain = nextExperience - pokemon.experience;
    if (!Number.isSafeInteger(nextExperience) || !(gain > 0)) throw Error('La progression de ce Pokémon doit être resynchronisée.');
    // Level-up queues mutate their arrays; keep the owned instance untouched
    // until inventory consumption and persistence have succeeded together.
    const copy = Object.assign(Object.create(Object.getPrototypeOf(pokemon)), pokemon, {
        abilities: [...pokemon.abilities], movePp: [...pokemon.movePp],
        pendingMoves: structuredClone(pokemon.pendingMoves || []),
        evolutionState: structuredClone(pokemon.evolutionState || null)
    });
    const before = growthSnapshot(pokemon);
    copy.gainExperience(gain, { deferEvolution: true });
    if (copy.level !== pokemon.level + 1) throw Error('Progression de niveau invalide.');
    const fields = ['level','experience','currentHp','maxHp','status','attack','defense','specialAttack','specialDefense','speed',
        'currentAttack','currentDefense','currentSpecialAttack','currentSpecialDefense','currentSpeed','movePp','pendingMoves','evolutionState'];
    return { ...Object.fromEntries(fields.map(key => [key, copy[key]])),
        trainingChange: { kind:'level', before:pokemon.level, after:copy.level, growth:levelGrowth(copy,before) } };
}
module.exports = { result, MAX_LEVEL };

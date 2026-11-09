// Training is server-authored and uses the same raid simulator and checkpoints.
const MAP = 'ville5_maison1';
const catalog = Object.freeze(
    require('../draft/content').species.map((p) => ({
        id: p.id,
        name: p.name.french,
        types: p.type,
    }))
);
function config(rift) {
    if (!rift?.training) return null;
    return {
        id: 'training',
        name: 'Entraînement',
        level: rift.level,
        hp: 6,
        reward: 0,
        pearl: 0,
        plateChance: 0,
        scale: 1,
    };
}
function validate(bossId, level) {
    if (!Number.isInteger(bossId) || !catalog.some((p) => p.id === bossId))
        throw Error('Choisis un boss de la liste.');
    if (!Number.isInteger(level) || level < 100 || level > 1000)
        throw Error('Choisis un niveau entier entre 100 et 1 000.');
}
module.exports = { MAP, catalog, config, validate };

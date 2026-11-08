const config = require('../../../data/game/draft_mode.json');
const typeNames = {
    Normal: 'Normal',
    Fire: 'Feu',
    Water: 'Eau',
    Grass: 'Plante',
    Electric: 'Électrik',
    Ice: 'Glace',
    Fighting: 'Combat',
    Poison: 'Poison',
    Ground: 'Sol',
    Flying: 'Vol',
    Psychic: 'Psy',
    Bug: 'Insecte',
    Rock: 'Roche',
    Ghost: 'Spectre',
    Dragon: 'Dragon',
    Dark: 'Ténèbres',
    Steel: 'Acier',
    Fairy: 'Fée',
};
const stats = {
    speed: 'Vitesse',
    attack: 'Attaque',
    defense: 'Défense',
    specialAttack: 'Attaque Spéciale',
    specialDefense: 'Défense Spéciale',
};
function cost(c) {
    if (c.stats) {
        const [k, v] = Object.entries(c.stats)[0];
        return `−${Math.round((1 - v) * 100)} % ${stats[k]}`;
    }
    if (c.incomingClass) return '+10 % dégâts physiques subis';
    return (
        '+10 % dégâts ' + typeNames[Object.keys(c.incomingType)[0]] + ' subis'
    );
}
const list = [
    ...Object.entries(config.elementalCosts).map(([type, c]) => ({
        key: 'element-' + type,
        name: 'Rift ' + typeNames[type],
        type,
        bonus: `+${Math.round((config.elementalBonus - 1) * 100)} % dégâts ${
            typeNames[type]
        }`,
        penalty: cost(c),
        outgoingType: { [type]: config.elementalBonus },
        ...c,
    })),
    ...config.generalRifts,
];
const byKey = new Map(list.map((r) => [r.key, Object.freeze(r)]));
function get(key) {
    return byKey.get(typeof key === 'object' ? key?.key : key) || null;
}
function stat(owner, key) {
    return get(owner?.draftRift)?.stats?.[key] || 1;
}
function multiplier(a, d, move) {
    const c = move?.combat?.damage_class;
    if (!['physical', 'special'].includes(c)) return 1;
    const x = get(a?.draftRift),
        y = get(d?.draftRift);
    return (
        (x?.outgoing || 1) *
        (x?.outgoingType?.[move.type] || 1) *
        (y?.incoming || 1) *
        (y?.incomingType?.[move.type] || 1) *
        (y?.incomingClass?.[c] || 1)
    );
}
module.exports = { list, get, stat, multiplier, typeNames };

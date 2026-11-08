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
function equipped(owner) {
    const keys = Array.isArray(owner?.draftRifts)
        ? owner.draftRifts
        : owner?.draftRift
        ? [owner.draftRift]
        : [];
    return keys.slice(0, config.maximumTeamRifts).map(get).filter(Boolean);
}
function stat(owner, key) {
    return equipped(owner).reduce((n, r) => n * (r.stats?.[key] || 1), 1);
}
function multiplier(a, d, move) {
    const c = move?.combat?.damage_class;
    if (!['physical', 'special'].includes(c)) return 1;
    return (
        equipped(a).reduce(
            (n, r) =>
                n * (r.outgoing || 1) * (r.outgoingType?.[move.type] || 1),
            1
        ) *
        equipped(d).reduce(
            (n, r) =>
                n *
                (r.incoming || 1) *
                (r.incomingType?.[move.type] || 1) *
                (r.incomingClass?.[c] || 1),
            1
        )
    );
}

module.exports = { list, get, equipped, stat, multiplier, typeNames };

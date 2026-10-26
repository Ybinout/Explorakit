const { abilities } = require('../../../data/game/ability_rules.gen7.json');
function abilityFlag(name, flag) { return Boolean(abilities[name]?.[flag]); }
const UNCHANGEABLE = new Set(Object.keys(abilities).filter(name => abilityFlag(name, 'cantsuppress')));
module.exports = { abilityFlag, UNCHANGEABLE };

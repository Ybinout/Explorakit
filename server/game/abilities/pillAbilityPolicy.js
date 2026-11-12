// Acquisition balance only: native abilities and existing modules remain valid.
const excluded = new Set(['Huge Power', 'Wonder Guard', 'No Guard']);
function isPillAbilityAllowed(name) { return !excluded.has(name); }
function isCorruptionPillAbilityAllowed(name) { return isPillAbilityAllowed(name) && name !== 'Pure Power'; }
module.exports = { isPillAbilityAllowed, isCorruptionPillAbilityAllowed };

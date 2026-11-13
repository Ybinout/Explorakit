// Raid-only rewards and participant accounting. Native stat rules are unchanged.
const talents = require('../talents/effects');
function money(amount, level, owner) {
  const previous = talents.money(amount, 'raid', owner);
  return Number(level) >= 300 ? Math.floor(previous * .8) : previous;
}
function participantCount(models) {
  return new Set(models.map(m => Number(m.ownerId)).filter(id => Number.isSafeInteger(id) && id > 0)).size;
}
module.exports = {money, participantCount};

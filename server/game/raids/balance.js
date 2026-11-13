// Raid-only rules: ordinary battles and permanent statistics stay untouched.
const {Pokemon, toID} = require('@pkmn/sim');
const talents = require('../talents/effects');
const isBoss = p => p.side.n === 1;
const negativeMultiplier = stage => (4 - Math.max(-6, stage)) / (4 - 2 * Math.max(-6, stage));

// Keep native integer stages for Haze, Contrary, critical hits and Unaware.
// Only their negative numerical effect is halved for the boss.
function calculateStat(statName, boost, modifier, statUser) {
  if (!isBoss(this)) return Pokemon.prototype.calculateStat.call(this, statName, boost, modifier, statUser);
  statName = toID(statName);
  if (statName === 'hp') throw Error('Please read `maxhp` directly');
  let key = statName;
  if (this.battle.field.pseudoWeather.wonderroom) key = ({def:'spd', spd:'def'})[key] || key;
  const stages = this.battle.runEvent('ModifyBoost', statUser || this, null, null, {[statName]:boost});
  const stage = Math.max(-6, Math.min(6, stages[statName]));
  const factor = stage < 0 ? negativeMultiplier(stage) : 1 + stage / 2;
  return this.battle.modify(Math.floor(this.storedStats[key] * factor), modifier || 1);
}
function getStat(statName, unboosted, unmodified) {
  if (!isBoss(this)) return Pokemon.prototype.getStat.call(this, statName, unboosted, unmodified);
  statName = toID(statName);
  if (statName === 'hp') throw Error('Please read `maxhp` directly');
  let stat = this.storedStats[statName];
  if (unmodified && this.battle.field.pseudoWeather.wonderroom) statName = ({def:'spd',spd:'def'})[statName] || statName;
  if (!unboosted) {
    const boosts = unmodified ? this.boosts : this.battle.runEvent('ModifyBoost', this, null, null, {...this.boosts});
    const stage = Math.max(-6, Math.min(6, boosts[statName]));
    stat = Math.floor(stat * (stage < 0 ? negativeMultiplier(stage) : 1 + stage / 2));
  }
  if (!unmodified) stat = this.battle.runEvent('Modify' + ({atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'})[statName], this, null, null, stat);
  if (statName === 'spe' && stat > 10000 && !this.battle.format.battle?.trunc) stat = 10000;
  return stat;
}
// Accuracy has its own 3-based stage formula. Interpolate only the negative
// contribution of the boss, preserving other accuracy hooks and immunities.
function accuracy(value, target, source, move) {
  if (value === true || move.ohko || !target || !source) return value;
  if (!(isBoss(source) && source.boosts.accuracy < 0 && !move.ignoreAccuracy || isBoss(target) && target.boosts.evasion < 0 && !move.ignoreEvasion)) return value;
  const a = move.ignoreAccuracy ? 0 : this.runEvent('ModifyBoost', source, null, null, {...source.boosts}).accuracy;
  const e = move.ignoreEvasion ? 0 : this.runEvent('ModifyBoost', target, null, null, {...target.boosts}).evasion;
  if (!(isBoss(source) && a < 0 || isBoss(target) && e < 0)) return value;
  const ratio = n => n < 0 ? 3 / (3 - n) : (3 + n) / 3;
  const multiplier = (atk, evade) => move.multiaccuracy && move.hit > 1 ? ratio(atk) / ratio(evade) : ratio(Math.max(-6, Math.min(6, atk - evade)));
  const normal = multiplier(a,e), base = multiplier(isBoss(source) && a < 0 ? 0 : a, isBoss(target) && e < 0 ? 0 : e);
  return value * ((normal + base) / 2) / normal;
}
function money(amount, level, owner) {
  const previous = talents.money(amount, 'raid', owner);
  return Number(level) >= 300 ? Math.floor(previous * .8) : previous;
}
function participantCount(models) {
  return new Set(models.map(m => Number(m.ownerId)).filter(id => Number.isSafeInteger(id) && id > 0)).size;
}
module.exports = {calculateStat, getStat, accuracy, money, participantCount};

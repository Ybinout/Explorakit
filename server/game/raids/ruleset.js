// Raid-only format built on RiftMon's native multiplayer simulator.
// No patch to the Single or Doubles formats, move data or damage formulas.
const {
  Battle,
  Dex,
  Pokemon,
  toID
} = require('@pkmn/sim');
const doubles = require('../doubles/ruleset');
const own = p => p?.side?.n === 0;
const raidDex = Dex.mod('riftmonraid', {
  Scripts: {
    inherit: 'riftmondoubles',
    pokemon: {
      damage(amount, source, effect) {
        const actual = Pokemon.prototype.damage.call(this, amount, source, effect);
        if (actual > 0 && this.battle.raid && this.side.n === 1) {
          if (own(source)) { source.m.aggro = Math.min(100, (source.m.aggro || 0) + actual / this.maxhp * 400); event(this.battle,'aggro',source,{value:Math.round(source.m.aggro)}); }
          shield(this.battle, this, true);
        }
        return actual;
      },
      isAdjacent(p) {
        return !!p && p !== this && this.isActive && p.isActive;
      },
      takeItem(source) {
        const owner = this.m.raidItemOwner,
          item = Pokemon.prototype.takeItem.call(this, source);
        return item ? {
          ...item,
          raidOwner: owner
        } : item;
      },
      setItem(item, source, effect) {
        const owner = typeof item === 'object' ? item.raidOwner : null;
        const ok = Pokemon.prototype.setItem.call(this, item, source, effect);
        if (ok) this.m.raidItemOwner = owner || this.set.rift.uuid;
        return ok;
      }
    }
  },
  Moves: {
    wish: {
      inherit: true,
      slotCondition: undefined,
      onHit(target, source) {
        this.raid.wishes.push({
          due: this.turn + 1,
          amount: Math.floor(source.baseMaxhp / 2),
          sourceSlot: source.position
        });
        this.add('-start', source, 'move: Wish');
      }
    }
  }
});
function living(sim) {
  return sim.sides[0].active.filter(p => p?.hp > 0 && !p.m.retired);
}
function focus(sim) {
  const list = living(sim);
  return list.sort((a, b) => (b.m.aggro || 0) - (a.m.aggro || 0) || a.position - b.position)[0];
}
function target(sim) {
  const list = living(sim);
  if (!list.length) return 1;
  const forced = list.find(p => p.volatiles.followme || p.volatiles.ragepowder);
  if (forced) return forced.position + 1;
  if (sim.raid.reactive) return focus(sim).position + 1;
  const total = list.reduce((s, p) => s + Math.pow(10 + (p.m.aggro || 0), 2), 0);
  let roll = sim.random(1000000) / 1000000 * total;
  return (list.find(p => (roll -= Math.pow(10 + (p.m.aggro || 0), 2)) < 0) || list[0]).position + 1;
}
function event(sim, kind, p, extra = {}) {
  sim.raid.events.push({
    kind,
    slot: own(p) ? p.position : 4,
    at: sim.log.length,
    ...(kind==='aggro' && sim.raid.reactive ? {focus:target(sim)-1} : {}),
    ...extra
  });
}
function shield(sim, boss, afterDamage = false) {
  if (boss.hp <= 0) return;
  const r = sim.raid;
  if (r.shield?.hp > 0 || r.vulnerableUntil >= sim.turn) return;
  const threshold = [.7, .3][r.shieldsUsed];
  if (threshold === undefined || boss.hp > Math.ceil(boss.maxhp * threshold)) return;
  r.shieldsUsed++;
  const hp = Math.ceil(boss.maxhp * .14);
  r.shield = {
    hp,
    max: hp
  };
  event(sim, 'shield', boss, {
    phase: r.shieldsUsed, hp, max: hp,
    ...(afterDamage ? {
      at: sim.log.length + 3
    } : {})
  });
}
const format = {
  ...doubles.format,
  id: 'riftmonraid',
  name: 'RiftMon Raid',
  mod: 'riftmonraid',
  gameType: 'doubles',
  onBegin() {
    doubles.format.onBegin.call(this);
    this.activePerHalf = 4;
    this.speedOrder = [0, 1, 2, 3, 4, 5, 6, 7];
    this.sides[0].active = [null, null, null, null];
    this.sides[0].slotConditions = [{}, {}, {}, {}];
    this.sides[1].active = [null];
    this.sides[1].slotConditions = [{}];
    this.raid = {
      events: [],
      wishes: [],
      shieldsUsed: 0,
      shield: null,
      vulnerableUntil: 0,
      acted: [],
      extraMove: null,
      consumedOwners: []
    };
    for (const side of this.sides) for (const p of side.pokemon) p.m.raidItemOwner = p.set.rift.uuid;
  },
  onBattleStart() {
    const p = this.sides[1].pokemon[0],
      mult = p.set.rift.raidHp || 1;
    p.baseMaxhp = p.maxhp = Math.ceil(p.maxhp * mult);
    p.hp = p.maxhp;
  },
  onDamagePriority: 100,
  onDamage(damage, p, source, effect) {
    if (!this.raid) return;
    if (own(p)) {
      if (p.m.friendGuard) return 0;
      if (source?.side.n === 1 && effect?.effectType === 'Move' && damage >= p.hp && p.hp === p.maxhp && !p.m.friendUsed) {
        p.m.friendUsed = true;
        p.m.friendGuard = this.turn;
        event(this, 'friendship', p);
        return Math.max(0, p.hp - 1);
      }
      return;
    }
    const r = this.raid;
    // An eligible shield must exist before the hit, including old snapshots
    // already sitting below a threshold. Never clamp HP during vulnerability.
    shield(this, p);
    if (r.shield?.hp > 0 && source !== p) {
      const before = r.shield.hp;
      r.shield.hp = Math.max(0, r.shield.hp - damage);
      event(this, 'shieldHit', p, {
        amount: Math.min(before, damage), hp: r.shield.hp, max: r.shield.max
      });
      if (!r.shield.hp) {
        r.vulnerableUntil = this.turn + 2;
        event(this, 'shieldBreak', p, { hp: 0, max: r.shield.max });
      }
      return Math.max(1, Math.floor(damage * .25));
    }
    const threshold = [.7, .3][r.shieldsUsed];
    if (r.vulnerableUntil < this.turn && threshold !== undefined && p.hp >= Math.ceil(p.maxhp * threshold) && damage >= p.hp - Math.ceil(p.maxhp * threshold)) return p.hp - Math.ceil(p.maxhp * threshold);
  },
  onHeal(damage, p, source) {
    if (own(p) && damage > 0) {
      const healer = own(source) ? source : p;
      healer.m.aggro = Math.min(100, (healer.m.aggro || 0) + damage / p.maxhp * 10);
      event(this,'aggro',healer,{value:Math.round(healer.m.aggro)});
    }
  },
  onAfterUseItem(item, p) {
    const owner = p.m.raidItemOwner;
    if (owner && !this.raid.consumedOwners.includes(owner)) this.raid.consumedOwners.push(owner);
  },
  onAfterMove(p, target, move) {
    if (own(p) && p.moveThisTurnResult === true) {
      if (['followme', 'ragepowder'].includes(move.id)) p.m.aggro = 100;else if (move.id === 'taunt') p.m.aggro = Math.min(100, (p.m.aggro || 0) + 40);
      if(['followme','ragepowder','taunt'].includes(move.id))event(this,'aggro',p,{value:Math.round(p.m.aggro)});
    }
  },
  onResidualOrder: 100,
  onResidual(p) {
    doubles.format.onResidual.call(this, p);
    if (p.side.n === 1) {
      shield(this, p);
      if (this.raid.vulnerableUntil === this.turn) event(this, 'vulnerabilityEnd', p);
    }
  },
  battle: {
    turnLoop() {
      if (!this.raid?.reactive) return Battle.prototype.turnLoop.call(this);
      return require('./initiative').turnLoop(this);
    },
    validTargetLoc(loc, source, kind) {
      if (!loc) return true;
      const side = loc < 0 ? source.side : source.side.foe,
        p = side.active[Math.abs(loc) - 1];
      if (!p?.hp || p.m.retired) return false;
      const self = p === source,
        ally = p.side === source.side;
      if (kind === 'normal') return !self;
      if (['randomNormal', 'adjacentFoe'].includes(kind)) return !ally;
      if (kind === 'adjacentAlly') return ally && !self;
      if (kind === 'adjacentAllyOrSelf') return ally;
      if (kind === 'any') return !self;
      return false;
    },
    commitChoices() {
      const boss = this.sides[1].pokemon[0];
      if (this.requestState === 'move' && this.raid.extraMove && boss.hp) {
        const m = this.dex.moves.get(this.raid.extraMove);
        this.sides[1].choice.actions.push({
          choice: 'move',
          pokemon: boss,
          move: m,
          targetLoc: target(this),
          raidSecond: true
        });
      }
      return Battle.prototype.commitChoices.call(this);
    },
    runAction(action) {
      if (action.choice === 'beforeTurn') {
        this.raid.acted = [];
      }
      if (action.choice === 'move') {
        const p = action.pokemon;
        if (p.m.retired) return false;
        if (own(p)) {
          if (this.raid.acted.includes(p.position)) return false;
          this.raid.acted.push(p.position);
          if (action.raidPass !== undefined) {
            const index = this.queue.list.findIndex(a => a.choice === 'move' && own(a.pokemon) && a.pokemon.position === action.raidPass && !this.raid.acted.includes(a.pokemon.position));
            if (index >= 0) {
              const [ally] = this.queue.list.splice(index, 1);
              this.queue.list.unshift(ally);
              event(this, 'pass', p, {
                target: action.raidPass
              });
            } else event(this, 'passFailed', p, {
              target: action.raidPass
            });
            return false;
          }
          for (const wish of this.raid.wishes.filter(w => w.due <= this.turn)) if (this.heal(wish.amount, p, this.sides[0].active[wish.sourceSlot] || p, this.dex.moves.get('wish'))) this.add('-heal', p, p.getHealth, '[from] move: Wish');
          this.raid.wishes = this.raid.wishes.filter(w => w.due > this.turn);
        } else if (!['allAdjacent', 'allAdjacentFoes', 'all'].includes(this.dex.moves.get(action.move).target)) action.targetLoc = target(this);
      }
      return Battle.prototype.runAction.call(this, action);
    }
  }
};
raidDex.formats.extend([format]);
// Native checkpoints reconstruct through the global format registry.
Dex.formats.extend([format]);
function create(teams, seed) {
  const sim = new Battle({
    format: raidDex.formats.get('riftmonraid'),
    seed
  }, raidDex);
  doubles.installStats(sim);
  sim.setPlayer('p1', {
    name: 'Alliés',
    team: teams[0]
  });
  sim.setPlayer('p2', {
    name: 'Corruption',
    team: teams[1]
  });
  return sim;
}
function restore(state) {
  const sim = Battle.fromJSON(state);
  doubles.format.onBegin.call(sim);
  doubles.installStats(sim);
  return sim;
}
module.exports = {
  dex: raidDex,
  format,
  create,
  restore,
  teamSet: doubles.teamSet,
  focus,
  target,
  living,
  toID
};

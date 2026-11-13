// Raid-only format built on RiftMon's native multiplayer simulator.
// Single/Doubles and native move/item/ability definitions stay unchanged.
// Boss rage is a raid-only damage modifier.
const {
  Battle,
  Dex,
  Pokemon,
  toID
} = require('@pkmn/sim');
const doubles = require('../doubles/ruleset');
const cooperation = require('./cooperation');
const prevention = require('./prevention');
const pressure = require('./pressure');
const report = require('./report');
const balance = require('./balance');
const own = p => p?.side?.n === 0;
const reusableBerries=new Set(require('../../../data/game/items.json').items.filter(i=>i.category==='held'&&i.key.endsWith('_berry')&&!i.mutationBerry).map(i=>toID(i.key)));
// This scope is deliberately not serialized into isolated damage projections.
const resolvingBossActions = new WeakSet();
const raidDex = Dex.mod('riftmonraid', {
  Scripts: {
    inherit: 'riftmondoubles',
    pokemon: {
      calculateStat: balance.calculateStat,
      getStat: balance.getStat,
      damage(amount, source, effect) {
        const before=this.hp;
        const actual = Pokemon.prototype.damage.call(this, amount, source, effect);
        report.damage(this.battle,this,source,effect,actual);
        prevention.connected(this.battle,this,source,effect,before,actual,gainAggro);
        pressure.relief(this.battle,this,source,effect,actual,event);
        if(this.battle.raid&&own(this)&&before>0&&this.hp<=0)event(this.battle,'aggro',this,{gain:0,reason:'knockout',at:this.battle.log.length+3});
        if (actual > 0 && this.battle.raid && this.side.n === 1) {
          if (own(source)) gainAggro(this.battle,source,cooperation.equivalentDamage(this.battle,actual),'damage');
          pressure.received(this.battle,this,actual,event);
          shield(this.battle, this, true);
        }
        return actual;
      },
      heal(amount, source, effect) {
        const actual = Pokemon.prototype.heal.call(this,amount,source,effect);
        report.heal(this.battle,this,source,effect,actual);
        return actual;
      },
      sethp(amount) {
        const before = this.hp, result = Pokemon.prototype.sethp.call(this,amount);
        if (this.battle.activeMove?.id === 'painsplit') {
          const source = this.battle.activePokemon, effect = this.battle.activeMove;
          report.damage(this.battle,this,source,effect,before-this.hp);
          report.heal(this.battle,this,source,effect,this.hp-before);
        }
        return result;
      },
      isAdjacent(p) {
        return p !== this && cooperation.active(this) && cooperation.active(p);
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
    endeavor: {
      inherit:true,
      onTryHit(target,source){
        if(target.side.n===1){this.add('-immune',target);return null;}
        return doubles.dex.moves.get('endeavor').onTryHit?.call(this,target,source);
      }
    },
    ...prevention.guards(doubles.dex,gainAggro),
    helpinghand: {
      inherit:true,
      onTryHit(target,source){return cooperation.active(target)&&target!==source&&target.side===source.side;},
      condition:{
        ...doubles.dex.moves.get('helpinghand').condition,
        duration:undefined,
        onStart(target,source){this.effectState.multiplier=1.5;this.effectState.raidHelpers=[source.set.rift.uuid];this.add('-singleturn',target,'Helping Hand',`[of] ${source}`);},
        onRestart(target,source){const id=source.set.rift.uuid;this.effectState.raidHelpers||=[];if(this.effectState.raidHelpers.includes(id))return false;this.effectState.raidHelpers.push(id);this.effectState.multiplier*=1.5;this.add('-singleturn',target,'Helping Hand',`[of] ${source}`);},
        onAfterMove(p,target,move){if(move.category!=='Status')p.removeVolatile('helpinghand');}
      }
    },
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
  const boss = sim.p2.active[0];
  const ignoresRedirection = boss.hasAbility(['stalwart', 'propellertail']);
  const ignoresPowder = boss.hasType('Grass') || boss.hasAbility('overcoat') || boss.hasItem('safetygoggles');
  const forced = !ignoresRedirection && list.find(p => p.volatiles.followme || p.volatiles.ragepowder && !ignoresPowder);
  if (forced) return forced.position + 1;
  return focus(sim).position + 1;
}
function event(sim, kind, p, extra = {}) {
  sim.raid.events.push({
    kind,
    slot: own(p) ? p.position : 4,
    at: sim.log.length,
    ...(kind==='aggro' && sim.raid.reactive ? {focus:target(sim)-1} : {}),
    ...extra,
    ...(kind==='aggro'?(()=>{const shares=require('./threat').shares(sim);return {shares,value:shares[own(p)?p.position:4]||0};})():{})
  });
}
function gainAggro(sim,p,amount,reason) {
  if(!(amount>0)||sim.raid.threatProjection)return;
  const before=p.m.aggro||0;
  p.m.aggro=before+amount;
  if(p.m.aggro>before)event(sim,'aggro',p,{value:Math.round(p.m.aggro),gain:p.m.aggro-before,reason});
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
    this.raid.participantCount = balance.participantCount(this.sides[0].pokemon.map(p => ({ownerId:p.set.rift.ownerId})));
    report.initialize(this);
    for (const side of this.sides) for (const p of side.pokemon) p.m.raidItemOwner = p.set.rift.uuid;
    for (const p of this.sides[0].pokemon) {
      const initial = p.set.rift.entryStatus;
      if (!initial) continue;
      // This condition predates the raid: no new immunity or Synchronize roll.
      p.status = initial.id;
      p.statusState = this.initEffectState({id: initial.id, target: p});
      if (initial.id === 'slp') p.statusState.startTime = p.statusState.time = initial.sleepTurns ?? this.random(2, 5);
      if (initial.id === 'tox') p.statusState.stage = 0;
    }
  },
  onBattleStart() {
    const p = this.sides[1].pokemon[0],
      mult = p.set.rift.raidHp || 1;
    p.baseMaxhp = p.maxhp = Math.ceil(Math.ceil(p.maxhp * mult) * 115 / 100);
    p.hp = p.maxhp;
  },
  onDamagePriority: 100,
  onDamage(damage, p, source, effect) {
    if (!this.raid) return;
    if (own(p)) {
      return;
    }
    const r = this.raid;
    // Poison status residuals only: direct Poison-type attacks retain their damage.
    const poisonResidual = effect?.effectType === 'Status' && ['psn', 'tox'].includes(effect.id);
    if (poisonResidual) {
      damage = Math.max(1, Math.floor(damage * 0.3));
    }
    // An eligible shield must exist before the hit, including old snapshots
    // already sitting below a threshold. Never clamp HP during vulnerability.
    shield(this, p);
    if (r.shield?.hp > 0 && source !== p) {
      const before = r.shield.hp;
      r.shield.hp = Math.max(0, r.shield.hp - damage);
      report.damage(this,p,source,effect,Math.min(before,damage),'shield');
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
    if (poisonResidual) return damage;
  },
  onHeal(amount, p, source, effect) {
    if (own(p) && own(source) && amount > 0) {
      const active=this.activeMove,move=active&&(effect?.id===active.id||effect?.id==='drain')?active:null,cap=cooperation.config.aggro.healingPerMoveCap;
      const value=Math.min(cooperation.healingAggro(amount,p),cap-(move?.raidHealingUsed||0));
      if(move)move.raidHealingUsed=(move.raidHealingUsed||0)+Math.max(0,value);
      gainAggro(this,source,value,'heal');
    }
  },
  onDisableMove(p) {
    cooperation.disableUnavailable(this,p);
  },
  onModifyDamage(damage,source,target,move) {
    doubles.format.onModifyDamage.call(this,damage,source,target,move,'raid');
    // Native Gen 7 already halves burned physical damage. Raid-only ×1.5
    // leaves a 25% penalty; Guts and Facade retain their native exemptions.
    if(source?.status==='brn'&&move.category==='Physical'&&move.id!=='facade'&&!source.hasAbility('guts'))this.chainModify(1.5);
    if(source?.side.n===1&&own(target))this.chainModify(pressure.multiplier(this));
    if(own(source)&&target?.side.n===1&&this.raid.participantCount>=2)this.chainModify(1.2);
  },
  onAccuracy: balance.accuracy,
  onModifyMove(move, source) {
    if(move.category!=='Status' && move.selfSwitch)delete move.selfSwitch;
    // Random-target moves still obey raid threat and normal redirection rules.
    // Allies and every non-raid format retain the original move definition.
    if(resolvingBossActions.has(this) && source?.side.n===1 && move.target==='randomNormal')move.target='normal';
  },
  onTryMove(source, target, move) {
    if(source.side.n===1 && move.id==='struggle')return false;
    const reason=cooperation.unavailable(move);
    if(reason){this.add('-fail',source);this.add('-message',reason);return false;}
  },
  onAfterUseItem(item, p) {
    if(reusableBerries.has(item.id))return;
    const owner = p.m.raidItemOwner;
    if (owner && !this.raid.consumedOwners.includes(owner)) this.raid.consumedOwners.push(owner);
  },
  onAfterMove(p, target, move) {
    if (own(p) && p.moveThisTurnResult === true) {
      if (['followme','ragepowder'].includes(move.id)) gainAggro(this,p,cooperation.config.aggro.maximum,'redirection');
      else gainAggro(this,p,cooperation.supportAggro(move),'support');
    }
  },
  onResidualOrder: 100,
  onResidual(p) {
    doubles.format.onResidual.call(this, p);
    if (p.side.n === 1) {
      pressure.endCycle(this,event);
      shield(this, p);
      if (this.raid.vulnerableUntil === this.turn) event(this, 'vulnerabilityEnd', p);
    }
  },
  battle: {
    chainModify:prevention.chainModify,
    modify:prevention.modify,
    getRandomTarget(pokemon, move) {
      const definition = this.dex.moves.get(move);
      // The native simulator may resolve a target again after ModifyMove, or
      // when a called/locked move replaces the selected one. Keep actual queued
      // casts on threat, but leave explicit test/projection targets untouched.
      if (resolvingBossActions.has(this) && pokemon.side.n === 1 && ['normal','any','randomNormal','adjacentFoe'].includes(definition.target)) {
        return this.p1.active[target(this) - 1];
      }
      return Battle.prototype.getRandomTarget.call(this, pokemon, move);
    },
    turnLoop() {
      if (!this.raid?.reactive) return Battle.prototype.turnLoop.call(this);
      return require('./initiative').turnLoop(this);
    },
    validTargetLoc(loc, source, kind) {return cooperation.validTarget(this,loc,source,kind);},
    canSwitch() {return 0;}, // All four participants are already on the field.
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
        this.raid.acted = [];this.raid.spentTokens=[];this.raid.actionsUsed=Array(4).fill(0);
      }
      if (action.choice === 'move') {
        const p = action.pokemon;
        // Bosses never fall back to Struggle. Normal ally PP are untouched.
        if(p.side.n===1){
          if(this.dex.moves.get(action.move).id==='struggle')return false;
          for(const slot of p.moveSlots)slot.pp=slot.maxpp;
        }
        if (p.m.retired) return false;
        if (own(p)) {
          if(action.raidToken){
            this.raid.spentTokens||=[];if(this.raid.spentTokens.includes(action.raidToken.id))return false;
            this.raid.spentTokens.push(action.raidToken.id);this.raid.actionsUsed||=Array(4).fill(0);this.raid.actionsUsed[p.position]++;
          }else if (this.raid.acted.includes(p.position)) return false;
          if(!this.raid.acted.includes(p.position))this.raid.acted.push(p.position);
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
        } else if (['normal','any','randomNormal','adjacentFoe'].includes(this.dex.moves.get(action.move).target)) {
          action.targetLoc = target(this);
          action.originalTarget = this.p1.active[action.targetLoc - 1];
        }
      }
      if (action.choice === 'move' && action.pokemon.side.n === 1 && !resolvingBossActions.has(this)) {
        resolvingBossActions.add(this);
        try { return Battle.prototype.runAction.call(this, action); }
        finally { resolvingBossActions.delete(this); }
      }
      return Battle.prototype.runAction.call(this, action);
    }
  }
};
format.actions={modifyDamage:prevention.modifyDamage};
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
  const sim = require('../doubles/checkpoint').restore(state);
  doubles.format.onBegin.call(sim);
  doubles.installStats(sim);
  cooperation.restoreEffects(sim);
  report.initialize(sim,true);
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

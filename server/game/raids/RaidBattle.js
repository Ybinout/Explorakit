const {
    randomUUID
  } = require('node:crypto'),
  native = require('./ruleset'),
  codec = require('../drift/checkpointCodec');
const labels = require('../../../data/game/corruption_labels.fr.json');
const slotOf = value => {
  const m = /^p([12])([a-d]):/.exec(value || '');
  return m ? m[1] === '2' ? 4 : m[2].charCodeAt(0) - 97 : null;
};
const status = {
  brn: 'burn',
  psn: 'poison',
  tox: 'badly_poison',
  slp: 'sleep',
  frz: 'freeze',
  par: 'paralyze'
};
class RaidBattle {
  constructor(party, boss, {
    now = Date.now,
    hpMultiplier = 6,
    seed
  } = {}) {
    this.now = now;
    this.models = party.map(entry => ({
      ...entry,
      initialHeld: entry.pokemon.heldItem || null
    }));
    this.boss = boss;
    const sets = party.map(v => native.teamSet(v.pokemon)),
      foe = native.teamSet(boss);
    foe.rift.raidHp = hpMultiplier;
    this.sim = native.create([sets, [foe]], seed);
    this.cursor = this.sim.log.length;
    this.pending = {};
    this.token = randomUUID();
    this.playbackUntil = now() + 8000;
    this.deadline = this.playbackUntil + 30000;
    this.revision = 1;
    this.events = [];
    this.planBoss();
  }
  static restore(data, now = Date.now) {
    const b = Object.create(RaidBattle.prototype);
    Object.assign(b, data, {
      now,
      sim: native.restore(data.sim)
    });
    return b;
  }
  snapshot() {
    return {
      bossPlan: this.bossPlan,
      announcedAoe: this.announcedAoe,
      models: this.models,
      boss: this.boss,
      sim: this.sim.toJSON(),
      cursor: this.cursor,
      pending: this.pending,
      token: this.token,
      deadline: this.deadline,
      playbackUntil: this.playbackUntil,
      revision: this.revision,
      events: this.events
    };
  }
  get finished() {
    return this.sim.ended || !native.living(this.sim).length;
  }
  get won() {
    return this.sim.sides[1].pokemon[0].hp <= 0 && native.living(this.sim).length>0;
  }
  get bossPokemon() {
    return this.sim.sides[1].pokemon[0];
  }
  planBoss() {
    if (this.finished) return;
    const p = this.bossPokemon,
      moves = p.getMoveRequestData().moves.filter(m => !m.disabled && m.pp > 0),
      fallback = {
        id: 'struggle'
      },
      spread = moves.filter(m => ['allAdjacent', 'allAdjacentFoes'].includes(native.dex.moves.get(m.id).target)),
      single = moves.filter(m => !spread.includes(m));
    const pick = list => list.length ? list[this.sim.random(list.length)] : moves[0] || fallback;
    const even = this.sim.turn % 2 === 0;
    if (!even) this.announcedAoe = pick(spread).id;
    const area = spread.find(m => m.id === this.announcedAoe) || pick(spread);
    this.bossPlan = [pick(single).id, even ? area.id : pick(single).id];
    this.sim.raid.extraMove = this.bossPlan[1];
  }
  viewPokemon(p, slot) {
    if (!p) return null;
    const model = slot === 4 ? this.boss : this.models[slot]?.pokemon;
    return {
      uuid: model?.uuid,
      pokemonId: p.species.num,
      name: p.name,
      level: p.level,
      currentHp: p.hp,
      maxHp: p.maxhp,
      status: status[p.status] || 'normal',
      types: p.getTypes(),
      shiny: p.shiny,
      k: p.set.rift.k,
      gender: p.gender,
      corrupted: !!p.set.rift.corrupted,
      boosts: {
        ...p.boosts
      },
      effects: {
        shield: !!p.volatiles.protect,
        clone: !!p.volatiles.substitute
      },
      aggro: Math.round(p.m.aggro || 0),
      survivalKitUsed: !!model?.__darkSurvivalProtected,
      permanentlyLost: !!model?.__darkContinentDead,
      friendshipUsed: !!p.m.friendUsed,
      protected: !!p.m.friendGuard,
      withdrawn: !!p.m.retired,
      ownerId: this.models[slot]?.ownerId,
      ownerName: this.models[slot]?.ownerName
    };
  }
  moves(slot) {
    const p = this.sim.sides[0].active[slot];
    if (!p?.hp || p.m.retired) return [];
    return p.getMoveRequestData().moves.map((m, index) => {
      const move = native.dex.moves.get(m.id),
        targets = [];
      for (const side of this.sim.sides) for (const q of side.active) {
        const loc = side === p.side ? -(q.position + 1) : q.position + 1;
        if (this.sim.validTargetLoc(loc, p, move.target)) targets.push({
          slot: side.n === 1 ? 4 : q.position,
          loc
        });
      }
      return {
        ...m,
        disabled: !!m.disabled || ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(move.target) && !targets.length,
        index,
        name: labels.moves[move.name] || move.name,
        ename: move.name,
        type: move.type,
        category: move.category,
        power: move.basePower,
        targets,
        targetKind: move.target
      };
    });
  }
  view(userId) {
    const active = this.sim.sides[0].active,
      boss = this.bossPokemon,
      focus = native.focus(this.sim);
    return {
      token: this.token,
      revision: this.revision,
      turn: this.sim.turn,
      serverNow: this.now(),
      deadline: this.deadline,
      playbackUntil: this.playbackUntil,
      finished: this.finished,
      won: this.won,
      boss: this.viewPokemon(boss, 4),
      allies: active.map((p, i) => ({
        ...this.viewPokemon(p, i),
        ready: !!this.pending[i],
        canControl: this.models[i].ownerId === userId,
        moves: this.models[i].ownerId === userId ? this.moves(i) : []
      })),
      focus: focus?.position ?? null,
      wishes: this.sim.raid.wishes,
      shield: this.sim.raid.shield,
      shieldsUsed: this.sim.raid.shieldsUsed,
      weather: this.sim.field.weather || null,
      vulnerableTurns: Math.max(0, this.sim.raid.vulnerableUntil - this.sim.turn + 1),
      warning: {
        nextTurn: this.sim.turn % 2 !== 0,
        move: labels.moves[native.dex.moves.get(this.sim.turn % 2 ? this.announcedAoe : this.bossPlan?.[1]).name] || native.dex.moves.get(this.sim.turn % 2 ? this.announcedAoe : this.bossPlan?.[1]).name,
        targets: [0, 1, 2, 3]
      },
      order: this.order(),
      events: this.events
    };
  }
  order() {
    const priority = p => {
      const a = p.side.n === 0 ? this.pending[p.position] : null,
        move = p.side.n === 1 ? native.dex.moves.get(this.bossPlan?.[0]) : a?.action === 'attack' ? native.dex.moves.get(p.getMoveRequestData().moves[a.moveIndex]?.id) : null;
      return (move?.priority || 0) + (move?.category === 'Status' && p.hasAbility('prankster') ? 1 : 0);
    };
    return this.sim.getAllActive().filter(p => p.hp > 0).sort((a, b) => priority(b) - priority(a) || b.getActionSpeed() - a.getActionSpeed()).map(p => p.side.n === 1 ? 4 : p.position);
  }
  action(userId, data) {
    if (this.finished || data.token !== this.token || this.now() >= this.deadline) throw Error('Ce tour n’est plus disponible.');
    const slot = data.slot,
      p = this.sim.sides[0].active[slot];
    if (!p?.hp || p.m.retired || this.models[slot]?.ownerId !== userId || this.pending[slot]) throw Error('Tu ne contrôles pas cette action.');
    if (data.action === 'retreat') {
      if (data.confirm !== true) throw Error('Confirme le retrait définitif du raid.');
      this.pending[slot] = {
        action: 'retreat'
      };
    } else if (data.action === 'pass') {
      const target = this.sim.sides[0].active[data.target];
      if (!target?.hp || target === p || target.m.retired) throw Error('Choisis un allié qui n’a pas encore joué.');
      this.pending[slot] = {
        action: 'pass',
        target: data.target
      };
    } else if (data.action === 'attack') {
      const m = this.moves(slot).find(m => m.index === data.moveIndex);
      if (!m || m.disabled || m.pp <= 0 && m.id !== 'struggle') throw Error('Cette capacité est indisponible.');
      if (['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(m.targetKind) && !m.targets.some(t => t.loc === data.targetLoc)) throw Error('Cible invalide.');
      this.pending[slot] = {
        action: 'attack',
        moveIndex: m.index,
        targetLoc: ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(m.targetKind) ? data.targetLoc : undefined
      };
    } else throw Error('Action inconnue.');
    this.revision++;
    this.events = [];
    return this.ready() ? this.resolve() : false;
  }
  ready() {
    return this.sim.sides[0].active.every((p, i) => !p?.hp || p.m.retired || this.pending[i]);
  }
  retreat(slot, reason = 'retreat') {
    const p = this.sim.sides[0].active[slot];
    if (!p?.hp || p.m.retired) return;
    p.m.retired = {
      hp: p.hp,
      status: p.status,
      pp: p.moveSlots.map(m => m.pp)
    };
    p.hp = 0;
    p.fainted = true;
    p.isActive = false;
    this.sim.sides[0].pokemonLeft--;
    this.events.push({
      kind: 'retreat',
      slot,
      reason
    });
  }
  tick() {
    if (this.finished || this.now() < this.deadline) return false;
    for (const [p, slot] of this.sim.sides[0].active.map((p, i) => [p, i])) if (p?.hp && !p.m.retired && !this.pending[slot]) {
      this.retreat(slot, 'timeout');
      this.pending[slot] = {
        action: 'retreat',
        reason: 'timeout'
      };
    }
    this.resolve();
    return true;
  }
  resolve() {
    this.events = [];
    const r = this.sim.raid;
    r.events = [];
    for (const [s, a] of Object.entries(this.pending)) {
      const p = this.sim.sides[0].active[s];
      if (a.action === 'retreat') this.retreat(Number(s), a.reason || 'retreat');else if (p?.m.friendGuard && this.sim.turn > p.m.friendGuard) delete p.m.friendGuard;
    }
    if (!native.living(this.sim).length) {
      this.sim.win('p2');
      this.collect();
      return true;
    }
    // Request only the four registered combatants; reserves can never enter.
    this.sim.makeRequest('move');
    const allies = this.sim.sides[0],
      bossSide = this.sim.sides[1];
    allies.clearChoice();
    bossSide.clearChoice();
    // Structured native choices support a fourth target slot; the simulator's
    // text protocol deliberately only parses the official one-to-three slots.
    for (let slot = 0; slot < 4; slot++) {
      const p = allies.active[slot];
      if (!p.hp || p.m.retired) continue;
      const a = this.pending[slot];
      if (a.action === 'pass') {
        allies.getChoiceIndex();
        allies.choice.actions.push({
          choice: 'move',
          pokemon: p,
          move: this.sim.dex.moves.get('splash'),
          targetLoc: 0,
          raidPass: a.target
        });
        continue;
      }
      const m = this.moves(slot).find(m => m.index === a.moveIndex);
      const loc = a.action === 'pass' ? m.targets[0]?.loc || 0 : a.targetLoc || 0;
      if (!allies.chooseMove(String(m.index + 1), ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(m.targetKind) ? loc : 0)) throw Error('Capacité indisponible : ' + allies.choice.error);
    }
    const moves = this.bossPokemon.getMoveRequestData().moves,
      m = moves.findIndex(m => m.id === this.bossPlan[0]),
      bossTarget = native.dex.moves.get(this.bossPlan[0]).target;
    if (!bossSide.chooseMove(String(m < 0 ? 1 : m + 1), ['normal', 'any', 'adjacentFoe'].includes(bossTarget) ? native.target(this.sim) : 0)) throw Error('Le boss ne peut pas agir : ' + bossSide.choice.error);
    if (!this.sim.allChoicesDone()) throw Error('Le tour doit contenir toutes les actions.');
    this.sim.commitChoices();
    this.collect();
    this.pending = {};
    this.token = randomUUID();
    this.playbackUntil = this.now() + Math.min(22000, this.events.filter(e => e.kind === 'move').length * 1400 + this.events.filter(e => e.kind === '-damage' || e.kind === '-heal').length * 250 + 1500);
    this.deadline = this.playbackUntil + 30000;
    this.revision++;
    this.planBoss();
    return true;
  }
  collect() {
    const start = this.cursor,
      logs = this.sim.log.slice(start),
      custom = this.sim.raid.events;
    this.cursor = this.sim.log.length;
    for (let i = 0; i < logs.length; i++) {
      this.events.push(...custom.filter(e => e.at === start + i));
      let line = logs[i];
      if (line.startsWith('|split|')) {
        line = logs[++i];
        i++;
      }
      const [, kind, ...v] = line.split('|'),
        slot = slotOf(v[0]);
      if (kind === 'move') {
        const m = native.dex.moves.get(v[1]);
        this.events.push({
          kind: 'move',
          slot,
          target: slotOf(v[2]),
          moveName: m.name,
          moveType: m.type,
          damageClass: m.category.toLowerCase(),
          power: m.basePower,
          moveTarget: m.target,
          message: `${v[0].split(': ').slice(1).join(': ')} utilise ${labels.moves[m.name] || m.name} !`
        });
      } else if (slot !== null && ['-damage', '-heal'].includes(kind)) {
        const hp = /^(\d+)(?:\/(\d+))?/.exec(v[1] || '');
        this.events.push({
          kind,
          slot,
          hp: Number(hp?.[1]) || 0,
          maxHp: Number(hp?.[2]) || null,
          direct: !v.slice(2).some(v => v.startsWith('[from]'))
        });
      } else if (slot !== null && ['-miss', '-immune', '-crit', '-status', '-boost', '-unboost', 'faint', 'cant'].includes(kind)) this.events.push({
        kind,
        slot,
        target: slotOf(v[1]),
        effect: v[1],
        value: v[2]
      });
    }
    this.events.push(...custom.filter(e => e.at >= this.cursor));
    this.sim.raid.events = [];
  }
  applyModels() {
    return this.models.map((entry, i) => {
      const p = this.sim.sides[0].pokemon.find(p => p.set.rift.uuid === entry.pokemon.uuid),
        q = entry.pokemon,
        retired = p.m.retired;
      q.currentHp = retired ? retired.hp : p.hp;
      q.status = status[retired ? retired.status : p.status] || 'normal';
      const slots = p.transformed ? p.baseMoveSlots : p.moveSlots;
      q.movePp = q.abilities.map((m, j) => Math.min(require('../battle/battleResources').getMaxMovePp(m), slots[j]?.pp ?? q.movePp[j]));
      // Knock Off and temporary exchanges never delete the original held item.
      // Consumption follows the item's original owner, even after Trick.
      q.heldItem = q.__darkSurvivalSettled || this.sim.raid.consumedOwners.includes(q.uuid) ? null : entry.initialHeld;
      return entry;
    });
  }
}
module.exports = {
  RaidBattle,
  slotOf
};

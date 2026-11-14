const {
    randomUUID
  } = require('node:crypto'),
  native = require('./ruleset'),
  codec = require('../drift/checkpointCodec');
const pacing = require('../../../data/game/raid_presentation.json');
const labels = require('../../../data/game/corruption_labels.fr.json');
const cooperation=require('./cooperation');
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
    seed, reactive = true
  } = {}) {
    this.now = now;
    this.models = party.map(entry => ({
      ...entry,
      initialHeld: entry.pokemon.heldItem || null
    }));
    this.boss = boss;
    const sets = party.map(v => {
        const set = native.teamSet(v.pokemon);
        const id = Object.keys(status).find(key => status[key] === v.pokemon.status);
        if (id) set.rift.entryStatus = {id, ...(id === 'slp' && Number.isFinite(v.pokemon.__battle?.sleepTurns) ? {sleepTurns: Math.max(1, Math.min(4, v.pokemon.__battle.sleepTurns))} : {})};
        set.rift.ownerId = v.ownerId;
        return set;
      }),
      foe = native.teamSet(boss);
    foe.rift.raidHp = hpMultiplier;
    this.sim = native.create([sets, [foe]], seed);
    this.cursor = this.sim.log.length;
    this.pending = {};
    this.token = randomUUID();
    this.playbackUntil = now() + 8000;
    this.deadline = this.playbackUntil + cooperation.config.decisionMs;
    this.revision = 1;
    this.events = [];
    this.planBoss();
    if (reactive) require('./initiative').initialize(this);
    else this.resetSoloClock();
  }
  static restore(data, now = Date.now) {
    const b = Object.create(RaidBattle.prototype);
    Object.assign(b, data, {
      now,
      sim: native.restore(data.sim)
    });
    require('../doubles/ruleset').refreshCorruptionStats(b.sim,b.models.map(m=>m.pokemon));
    b.sim.raid.participantCount = require('./balance').participantCount(b.models);
    for(const p of b.sim.getAllActive())cooperation.disableUnavailable(b.sim,p);
    if(b.flowVersion===2){require('./relays').ensure(b);require('./relays').prune(b);}
    // Upgrade old solo snapshots once, preserving the already-running deadline.
    if (b.isSolo && !b.soloClock) b.resetSoloClock(b.deadline);
    return b;
  }
  snapshot() {
    return {
      flowVersion: this.flowVersion,
      bossPlan: this.bossPlan,
      announcedAoe: this.announcedAoe,
      models: this.models,
      boss: this.boss,
      sim: this.sim.toJSON(),
      cursor: this.cursor,
      pending: this.pending,
      token: this.token,
      deadline: this.deadline,
      soloClock: this.soloClock,
      playbackUntil: this.playbackUntil,
      revision: this.revision,
      events: this.events,
      eventRevision: this.eventRevision || 0
    };
  }
  get isSolo() { return new Set(this.models.map(m => m.ownerId)).size === 1; }
  nextSlot() { return this.sim.sides[0].active.findIndex((p, i) => p?.hp > 0 && !p.m.retired && !this.pending[i]); }
  resetSoloClock(legacyDeadline) {
    if (!this.isSolo || this.finished) { this.soloClock = null; return; }
    const slot = this.nextSlot(), startedAt = Math.max(this.now(), this.playbackUntil);
    this.soloClock = { slot, budgets: Array(4).fill(cooperation.config.decisionMs), startedAt };
    this.deadline = legacyDeadline ?? startedAt + cooperation.config.decisionMs;
    if (legacyDeadline !== undefined && slot >= 0) this.soloClock.budgets[slot] = Math.max(0, legacyDeadline - startedAt);
  }
  focusSlot(slot) {
    if (!this.soloClock || this.soloClock.slot === slot) return;
    const c = this.soloClock, now = this.now();
    if (c.slot >= 0) c.budgets[c.slot] = Math.max(0, this.deadline - Math.max(now, c.startedAt));
    c.slot = slot; c.startedAt = Math.max(now, this.playbackUntil);
    this.deadline = c.startedAt + c.budgets[slot];
  }
  soloView() {
    if (!this.soloClock) return null;
    const c = this.soloClock;
    return { slot: c.slot, remainingMs: c.budgets.map((ms, i) => this.pending[i] ? 0 : i === c.slot ? Math.max(0, this.deadline - Math.max(this.now(), c.startedAt)) : ms) };
  }
  effectsView() {
    const entry = ([id, condition]) => ({ id, name: labels.moves[native.dex.moves.get(id).name] || native.dex.conditions.get(id).name || id, turns: condition.duration ?? null, layers: condition.layers || null });
    return { sideEffects: this.sim.sides.map(side => Object.entries(side.sideConditions).map(entry)), fieldEffects: [
      ...Object.entries(this.sim.field.pseudoWeather).map(entry),
      ...(this.sim.field.terrain ? [entry([this.sim.field.terrain, this.sim.field.terrainState])] : [])
    ] };
  }
  playbackDuration() {
    // Conservative presentation window: choices still have their full 30 seconds afterwards.
    // This changes no native turn, damage or reward calculation.
    return 1500 + this.events.reduce((total, e) => total + 900 + (e.kind === 'move' ? 620 + 930 + pacing.impactMinMs + pacing.focusOutMs + pacing.focusInMs + pacing.bossPauseMs + pacing.betweenActionsMs :
      ['-damage','-heal','-immune','-miss','-activate'].includes(e.kind) ? pacing.damageMs + pacing.focusOutMs + pacing.focusInMs + pacing.aoeTravelMs + pacing.impactMinMs : e.kind === 'shieldBreak' ? pacing.shieldBreakMs : e.kind === 'shield' ? pacing.shieldMs : e.kind === 'friendship' ? 1500 : e.kind === 'retreat' ? pacing.recallMs : ['pass','passFailed'].includes(e.kind) ? pacing.relayMs+pacing.focusOutMs+pacing.focusInMs :
      ['-boost','-unboost'].includes(e.kind) ? pacing.statMs : ['-singleturn','-status','-curestatus','-start','-end','cant','faint','-sidestart','-sideend','-fieldstart','-fieldend','-fail','-miss','-immune','-activate'].includes(e.kind) ? pacing.statusMs : 0), 0);
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
    const p = this.bossPokemon;
    for(const slot of p.moveSlots)slot.pp=slot.maxpp;
    const moves = p.getMoveRequestData().moves.filter(m => !m.disabled && m.pp > 0 && m.id!=='struggle'),
      spread = moves.filter(m => ['allAdjacent', 'allAdjacentFoes'].includes(native.dex.moves.get(m.id).target)),
      single = moves.filter(m => !spread.includes(m));
    if(!moves.length){this.bossPlan=[];this.sim.raid.extraMove=null;return;}
    const pick = list => list.length ? list[this.sim.random(list.length)] : moves[0];
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
        confusion: !!p.volatiles.confusion,
        disabledMove: p.volatiles.disable ? labels.moves[native.dex.moves.get(p.volatiles.disable.move).name] || native.dex.moves.get(p.volatiles.disable.move).name : null,
        shield: !!p.volatiles.protect,
        clone: !!p.volatiles.substitute,
        helpingHand: !!p.volatiles.helpinghand
      },
      aggro: slot<4?require('./threat').shares(this.sim)[slot]:0,
      survivalKitUsed: !!model?.__darkSurvivalProtected,survivedKO:!!model?.__darkKoSurvived,
      permanentlyLost: !!model?.__darkContinentDead,
      friendshipUsed: false,
      protected: false,
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
        targets = [],area=require('../doubles/moveAvailability').areaTargets(p,move)||[];
      for (const side of this.sim.sides) for (const q of side.active) {
        const loc = side === p.side ? -(q.position + 1) : q.position + 1;
        if (area.includes(q) || cooperation.targetAvailable(this.sim,p,move,q)) targets.push({
          slot: side.n === 1 ? 4 : q.position,
          loc
        });
      }
      return {
        ...m,
        pp:m.id==='struggle'?1:m.pp,maxpp:m.id==='struggle'?1:m.maxpp,
        disabledReason:cooperation.unavailable(move)||require('../doubles/moveAvailability').disabledReason(p,m,move),
        disabled: !!m.disabled || !!cooperation.unavailable(move) || ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(move.target) && !targets.length,
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
      aggroRules:{healingRatio:cooperation.config.aggro.healingRatio,shared:true},
      aggroShares:require('./threat').shares(this.sim),
      cooperationBonusPercent: this.sim.raid.participantCount >= 2 ? 20 : 0,
      soloClock: this.soloView(),
      ...(this.flowVersion === 2 ? require('./initiative').view(this) : {}),
      ...this.effectsView(),
      deadline: this.deadline,
      playbackUntil: this.playbackUntil,
      finished: this.finished,
      won: this.won,
      report: this.finished ? require('./report').view(this) : null,
      boss: {...this.viewPokemon(boss, 4),rage:require('./pressure').view(this.sim)},
      ...(this.flowVersion===2?require('./relays').view(this,userId):{}),
      allies: active.map((p, i) => ({
        ...this.viewPokemon(p, i),
        ready: this.flowVersion === 2 ? !require('./relays').waits(this).some(a=>a.pokemon.position===i) : !!this.pending[i],
        actionsUsed:this.sim.raid.actionsUsed?.[i]||0,
        canControl: this.models[i].ownerId === userId,
        ...(this.models[i].ownerId === userId ? {passiveAbility:native.dex.abilities.get(p.ability).name,inspectionMoves:p.moveSlots.map(m=>({name:native.dex.moves.get(m.id).name,pp:m.pp,maxpp:m.maxpp}))} : {}),
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
      events: this.events,
      eventKey: this.token + ':' + (this.eventRevision || 0)
    };
  }
  order() {
    if (this.flowVersion === 2) return this.sim.queue.list.filter(a => a.raidWait || a.raidBoss !== undefined).map(a => a.pokemon.side.n === 1 ? 4 : a.pokemon.position);
    const priority = p => {
      const a = p.side.n === 0 ? this.pending[p.position] : null,
        move = p.side.n === 1 ? native.dex.moves.get(this.bossPlan?.[0]) : a?.action === 'attack' ? native.dex.moves.get(p.getMoveRequestData().moves[a.moveIndex]?.id) : null;
      return (move?.priority || 0) + (move?.category === 'Status' && p.hasAbility('prankster') ? 1 : 0);
    };
    return this.sim.getAllActive().filter(p => p.hp > 0).sort((a, b) => priority(b) - priority(a) || b.getActionSpeed() - a.getActionSpeed()).map(p => p.side.n === 1 ? 4 : p.position);
  }
  action(userId, data) {
    if(['requestHand','cancelHandRequest'].includes(data.action))return require('./relays').request(this,userId,data);
    if (this.flowVersion === 2) return require('./initiative').action(this, userId, data);
    if (this.finished || data.token !== this.token || this.now() >= this.deadline) throw Error('Ce tour n’est plus disponible.');
    const slot = data.slot,
      p = this.sim.sides[0].active[slot];
    if (!p?.hp || p.m.retired || this.models[slot]?.ownerId !== userId || this.pending[slot]) throw Error('Tu ne contrôles pas cette action.');
    if (this.soloClock) {
      if (data.action === 'presented') {
        // A solo client may start its own decision clock early after replay;
        // this acknowledgement can only shorten the conservative window.
        const c=this.soloClock;
        if(c.startedAt>this.now()) { this.playbackUntil=this.now(); c.startedAt=this.now(); this.deadline=this.now()+c.budgets[c.slot]; this.revision++; }
        return false;
      }
      this.focusSlot(slot);
      if (data.action === 'focus') { this.revision++; this.events = []; return false; }
    } else if (data.action === 'focus') throw Error('Le chronomètre individuel est réservé au solo.');
    if (data.action === 'retreat') {
      if (data.confirm !== true) throw Error('Confirme le retrait définitif du raid.');
      this.pending[slot] = {
        action: 'retreat'
      };
    } else if (data.action === 'pass') {
      const target = this.sim.sides[0].active[data.target];
      if (!target?.hp || target === p || target.m.retired || this.pending[data.target]) throw Error('Choisis un allié qui n’a pas encore joué.');
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
    if (this.ready()) return this.resolve();
    if(data.action==='pass'){
      if(this.soloClock){this.soloClock.budgets[data.target]=cooperation.config.decisionMs;this.focusSlot(data.target);this.soloClock.startedAt=Math.max(this.now(),this.playbackUntil);this.deadline=this.soloClock.startedAt+cooperation.config.decisionMs;}
      else this.deadline=Math.max(this.now(),this.playbackUntil)+cooperation.config.decisionMs;
    }else if (this.soloClock) this.focusSlot(this.nextSlot());
    return false;
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
    const shares=require('./threat').shares(this.sim);
    this.events.push({kind:'aggro',slot,value:shares[slot],shares,gain:0,reason:'retreat'});
  }
  tick() {
    if (this.flowVersion === 2) return require('./initiative').tick(this);
    if (this.finished || this.now() < this.deadline) return false;
    this.events = [];
    const expired = this.soloClock ? [this.soloClock.slot] : [0, 1, 2, 3];
    for (const slot of expired) { const p = this.sim.sides[0].active[slot]; if (p?.hp && !p.m.retired && !this.pending[slot]) {
      this.pending[slot] = {
        action: 'retreat',
        reason: 'timeout'
      };
    }}
    if (this.ready()) this.resolve();
    else { for (const slot of expired) this.retreat(slot, 'timeout'); this.eventRevision = (this.eventRevision || 0) + 1; this.focusSlot(this.nextSlot()); this.revision++; }
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
    if(!this.bossPlan.length)bossSide.choice.actions.push({choice:'pass',pokemon:this.bossPokemon});
    else if (!bossSide.chooseMove(String(m < 0 ? 1 : m + 1), ['normal', 'any', 'adjacentFoe'].includes(bossTarget) ? native.target(this.sim) : 0)) throw Error('Le boss ne peut pas agir : ' + bossSide.choice.error);
    if (!this.sim.allChoicesDone()) throw Error('Le tour doit contenir toutes les actions.');
    this.sim.commitChoices();
    this.collect();
    this.pending = {};
    this.token = randomUUID();
    this.playbackUntil = this.now() + this.playbackDuration();
    this.deadline = this.playbackUntil + cooperation.config.decisionMs;
    this.revision++;
    this.planBoss();
    this.resetSoloClock();
    return true;
  }
  collect() {
    const start = this.cursor,
      logs = this.sim.log.slice(start),
      custom = [...this.sim.raid.events].sort((a,b) => a.at - b.at);
    let customIndex = 0;
    const flush = at => { while (customIndex < custom.length && custom[customIndex].at <= at) this.events.push(custom[customIndex++]); };
    this.cursor = this.sim.log.length;
    for (let i = 0; i < logs.length; i++) {
      flush(start + i);
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
          ...(m.id === 'pollenpuff' && slot !== null && slot < 4 && slotOf(v[2]) !== null && slotOf(v[2]) < 4 ? {healing:true} : {}),
          message: `${v[0].split(': ').slice(1).join(': ')} utilise ${labels.moves[m.name] || m.name} !`
        });
      } else if (slot !== null && ['-damage', '-heal'].includes(kind)) {
        const hp = /^(\d+)(?:\/(\d+))?/.exec(v[1] || '');
        this.events.push({
          kind,
          slot,
          hp: Number(hp?.[1]) || 0,
          maxHp: Number(hp?.[2]) || null,
          direct: !v.slice(2).some(v => v.startsWith('[from]')),
          source: v.slice(2).find(v => v.startsWith('[from]'))?.slice(7).trim() || null
        });
      } else if(kind==='-weather')this.events.push({kind:'weather',effect:v[0]==='none'?null:native.toID(v[0])});
      else if (['upkeep','turn'].includes(kind)) this.events.push({kind});
      else if (['-sidestart','-sideend','-fieldstart','-fieldend','-fieldactivate'].includes(kind)) {
        const side = /^p([12])/.exec(v[0] || ''), effect = kind.startsWith('-side') ? v[1] : v[0], id = native.toID(String(effect || '').replace(/^move: /,''));
        const condition = side ? this.sim.sides[Number(side[1])-1].sideConditions[id] : this.sim.field.terrain===id ? this.sim.field.terrainState : this.sim.field.pseudoWeather[id];
        const move = native.dex.moves.get(id);
        this.events.push({kind, side: side ? Number(side[1])-1 : null, effect:id, name:labels.moves[move.name] || move.name, turns:condition?.duration ? condition.duration + (logs.some(line=>line.startsWith('|upkeep'))?1:0) : move.condition?.duration ?? null});
      } else if (slot !== null && ['-miss', '-immune', '-crit', '-status', '-curestatus', '-boost', '-unboost', '-start','-end','-singleturn','-activate','-fail','-prepare', 'faint', 'cant'].includes(kind)) this.events.push({
        kind,
        slot,
        target: slotOf(v[1]),
        effect: v[1],
        value: v[2]
      });
    }
    flush(Infinity);
    this.sim.raid.events = [];
    this.eventRevision = (this.eventRevision || 0) + 1;
  }
  applyModels() {
    return this.models.map((entry, i) => {
      const p = this.sim.sides[0].pokemon.find(p => p.set.rift.uuid === entry.pokemon.uuid),
        q = entry.pokemon,
        retired = p.m.retired;
      if(p.volatiles.riftmutation?.baseMaxhp){q.__berryBaseMaxHp=p.volatiles.riftmutation.baseMaxhp;q.maxHp=p.maxhp;}else if(q.__berryBaseMaxHp){q.maxHp=q.__berryBaseMaxHp;delete q.__berryBaseMaxHp;}
      q.currentHp = retired ? retired.hp : p.hp;
      q.status = status[retired ? retired.status : p.status] || 'normal';
      const slots = p.transformed ? p.baseMoveSlots : p.moveSlots;
      q.movePp = q.abilities.map((m, j) => Math.min(require('../battle/battleResources').getMaxMovePp(m), slots[j]?.pp ?? q.movePp[j]));
      // Knock Off and temporary exchanges never delete the original held item.
      // Consumption follows the item's original owner, even after Trick.
      require('../berries/simulator').syncModels(this.sim,[q]);
      const spentMutation=(q.__berrySpent||[]).some(r=>r.itemKey===entry.initialHeld);
      q.heldItem = spentMutation || q.__darkSurvivalSettled || this.sim.raid.consumedOwners.includes(q.uuid) ? null : entry.initialHeld;
      return entry;
    });
  }
}
module.exports = {
  RaidBattle,
  slotOf
};

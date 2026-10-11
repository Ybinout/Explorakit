const { randomUUID } = require('node:crypto');
const engine = require('../battle/battleEngine');
const effects = require('./driftEffects');
const { getUsableMoveIndexes, getItemDefinition } = require('../battle/battleResources');
const { clearBattleTransientState, buildBattleSummary, createBattleSummaryTracker } = require('../battle/battleOutcome');
const { switchPokemonByIndex, resolveMoveSwitches } = require('../battle/battleTeam');
const { serializeMoveResult, serializeFieldState } = require('../battle/battleEvents');
const { getMoveFlags } = require('../abilities/abilityEngine');
const { calculateBattleExperience } = require('../models/progression');
const { yields } = require('../../../data/game/effort_yields.json');
const economy = require('./economy');
const report = require('./runReport');

class DriftBattle {
    constructor(a, b, { type = 'wild', emit, now = Date.now, random = Math.random, onFinish, onUpdate, npcKey = null, paceMs = 1800 }) {
        this.id = randomUUID(); this.a = a; this.b = b; this.type = type; this.emit = emit; this.now = now;
        this.random = random; this.onFinish = onFinish; this.onUpdate = onUpdate; this.npcKey = npcKey; this.paceMs = paceMs;
        this.publicLog = [];
        this.state = engine.createBattleState(); this.sides = [this.state.sides.player, this.state.sides.enemy];
        this.pending = new Map(); this.round = 0; this.finished = false; this.rewarded = new Set(); this.awaiting = false;
        this.originals = [...a.equipe.pokemons, ...b.equipe.pokemons];
        this.originalTeams = new Map([a,b].filter(p=>!p.npc).map(p=>[p,[...p.equipe.pokemons]]));
        this.resultTrackers = new Map([a, b].filter(p => !p.npc)
            .map(p => [p, createBattleSummaryTracker(p.equipe.pokemons, 'drift')]));
        for (const [index, p] of [a,b].entries()) {
            if (!p.npc) report.battleStarted(p,this);
            p.inbattle = true; p.battle = this;
            effects.attach(p.equipe.pokemons, p, type === 'pvp', random);
            p.equipe.pokemons.forEach(poke => { effects.states.get(poke).wild = index === 0 && type === 'wild'; });
            if (!p.npc) emit(p, 'battletrigger', { battleType: type === 'arena' ? 'trainer' : type, message: type === 'pvp' ? 'Duel du tournoi Drift !' : 'Un combat Drift commence !' });
        }
        for (const index of [0,1]) this.enter(index, false, true);
        this.prune();
        if (!this.checkEnd()) { this.sync(); this.request(); }
    }
    active(i) { return [this.a,this.b][i].equipe.pokemons[0]; }
    both(event, payload) { for (const p of [this.a,this.b]) if (!p.npc) this.emit(p,event,payload); }
    say(message) {
        if (!message) return;
        this.publicLog.push(String(message));
        this.publicLog = this.publicLog.slice(-20);
        this.both('battleText', { message });
        this.onUpdate?.(this);
    }
    spectatorView() {
        // Explicit allowlist: observers never receive reserve Pokémon, stats, moves or action tokens.
        return { turn: this.round, log: [...this.publicLog], players: [this.a, this.b].map((p, index) => {
            const pokemon = this.active(index);
            return { id: p.userId, username: p.username, pokemon: pokemon ? {
                pokemonId: pokemon.data.id, name: pokemon.truename || pokemon.name || 'Pokémon',
                level: pokemon.level, currentHp: pokemon.currentHp, maxHp: pokemon.maxHp, status: pokemon.status
            } : null };
        }) };
    }
    sync() {
        for (const [index,p] of [this.a,this.b].entries()) if (!p.npc) {
            this.emit(p, 'introAnimation', { player: { id: p.socketId, userId: p.userId, equipe: p.equipe }, wildPokemon: this.active(1-index) || null, battleType: this.type === 'arena' ? 'trainer' : this.type });
            this.emit(p, 'battleFieldState', serializeFieldState(this.state));
            this.emit(p, 'bagUpdated', { items: economy.bag(p) });
        }
        this.onUpdate?.(this);
    }
    enter(i, manual = false, initial = false) {
        const p = this.active(i); if (!p || !this.active(1-i)) return;
        engine.applySwitchInEffects(p, this.sides[i], this.sides[1-i], this.state, this.active(1-i)).forEach(m=>this.say(m));
        if (!initial) effects.switched(p, manual);
    }
    defaultAction(p) {
        const active = p.equipe.pokemons[0];
        const usable = active ? getUsableMoveIndexes(active) : [];
        const damaging = usable.filter(i => engine.getMoveByName(active.abilities[i])?.power > 0);
        const pool = damaging.length ? damaging : usable;
        return { action: 'attack', number: pool.length ? pool[Math.floor(this.random()*pool.length)] : -1 };
    }
    request() {
        if (this.finished) return;
        this.round++; this.token = `${this.id}:${this.round}`; this.pending.clear(); this.awaiting = true;
        this.deadline = this.now() + 30000;
        for (const p of [this.a,this.b]) {
            if (p.npc) this.pending.set(p, this.defaultAction(p));
            else this.emit(p,'requestAction',{ message: 'Choisis ton action · 30 secondes', turnId: this.token });
        }
        this.onUpdate?.(this);
    }
    resume(p) { if (this.finished) return; this.sync(); if (this.awaiting && !this.pending.has(p)) this.emit(p,'requestAction',{ message: 'Le combat reprend.', turnId: this.token }); }
    action(p, payload) {
        if (this.finished || !this.awaiting || this.pending.has(p) || payload?.turnId !== this.token || ![this.a,this.b].includes(p)) return false;
        const active = p.equipe.pokemons[0];
        const kind = payload.action;
        if (!['attack','change','bag','flee'].includes(kind)) return false;
        if (kind === 'change' && (!Number.isInteger(payload.number) || payload.number <= 0 || !p.equipe.pokemons[payload.number] || !engine.canSwitchOut(active))) return false;
        if (kind === 'attack' && !(getUsableMoveIndexes(active).includes(payload.number) || !getUsableMoveIndexes(active).length)) return false;
        if (kind === 'bag' && (this.type !== 'wild' || p !== this.a || p.equipe.pokemons.length >= 6 || !(p.items[payload.itemKey] > 0) || getItemDefinition(payload.itemKey)?.category !== 'ball')) return false;
        this.pending.set(p, { action: kind, number: payload.number, itemKey: payload.itemKey });
        if (this.pending.size === 2) this.resolve();
        return true;
    }
    tick() {
        if (this.finished) return;
        if (!this.awaiting && this.now() >= this.nextRoundAt) { this.sync(); this.request(); }
        if (this.awaiting && this.now() >= this.deadline) {
            for (const p of [this.a,this.b]) if (!this.pending.has(p)) this.pending.set(p,this.defaultAction(p));
            this.resolve();
        }
    }
    prune() {
        // Removal happens before any reward or heal; a dead instance can never re-enter the team.
        for (const [index,p] of [this.a,this.b].entries()) {
            const old = this.active(index);
            const dead = p.equipe.pokemons.filter(poke => effects.isDead(poke));
            if (!p.npc) dead.forEach(poke => report.lost(p,poke));
            dead.forEach(poke => effects.fainted(poke));
            p.equipe.pokemons = p.equipe.pokemons.filter(poke => !effects.isDead(poke));
            if (p === this.b && this.type !== 'pvp') for (const defeated of dead) this.reward(defeated);
            if (this.type === 'pvp' && dead.length) [this.a,this.b][1-index].chain = Math.min(5, ([this.a,this.b][1-index].chain || 0) + dead.length);
            if (old !== this.active(index) && this.active(index)) this.enter(index);
        }
        // Hazards on an automatic replacement can kill too; drain the finite team.
        if ([this.a,this.b].some(p=>p.equipe.pokemons.some(poke=>effects.isDead(poke)))) this.prune();
    }
    reward(defeated) {
        if (this.rewarded.has(defeated.uuid)) return; this.rewarded.add(defeated.uuid);
        const active = this.a.equipe.pokemons.find(p=>!effects.isDead(p)); if (!active) return;
        const bonus = effects.value(this.a,43) + (defeated.level > active.level ? effects.value(this.a,51) : 0);
        const xp = Math.max(1,Math.floor(calculateBattleExperience(defeated, this.type === 'arena' ? 2 : this.type === 'trainer' ? 1.5 : 1, active) * (1 + bonus/100)));
        const previousLevel = active.level, previousExperience = active.experience;
        active.gainEffort(yields[defeated.data.id] || {}); active.gainExperience(xp);
        for (const reserve of this.a.equipe.pokemons) if (reserve !== active && !effects.isDead(reserve)) reserve.gainExperience(Math.floor(xp * effects.value(this.a,50)/100));
        this.emit(this.a,'battleExperience',{ pokemon: active, xpGained: xp, previousLevel, previousExperience });
        this.a.chain = Math.min(5,(this.a.chain || 0)+1);
    }
    checkEnd() {
        const aliveA = this.a.equipe.pokemons.length > 0, aliveB = this.b.equipe.pokemons.length > 0;
        if (aliveA && aliveB) return false;
        this.finish(aliveA ? this.a : aliveB ? this.b : null, 'finished'); return true;
    }
    resolve() {
        if (this.finished || !this.awaiting) return;
        this.awaiting = false;
        const actors = [this.a,this.b];
        for (const p of actors) if (this.pending.get(p)?.action === 'flee') {
            if (this.type === 'pvp') this.finish(p === this.a ? this.b : this.a, 'forfeit');
            else this.finish(null,'fled');
            return;
        }
        for (const [i,p] of actors.entries()) {
            const action = this.pending.get(p);
            if (action?.action === 'change' && engine.canSwitchOut(this.active(i))) {
                switchPokemonByIndex(p.equipe, action.number); this.enter(i,true); this.prune(); if(this.checkEnd()) return;
            }
            if (action?.action === 'bag') {
                p.items[action.itemKey]--;
                report.increment(p,'captureAttempts');
                const target = this.active(1), multiplier = getItemDefinition(action.itemKey).catch_multiplier;
                const chance = Math.min(.95, Math.max(.05,(.16+(1-target.currentHp/target.maxHp)*.64)*multiplier*(1+effects.value(p,47)/100)));
                const success = this.random() < chance;
                this.emit(p,'captureAnimation',{ success, shakes: success ? 3 : 1, itemKey: action.itemKey });
                if (success) { this.capturedPokemon = target; this.b.equipe.pokemons = []; p.equipe.pokemons.push(target); effects.detach([target]);report.capture(p,target);this.finish(p,'captured'); return; }
                this.say('Le Pokémon se libère !');
            }
        }
        const ordered = engine.orderBattleActions(actors.map((p,index) => {
            const action = this.pending.get(p), pokemon = this.active(index);
            const name = pokemon.abilities[action?.number] || 'Struggle';
            return { p, index, pokemon, name, moveName: name, side: this.sides[index], driftPriority: action?.action === 'attack' ? effects.priority(pokemon,engine.getMoveByName(name)) : 0 };
        }), this.state, this.random);
        for (const action of ordered) {
            const { p, index, pokemon, name } = action;
            if (this.pending.get(p)?.action !== 'attack' || this.active(index) !== pokemon || effects.isDead(pokemon)) continue;
            const defender = this.active(1-index); if (!defender) break;
            for (const [view,viewer] of actors.entries()) if (!viewer.npc) this.emit(viewer,'battleMoveAnimation',{ actor:view===index?'player':'opponent',moveName:name,moveType:engine.getMoveByName(name)?.type });
            const result = engine.useattack(name,pokemon,defender,{ battleState:this.state, attackerSide:this.sides[index],defenderSide:this.sides[1-index],attackerTeam:p.equipe.pokemons,defenderTeam:actors[1-index].equipe.pokemons });
            effects.afterMove(pokemon,defender,result,{ contact: Boolean(getMoveFlags(result.move).contact),
                status:(target,status,source)=>engine.applyStatus(target,status,target===pokemon?this.sides[index]:this.sides[1-index],result.messages,{attacker:source,battleState:this.state}),
                stage:(target,stat,delta)=>engine.applyStageChange(target,stat,delta,result.messages) });
            result.messages.forEach(m=>this.say(m));
            for (const [view,viewer] of actors.entries()) if(!viewer.npc) this.emit(viewer,'battleMoveResult',serializeMoveResult(view===index?'player':'opponent',result));
            const switched = resolveMoveSwitches(result,p.equipe,actors[1-index].equipe);
            if(switched.attacker) this.enter(index); if(switched.defender) this.enter(1-index);
            this.prune(); if(this.checkEnd()) return;
            if(result.escape && this.type!=='pvp') {this.finish(null,'fled'); return;}
        }
        engine.processEndOfRound(this.active(0),this.active(1),this.sides[0],this.sides[1],this.state).forEach(m=>this.say(m));
        effects.endTurn(this.active(0)); effects.endTurn(this.active(1)); this.prune();
        if (!this.checkEnd()) { this.sync(); this.nextRoundAt = this.now() + this.paceMs; }
    }
    grantLoot(source) {
        const loot = economy.drop(this.a, source, this.random);
        this.resultTrackers.get(this.a).loot.push(...loot);
        if (loot.length) this.say(`Butin : ${loot.join(', ')}.`);
    }
    finish(winner = null, reason = 'timer') {
        if(this.finished) return; this.finished=true; this.awaiting=false;
        clearBattleTransientState(this.originals);
        for (const p of [this.a,this.b]) { p.inbattle=false; p.battle=null; }
        if (winner === this.a && reason === 'captured' && this.type === 'wild') this.grantLoot('capture');
        if(winner===this.a && !['captured','timer','fled'].includes(reason) && this.type!=='pvp') {
            const first = !this.npcKey || !this.a.defeated.has(this.npcKey);
            if(this.npcKey) this.a.defeated.add(this.npcKey);
            if(first) {
                if(this.type!=='wild') {
                    const money = Math.floor(this.originals.filter(p=>this.rewarded.has(p.uuid)).reduce((s,p)=>s+p.level*20,0)*(1+effects.value(this.a,46)/100));
                    this.a.money += money;
                    this.resultTrackers.get(this.a).money += money;
                }
                this.grantLoot(this.type);
            }
            for(const p of this.a.equipe.pokemons) effects.heal(p,p.maxHp*effects.value(this.a,49)/100);
        }
        effects.detach(this.originals);
        for(const p of [this.a,this.b]) if(!p.npc) {
            const payload = {
                playerWon: p === winner,
                battleType: this.type === 'arena' ? 'trainer' : this.type,
                reason,
                draw: !winner && reason === 'finished'
            };
            payload.summary = buildBattleSummary(payload, this.resultTrackers.get(p)
                .snapshot(p.equipe.pokemons, p === winner ? this.capturedPokemon : null));
            report.battleFinished(p,this,payload.summary);
            this.emit(p,'endbattle',payload);
            this.emit(p,'teamStateChanged',{equipe:p.equipe,reason:'drift_battle_end'});
        }
        this.onFinish?.(this,winner,reason);
    }
}
module.exports = { DriftBattle };

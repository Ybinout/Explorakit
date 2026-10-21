const { replacementIndexes } = require('../battle/replacementChoice');
const presentation = require('../battle/presentationState');
const { randomUUID } = require('node:crypto');
const engine = require('../battle/battleEngine');
const effects = require('./driftEffects');
const { getUsableMoveIndexes, getItemDefinition, getChargingMove, selectedMoveName } = require('../battle/battleResources');
const { clearBattleTransientState, buildBattleSummary, createBattleSummaryTracker } = require('../battle/battleOutcome');
const { switchPokemonByIndex, resolveMoveSwitches, autoSwitchPokemon, hasAlivePokemon } = require('../battle/battleTeam');
const { serializeMoveResult, serializeFieldState } = require('../battle/battleEvents');
const { getMoveFlags } = require('../abilities/abilityEngine');
const { calculateBattleExperience } = require('../models/progression');
const { planTurnActions } = require('../battle/turnActions');
const { effortYield, grantEffort } = require('../models/training');
const economy = require('./economy');
const report = require('./runReport');
const colosseumAI = require('./colosseumAI');
const trainerTactics = require('../battle/trainerTactics');
const { wildMoneyReward } = require('../battle/wildReward');

class DriftBattle {
    constructor(a, b, { type = 'wild', emit, now = Date.now, random = Math.random, onFinish, onUpdate, npcKey = null, paceMs = 1800 }) {
        presentation.reset(a);presentation.reset(b);
        this.id = randomUUID(); this.a = a; this.b = b; this.type = type; this.emit = emit; this.now = now;
        this.random = random; this.onFinish = onFinish; this.onUpdate = onUpdate; this.npcKey = npcKey; this.paceMs = paceMs;
        this.publicLog = [];
        this.contractContributors = new Set();
        this.aiMemory = { seen: {}, lastSwitchRound: -10 };
        this.state = engine.createBattleState({ mapName: a.currentmap, opponentMap: b.npc ? a.currentmap : b.currentmap ?? null }); this.sides = [this.state.sides.player, this.state.sides.enemy];
        this.pending = new Map(); this.round = 0; this.finished = false; this.rewarded = new Set(); this.awaiting = false;
        this.originals = [...a.equipe.pokemons, ...b.equipe.pokemons];
        this.originalTeams = new Map([a,b].filter(p=>!p.npc).map(p=>[p,[...p.equipe.pokemons]]));
        this.resultTrackers = new Map([a, b].filter(p => !p.npc)
            .map(p => [p, createBattleSummaryTracker(p.equipe.pokemons, 'drift')]));
        for (const [index, p] of [a,b].entries()) {
            if (!p.npc) report.battleStarted(p,this);
            if (p.npc) switchPokemonByIndex(p.equipe,trainerTactics.replacementIndex(p.equipe));
            else autoSwitchPokemon(p.equipe);
            require('../abilities/abilityForms').attachTeam(p.equipe.pokemons);
            p.inbattle = true; p.battle = this;
            effects.attach(p.equipe.pokemons, p, type === 'pvp', random);
            p.equipe.pokemons.forEach(poke => { effects.states.get(poke).wild = index === 0 && type === 'wild'; });
            if (!p.npc) emit(p, 'battletrigger', { field:serializeFieldState(this.state), musicKind:this.musicKind(), battleType: type === 'arena' ? 'trainer' : type, message: type === 'pvp' ? 'Duel du tournoi Drift !' : 'Un combat Drift commence !' });
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
    withDriftSignals(action) {
        const captured=require('./driftSignals').capture(action);
        if(captured.effects.length)for(const viewer of [this.a,this.b])if(!viewer.npc)this.emit(viewer,'battleDriftEffects',{effects:captured.effects.map(({owner,...effect})=>({...effect,side:owner===viewer?'player':'opponent'}))});
        return captured.result;
    }
    musicKind() { return this.a.run?.mode==='colosseum' && this.npcKey?.startsWith('colosseum_') ? 'colosseum' : this.type; }
    sync() {
        require('../abilities/abilityForms').syncWeatherForms(this.active(0),this.active(1),this.state);
        for (const [index,p] of [this.a,this.b].entries()) if (!p.npc) {
            const transitions = presentation.transitions(p,this.active(index),this.active(1-index),{initial:this.type!=='wild'});
            this.emit(p, 'introAnimation', { moveTypes:engine.battleMoveTypes(this.active(index),this.active(1-index),this.state), effortYield:this.type==='pvp'?null:effortYield(this.active(1-index)), musicKind:this.musicKind(), transitions:index===0&&this.b.npc?trainerTactics.decorateTransitions(transitions,this.b.equipe,this.aiMemory):transitions, player: { id: p.socketId, userId: p.userId, equipe: p.equipe }, wildPokemon: this.active(1-index) || null, battleType: this.type === 'arena' ? 'trainer' : this.type, usableMoveIndexes: getUsableMoveIndexes(this.active(index), this.state) });
            this.emit(p, 'battleFieldState', serializeFieldState(this.state));
            this.emit(p, 'bagUpdated', { items: economy.bag(p) });
        }
        this.onUpdate?.(this);
    }
    enter(i, manual = false, initial = false) {
        const p = this.active(i); if (!p || effects.isDead(p) || !this.active(1-i)) return;
        if (!initial) this.sync(); // Publish the entrant before hazards, abilities or healing.
        engine.applySwitchInEffects(p, this.sides[i], this.sides[1-i], this.state, this.active(1-i)).forEach(m=>this.say(m));
        if (!initial)this.withDriftSignals(()=>effects.switched(p,manual));
    }
    defaultAction(p) {
        if (this.replacementPhase && this.replacementPlayers?.has(p)) return {action:'change',number:replacementIndexes(p.equipe)[0]};
        if (getChargingMove(p.equipe.pokemons[0])) return {action:'attack',number:getUsableMoveIndexes(p.equipe.pokemons[0],this.state)[0]};
        if (p === this.b && p.npc) {
            const decision = trainerTactics.chooseAction(p.equipe,this.active(0),this.state,this.aiMemory,this.round);
            if (decision) return decision;
        }
        const wave = p === this.b && p.npc && this.type === 'arena' && this.npcKey?.startsWith('colosseum_')
            ? p.colosseumWave || this.a.run?.colosseum?.wave : null;
        if (wave) {
            this.aiMemory ||= { seen: {}, lastSwitchRound: -10 };
            const decision = colosseumAI.chooseAction({ team:p.equipe.pokemons, opponent:this.active(0),
                field:this.state, ownSide:this.sides[1], enemySide:this.sides[0], wave, memory:this.aiMemory, round:this.round,
                version:p.colosseumVersion ?? (this.a.run ? this.a.run.colosseum?.version || 1 : 3) });
            if (decision) return decision;
        }
        const active = p.equipe.pokemons[0];
        const usable = active ? getUsableMoveIndexes(active, this.state) : [];
        const damaging = usable.filter(i => engine.getMoveByName(active.abilities[i])?.power > 0);
        const pool = damaging.length ? damaging : usable;
        return { action: 'attack', number: pool.length ? pool[Math.floor(this.random()*pool.length)] : -1 };
    }
    request() {
        if (this.finished) return;
        const replacements = [this.a,this.b].filter(p => !p.npc && effects.isDead(p.equipe.pokemons[0]) && replacementIndexes(p.equipe).length);
        if (replacements.length) {
            this.replacementPhase = true;
            this.replacementPlayers = new Set(replacements);
            this.token = `${this.id}:replacement:${randomUUID()}`;
            this.pending.clear(); this.awaiting = true;
            this.deadline = this.now() + 60000;
            for (const p of replacements) this.promptReplacement(p);
            this.onUpdate?.(this);
            return;
        }
        this.replacementPhase = false;
        this.round++; this.token = `${this.id}:${this.round}`; this.pending.clear(); this.awaiting = true;
        this.deadline = this.now() + 30000;
        for (const p of [this.a,this.b]) {
            if (p.npc || getChargingMove(p.equipe.pokemons[0])) this.pending.set(p, this.defaultAction(p));
            else this.emit(p,'requestAction',{ message: 'Choisis ton action · 30 secondes', turnId: this.token });
        }
        this.onUpdate?.(this);
        if (this.pending.size === 2) this.resolve();
    }
    promptReplacement(p) {
        this.emit(p,'requestAction',{ message:'Choisis le Pokémon à envoyer au combat.', turnId:this.token,
            replacement:true, replacementId:this.token, allowedPokemonIndexes:replacementIndexes(p.equipe) });
    }
    resume(p) {
        if (this.finished) return;
        this.sync();
        if (this.awaiting && !this.pending.has(p)) {
            if (this.replacementPhase) { if (this.replacementPlayers.has(p)) this.promptReplacement(p); }
            else this.emit(p,'requestAction',{ message:'Le combat reprend.', turnId:this.token });
        }
    }
    action(p, payload) {
        if (this.finished || !this.awaiting || this.pending.has(p) || payload?.turnId !== this.token || ![this.a,this.b].includes(p)) return false;
        if (this.replacementPhase) {
            if (!this.replacementPlayers.has(p)) return false;
            if (payload.action !== 'change' || !replacementIndexes(p.equipe).includes(payload.number)) {
                this.promptReplacement(p); return false;
            }
            this.pending.set(p,{action:'change',number:payload.number});
            if ([...this.replacementPlayers].every(player=>this.pending.has(player))) this.resolveReplacements();
            return true;
        }
        const active = p.equipe.pokemons[0];
        const kind = payload.action;
        if (!['attack','change','bag','flee'].includes(kind)) return false;
        if (kind === 'change' && (!Number.isInteger(payload.number) || payload.number <= 0 || !p.equipe.pokemons[payload.number] || effects.isDead(p.equipe.pokemons[payload.number]) || !engine.canSwitchOut(active, this.active(p === this.a ? 1 : 0), this.state))) return false;
        if (kind === 'flee' && this.type === 'wild' && !engine.canSwitchOut(active, this.active(p === this.a ? 1 : 0), this.state, {escape:true})) return false;
        if (kind === 'attack' && !(getUsableMoveIndexes(active, this.state).includes(payload.number) || !getUsableMoveIndexes(active, this.state).length)) return false;
        if (kind === 'bag' && (this.type !== 'wild' || p !== this.a || (p.equipe.pokemons.length >= 6 && (p.storage || []).length >= require('../storage/pokemonStorage').CAPACITY) || !(p.items[payload.itemKey] > 0) || getItemDefinition(payload.itemKey)?.category !== 'ball')) return false;
        this.pending.set(p, { action: kind, number: payload.number, itemKey: payload.itemKey });
        if (this.pending.size === 2) this.resolve();
        return true;
    }
    tick() {
        if (this.finished) return;
        if (!this.awaiting && this.now() >= this.nextRoundAt) { this.sync(); this.request(); }
        if (this.awaiting && this.now() >= this.deadline) {
            if (this.replacementPhase) {
                for (const p of this.replacementPlayers) if (!this.pending.has(p)) this.pending.set(p,{action:'change',number:replacementIndexes(p.equipe)[0]});
                this.resolveReplacements(); return;
            }
            for (const p of [this.a,this.b]) if (!this.pending.has(p)) this.pending.set(p,this.defaultAction(p));
            this.resolve();
        }
    }
    resolveReplacements() {
        this.awaiting = false;
        const replacements = [...this.replacementPlayers];
        this.replacementPhase = false;
        for (const p of replacements) {
            const old = p.equipe.pokemons[0], action = this.pending.get(p);
            if (!switchPokemonByIndex(p.equipe,action?.number)) continue;
            // Permanent death is recorded at K.O.; retain its slot only until a choice is made.
            if (!old.riftFainted) p.equipe.pokemons = p.equipe.pokemons.filter(poke=>poke!==old);
        }
        this.sync();
        for (const p of replacements) this.enter(p===this.a?0:1);
        this.prune();
        if (!this.checkEnd()) { this.sync(); this.request(); }
    }
    prune() {
        if ([0,1].some(i=>this.active(i) && effects.isDead(this.active(i)))) this.sync();
        for (const [index,p] of [this.a,this.b].entries()) {
            const old = this.active(index);
            this.processedFaints ||= new Set();
            const fainted = p.equipe.pokemons.filter(poke => effects.isDead(poke) && !poke.riftFainted && !this.processedFaints.has(poke.uuid));
            for (const poke of fainted) {
                this.processedFaints.add(poke.uuid);
                const protectedKO = !p.npc && require('../items/heldItems').effect(poke, this.state) === 'rift_protection';
                if (protectedKO) {
                    poke.heldItem = null; poke.currentHp = 0; poke.riftFainted = true;
                    this.say(`${poke.truename || poke.name} est sauvé par son talisman ! Il reste K.O. jusqu’à un soin hors combat.`);
                    report.event(p,'protection',`Talisman consommé : ${poke.truename || poke.name} reste dans l’équipe à 0 PV.`);
                } else if (!p.npc) report.lost(p,poke);
                effects.fainted(poke);
            }
            const needsChoice = !p.npc && effects.isDead(old) && hasAlivePokemon(p.equipe);
            p.equipe.pokemons = p.equipe.pokemons.filter(poke => !effects.isDead(poke) || poke.riftFainted || (needsChoice && poke===old));
            if (p === this.b && this.type !== 'pvp') for (const defeated of fainted) this.reward(defeated);
            if (this.type === 'pvp' && fainted.length) [this.a,this.b][1-index].chain = Math.min(5, ([this.a,this.b][1-index].chain || 0) + fainted.length);
            if (p.npc && effects.isDead(old)) switchPokemonByIndex(p.equipe,trainerTactics.replacementIndex(p.equipe));
            if (old !== this.active(index) && this.active(index)) this.enter(index);
        }
        if ([this.a,this.b].some(p=>p.equipe.pokemons.some(poke=>effects.isDead(poke) && !poke.riftFainted && !this.processedFaints.has(poke.uuid)))) this.prune();
    }
    reward(defeated) {
        if (this.rewarded.has(defeated.uuid)) return; this.rewarded.add(defeated.uuid);
        const active = this.a.equipe.pokemons.find(p=>!effects.isDead(p)); if (!active) return;
        const isColosseum = this.a.run?.mode === 'colosseum';
        const sharingBaseFor = recipient => {
            const bonus = effects.value(this.a,43) + (defeated.level > recipient.level ? effects.value(this.a,51) : 0);
            const baseXp = Math.max(1,Math.floor(calculateBattleExperience(defeated, this.type === 'arena' ? 2 : this.type === 'trainer' ? 1.5 : 1, recipient) * (1 + bonus/100)));
            return isColosseum ? Math.floor(baseXp * 48 / 10) : baseXp * 2;
        };
        // Evaluate each recipient before levelling anyone up; low-level reserves
        // catch up, while a high-level reserve cannot bypass the overlevel rule.
        const reserveAwards = this.a.equipe.pokemons.filter(p=>p!==active && !effects.isDead(p)).map(p=>[p,
            Math.floor(sharingBaseFor(p) * ((isColosseum ? 40 : 0) + effects.value(this.a,50))/100)]);
        const sharingBase = sharingBaseFor(active);
        // Keep the Colosseum fighter multiplier and the existing reserve sharing rates.
        const xp = isColosseum ? Math.max(1, Math.floor(Math.floor(sharingBase * 9 / 10) * 4 / 5)) : sharingBase;
        const previousLevel = active.level, previousExperience = active.experience;
        grantEffort(active, defeated); active.gainExperience(xp);
        for (const [reserve, reserveXp] of reserveAwards) reserve.gainExperience(reserveXp);
        this.emit(this.a,'battleExperience',{ pokemon: active, xpGained: xp, previousLevel, previousExperience });
        this.a.chain = Math.min(5,(this.a.chain || 0)+1);
    }
    checkEnd() {
        const aliveA = hasAlivePokemon(this.a.equipe), aliveB = hasAlivePokemon(this.b.equipe);
        if (aliveA && aliveB) return false;
        this.finish(aliveA ? this.a : aliveB ? this.b : null, 'finished'); return true;
    }
    resolve() {
        if (this.finished || !this.awaiting || this.replacementPhase) return;
        this.awaiting = false;
        const actors = [this.a,this.b];
        for (const p of actors) if (this.pending.get(p)?.action === 'flee') {
            if (this.type === 'pvp') this.finish(p === this.a ? this.b : this.a, 'forfeit');
            else this.finish(null,'fled');
            return;
        }
        planTurnActions(this.state, actors.map((p,index) => {
            const action = this.pending.get(p), pokemon = this.active(index);
            return { pokemon, action: action?.action,
                moveName: getChargingMove(pokemon) || (getUsableMoveIndexes(pokemon, this.state).length ? selectedMoveName(pokemon, action?.number) : 'Struggle') };
        }));
        for (const [i,p] of actors.entries()) {
            const action = this.pending.get(p);
            if (action?.action === 'change' && engine.canSwitchOut(this.active(i), this.active(1-i), this.state)) {
                if (p === this.b && p.npc && this.aiMemory) this.aiMemory.lastSwitchRound = this.round;
                switchPokemonByIndex(p.equipe, action.number); this.enter(i,true); this.prune(); this.sync(); if(this.checkEnd()) return;
            }
            if (action?.action === 'bag') {
                p.items[action.itemKey]--;
                report.increment(p,'captureAttempts');
                const target = this.active(1), multiplier = getItemDefinition(action.itemKey).catch_multiplier;
                const chance = Math.min(.95, Math.max(.05,(.16+(1-target.currentHp/target.maxHp)*.64)*multiplier*(1+effects.value(p,47)/100)));
                const success = this.random() < chance;
                this.emit(p,'captureAnimation',{ success, shakes: success ? 3 : 1, itemKey: action.itemKey });
                if (success) {
                    grantEffort(this.active(0), target);
                    this.capturedPokemon = target; this.b.equipe.pokemons = []; effects.detach([target]);
                    let destination = 'team';
                    if (p.equipe.pokemons.length < 6) p.equipe.pokemons.push(target);
                    else {
                        p.storage = p.storage || [];
                        p.storage.push({...require('../storage/pokemonStorage').freeSlot(p.storage), pokemon:target});
                        destination = 'pc'; this.say(`${target.truename || target.name} rejoint le PC.`);
                    }
                    report.capture(p,target,destination); this.finish(p,'captured'); return;
                }
                this.say('Le Pokémon se libère !');
            }
        }
        const ordered = engine.orderBattleActions(actors.map((p,index) => {
            const action = this.pending.get(p), pokemon = this.active(index);
            const name = getChargingMove(pokemon) || (getUsableMoveIndexes(pokemon, this.state).length ? selectedMoveName(pokemon,action?.number) : 'Struggle');
            return { p, index, pokemon, name, moveName: name, side: this.sides[index], driftPriority: action?.action === 'attack' ? this.withDriftSignals(()=>effects.priority(pokemon,engine.getMoveByName(name))) : 0 };
        }), this.state, this.random);
        for (const action of ordered) {
            const { p, index, pokemon, name } = action;
            if (this.pending.get(p)?.action !== 'attack' || this.active(index) !== pokemon || effects.isDead(pokemon)) continue;
            const defender = this.active(1-index); if (!defender || effects.isDead(defender)) continue;
            const move = engine.resolveWeatherMove(engine.getMoveByName(name),pokemon,defender,this.state);
            for (const [view,viewer] of actors.entries()) if (!viewer.npc) this.emit(viewer,'battleMoveAnimation',{
                actor:view===index?'player':'opponent', moveTarget:move?.combat?.target || 'opponent', moveName:name, moveType:move?.type || 'Normal', phase:engine.movePhase(pokemon,name,this.state,defender),
                damageClass:move?.combat?.damage_class || (move?.category === 'phy' ? 'physical' : move?.category === 'spe' ? 'special' : 'status')
            });
            const result = this.withDriftSignals(()=>engine.useattack(name,pokemon,defender,{ battleState:this.state, attackerSide:this.sides[index],defenderSide:this.sides[1-index],attackerTeam:p.equipe.pokemons,defenderTeam:actors[1-index].equipe.pokemons }));
            if(p===this.a&&result.damage>0)(this.contractContributors ||= new Set()).add(pokemon.uuid);
            if (this.aiMemory && this.b.npc && this.npcKey?.startsWith('colosseum_')) {
                if (p === this.a) colosseumAI.observe(this.aiMemory,pokemon,name);
                else colosseumAI.observe(this.aiMemory,defender,name,result);
            }
            if (this.b.npc) {
                if (p === this.a) trainerTactics.observe(this.b.equipe,this.aiMemory,pokemon,name);
                else trainerTactics.observe(this.b.equipe,this.aiMemory,defender,name,result);
            }
            this.withDriftSignals(()=>effects.afterMove(pokemon,defender,result,{ contact: Boolean(getMoveFlags(result.move).contact),
                status:(target,status,source)=>engine.applyStatus(target,status,target===pokemon?this.sides[index]:this.sides[1-index],result.messages,{attacker:source,battleState:this.state}),
                stage:(target,stat,delta)=>engine.applyStageChange(target,stat,delta,result.messages) }));
            result.messages.forEach(m=>this.say(m));
            for (const [view,viewer] of actors.entries()) if(!viewer.npc) this.emit(viewer,'battleMoveResult',serializeMoveResult(view===index?'player':'opponent',result));
            this.sync(); // Damage and K.O. belong to the outgoing sprites, before XP or replacement.
            const switched = resolveMoveSwitches(result,p.equipe,actors[1-index].equipe);
            if(switched.attacker) this.enter(index); if(switched.defender) this.enter(1-index);
            this.prune(); this.sync(); if(this.checkEnd()) return;
            if(result.escape && this.type!=='pvp') {this.finish(null,'fled'); return;}
        }
        this.withDriftSignals(()=>engine.processEndOfRound(this.active(0),this.active(1),this.sides[0],this.sides[1],this.state)).forEach(m=>this.say(m));
        this.withDriftSignals(()=>{effects.endTurn(this.active(0));effects.endTurn(this.active(1));});this.prune();
        if (!this.checkEnd()) { this.sync(); this.nextRoundAt = this.now() + this.paceMs; }
    }
    grantLoot(source) {
        const loot = economy.drop(this.a, source, this.random);
        this.resultTrackers.get(this.a).loot.push(...loot);
        if (loot.length) this.say(`Butin : ${loot.join(', ')}.`);
    }
    finish(winner = null, reason = 'timer') {
        if(this.finished) return; this.finished=true; this.awaiting=false;
        if(reason==='finished')this.sync();
        for (const p of [this.a,this.b]) p.equipe.pokemons = p.equipe.pokemons.filter(poke=>!effects.isDead(poke) || poke.riftFainted);
        clearBattleTransientState(this.originals);
        for (const p of [this.a,this.b]) { p.inbattle=false; p.battle=null; }
        if (winner === this.a && this.type === 'wild' && ['captured', 'finished'].includes(reason)) {
            const target = this.capturedPokemon || this.originals.find(p => this.rewarded.has(p.uuid));
            if (target) {
                const money = wildMoneyReward(target, 1 + effects.value(this.a,46) / 100);
                this.a.money += money;
                this.resultTrackers.get(this.a).money += money;
            }
        }
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
        require('./contracts').record(this.a,this,winner,reason);
        effects.detach(this.originals);
        for(const p of [this.a,this.b]) if(!p.npc) {
            require('./fusion').consolidate(p);
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

const { captureBaseChance } = require('../battle/captureProgression');
const { growthSnapshot, levelGrowth } = require('../models/levelGrowth');
const { replacementIndexes } = require('../battle/replacementChoice');
const presentation = require('../battle/presentationState');
const { partyIndicator } = require('../battle/partyIndicator');
const { randomUUID } = require('node:crypto');
const engine = require('../battle/battleEngine');
const { canFleeWildBattle } = require('../battle/wildEscape');
const {preferMoves}=require('../battle/moveSelection');
const effects = require('./driftEffects');
const { getUsableMoveIndexes, getItemDefinition, getForcedMove, selectedMoveName, isMoveSelectionValid } = require('../battle/battleResources');
const { clearBattleTransientState, buildBattleSummary, createBattleSummaryTracker } = require('../battle/battleOutcome');
const { switchPokemonByIndex, resolveMoveSwitches, autoSwitchPokemon, hasAlivePokemon } = require('../battle/battleTeam');
const { serializeMoveResult, serializeFieldState, prepareMoveAnimation, afterActionMessages } = require('../battle/battleEvents');
const { getMoveFlags } = require('../abilities/abilityEngine');
const { calculateBattleExperience, reduceActiveOverlevelExperience, EXPEDITION_EXPERIENCE_MULTIPLIERS } = require('../models/progression');
const { planTurnActions } = require('../battle/turnActions');
const { effortYield, grantParticipantEffort } = require('../models/training');
const economy = require('./economy');
const report = require('./runReport');
const trainerTactics = require('../battle/trainerTactics');
const { wildMoneyReward } = require('../battle/wildReward');

class DriftBattle {
    constructor(a, b, { type = 'wild', emit, now = Date.now, random = Math.random, onFinish, onUpdate, npcKey = null, environment = null, paceMs = 1800, rules = {} }) {
        this.rules = rules;
        presentation.reset(a);presentation.reset(b);
        this.id = randomUUID(); this.a = a; this.b = b; this.type = type; this.emit = emit; this.now = now;
        this.random = random; this.onFinish = onFinish; this.onUpdate = onUpdate; this.npcKey = npcKey; this.paceMs = paceMs;
        this.environment = environment === 'lake' ? 'lake' : null;
        this.publicLog = [];
        this.contractContributors = new Set();
        this.effortParticipants = new Map(); this.effortRewarded = new Set();
        this.aiMemory = { seen: {}, lastSwitchRound: -10 };
        this.state = engine.createBattleState({ mapName: a.currentmap, opponentMap: b.npc ? a.currentmap : b.currentmap ?? null, battleType:type }); this.sides = [this.state.sides.player, this.state.sides.enemy];
        if (rules.weather) this.state.weather = {...rules.weather};
        this.pending = new Map(); this.round = 0; this.finished = false; this.rewarded = new Set(); this.awaiting = false;
        for (const p of [a,b]) if (!p.npc) require('../battle/partyOrder').rememberPartyOrder(p.equipe);
        this.originals = [...a.equipe.pokemons, ...b.equipe.pokemons];
        this.originalTeams = new Map([a,b].filter(p=>!p.npc).map(p=>[p,[...p.equipe.pokemons]]));
        this.resultTrackers = new Map([a, b].filter(p => !p.npc)
            .map(p => [p, createBattleSummaryTracker(p.equipe.pokemons, 'drift')]));
        for (const [index, p] of [a,b].entries()) {
            if (!p.npc && this.rules.report !== false) report.battleStarted(p,this);
            if (p.npc) switchPokemonByIndex(p.equipe,trainerTactics.replacementIndex(p.equipe));
            else autoSwitchPokemon(p.equipe);
            require('../abilities/abilityForms').attachTeam(p.equipe.pokemons);
            p.inbattle = true; p.battle = this;
            effects.attach(p.equipe.pokemons, p, type === 'pvp', random);
            p.equipe.pokemons.forEach(poke => { effects.states.get(poke).wild = index === 0 && type === 'wild'; });
            if (!p.npc) emit(p, 'battletrigger', { trainerKey:this.npcKey, environment:this.environment, field:serializeFieldState(this.state,index===0?'player':'enemy'), musicKind:this.musicKind(), bagAllowed:this.rules.bagAllowed !== false, fleeAllowed:this.rules.fleeAllowed !== false, tournamentEntrance:this.rules.entrance || null, battleType: type === 'arena' ? 'trainer' : type, message: this.rules.entrance ? 'Le duel du Super Tournoi commence !' : type === 'pvp' ? 'Duel du tournoi Drift !' : 'Un combat Drift commence !' });
        }
        for (const index of [0,1]) this.enter(index, false, true);
        this.prune();
        if (!this.checkEnd()) { this.sync(); this.request(); }
    }
    active(i) { return [this.a,this.b][i].equipe.pokemons[0]; }
    both(event, payload) { for (const p of [this.a,this.b]) if (!p.npc) this.emit(p,event,payload); }
    say(message, reward = false) {
        if (!message) return;
        this.publicLog.push(String(message));
        this.publicLog = this.publicLog.slice(-20);
        this.both('battleText', { message, ...(reward ? {reward:true,readMs:900} : {}) });
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
    withDriftSignals(action, beforeSignals = null) {
        const captured=require('./driftSignals').capture(action);
        beforeSignals?.(captured.result);
        if(captured.effects.length)for(const viewer of [this.a,this.b])if(!viewer.npc)this.emit(viewer,'battleDriftEffects',{effects:captured.effects.map(({owner,...effect})=>({...effect,side:owner===viewer?'player':'opponent'}))});
        return captured.result;
    }
    musicKind() { if(this.rules?.musicKind) return this.rules.musicKind; return this.a.run?.mode==='colosseum' && this.npcKey?.startsWith('colosseum_') ? 'colosseum' : this.type; }
    sync() {
        require('../abilities/abilityForms').syncWeatherForms(this.active(0),this.active(1),this.state);
        for (const [index,p] of [this.a,this.b].entries()) if (!p.npc) {
            const transitions = presentation.transitions(p,this.active(index),this.active(1-index),{initial:this.type!=='wild'});
            const opponent = [this.a,this.b][1-index], ownInitial = this.originalTeams?.get(p);
            // Initial references survive permanent death, switches and checkpoints.
            const opponentRoster = this.originalTeams?.get(opponent)
                || (ownInitial && this.originals ? this.originals.filter(pokemon=>!ownInitial.includes(pokemon)) : opponent.equipe.pokemons);
            this.emit(p, 'battleFieldState', serializeFieldState(this.state,index===0?'player':'enemy'));
            this.emit(p, 'introAnimation', { genders:presentation.genders(this.active(index),this.active(1-index)), opponentParty:this.type==='wild'?null:partyIndicator(opponentRoster), moveTypes:engine.battleMoveTypes(this.active(index),this.active(1-index),this.state), effortYield:this.type==='pvp'?null:effortYield(this.active(1-index)), musicKind:this.musicKind(), transitions:index===0&&this.b.npc?trainerTactics.decorateTransitions(transitions,this.b.equipe,this.aiMemory):transitions, player: { id: p.socketId, userId: p.userId, equipe: p.equipe }, wildPokemon: this.active(1-index) || null, battleType: this.type === 'arena' ? 'trainer' : this.type, usableMoveIndexes: getUsableMoveIndexes(this.active(index), this.state) });
            if(this.rules?.report !== false) this.emit(p, 'bagUpdated', { items: economy.bag(p) });
        }
        this.onUpdate?.(this);
    }
    enter(i, manual = false, initial = false) {
        const p = this.active(i); if (!p || effects.isDead(p) || !this.active(1-i)) return;
        this.recordEffortParticipation();
        if (!initial) this.sync(); // Publish the entrant before hazards, abilities or healing.
        engine.applySwitchInEffects(p, this.sides[i], this.sides[1-i], this.state, this.active(1-i)).forEach(m=>this.say(m));
        if (!initial)this.withDriftSignals(()=>effects.switched(p,manual));
    }
    recordEffortParticipation() {
        if (this.type === 'pvp') return;
        const pokemon = this.active(0), opponent = this.active(1);
        if (!(pokemon?.currentHp > 0) || !(opponent?.currentHp > 0) || pokemon.isEgg) return;
        this.effortParticipants ||= new Map();
        if (!this.effortParticipants.has(opponent.uuid)) this.effortParticipants.set(opponent.uuid, new Set());
        this.effortParticipants.get(opponent.uuid).add(pokemon.uuid);
    }
    rewardEffort(opponent) {
        if (this.type === 'pvp') return new Map();
        this.effortRewarded ||= new Set();
        if (this.effortRewarded.has(opponent.uuid)) return new Map();
        this.effortRewarded.add(opponent.uuid);
        // Old checkpoints cannot reconstruct earlier switches: retain their old
        // active-only reward until participation has been observed after resume.
        const participants = this.effortParticipants?.get(opponent.uuid)
            || (!this.effortParticipants ? new Set([this.active(0)?.uuid]) : new Set());
        return grantParticipantEffort(this.a.equipe.pokemons.filter(p=>!effects.isDead(p)||p.riftFainted), opponent, participants);
    }
    trainerSkill(p) {
        const wave=this.npcKey?.startsWith('colosseum_')?p.colosseumWave||this.a.run?.colosseum?.wave:null;
        return wave?Math.min(1,.55+Math.floor((wave-1)/5)*.15):1;
    }
    defaultAction(p) {
        if (this.replacementPhase && this.replacementPlayers?.has(p)) return {action:'change',number:replacementIndexes(p.equipe)[0]};
        if (getForcedMove(p.equipe.pokemons[0])) return {action:'attack',number:getUsableMoveIndexes(p.equipe.pokemons[0],this.state)[0]};
        if (p === this.b && p.npc && this.type !== 'wild') {
            const skill = this.trainerSkill(p);
            return trainerTactics.chooseAction(p.equipe,this.active(0),this.state,this.aiMemory,this.round,this.a.equipe.pokemons,skill);
        }
        const active = p.equipe.pokemons[0];
        const index=p===this.a?0:1;
        const usable = active ? preferMoves(active, this.state,undefined,{opponent:this.active(1-index),ownSide:this.sides[index],enemySide:this.sides[1-index],avoidStalePriority:true}) : [];
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
            if (p.npc || getForcedMove(p.equipe.pokemons[0])) this.pending.set(p, this.defaultAction(p));
            else this.emit(p,'requestAction',{ message: 'Choisis ton action · 30 secondes', turnId: this.token });
        }
        this.onUpdate?.(this);
        if (this.pending.size === 2) this.resolve();
    }
    promptReplacement(p) {
        this.emit(p,'requestAction',{ message:'Choisis le Pokémon à envoyer au combat.', turnId:this.token,
            replacement:true, replacementId:this.token, allowedPokemonIndexes:replacementIndexes(p.equipe) });
    }
    requestPivot(p, continuation) {
        this.turnContinuation = continuation;
        this.replacementPhase = true;
        this.replacementPlayers = new Set([p]);
        this.token = `${this.id}:pivot:${randomUUID()}`;
        this.pending.clear(); this.awaiting = true;
        this.deadline = this.now() + 60000;
        this.promptReplacement(p);
        this.onUpdate?.(this);
    }
    resume(p) {
        if (this.finished) return;
        this.recordEffortParticipation();
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
        if(kind==='bag' && this.rules?.bagAllowed===false || kind==='flee' && this.rules?.fleeAllowed===false) return false;
        if (kind === 'change' && (!Number.isInteger(payload.number) || payload.number <= 0 || !p.equipe.pokemons[payload.number] || effects.isDead(p.equipe.pokemons[payload.number]) || !engine.canSwitchOut(active, this.active(p === this.a ? 1 : 0), this.state))) return false;
        if (kind === 'flee' && this.type === 'wild' && !canFleeWildBattle(active, this.active(p === this.a ? 1 : 0), this.state)) return false;
        if (kind === 'attack' && !isMoveSelectionValid(active, payload.number, this.state)) {
            this.emit(p,'requestAction',{ message:'Cette capacité n’est pas disponible. Choisis une autre action.', turnId:this.token });
            return false;
        }
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
            if (this.rules?.permanentDeaths !== false && effects.isDead(old) && !old.riftFainted) p.equipe.pokemons = p.equipe.pokemons.filter(poke=>poke!==old);
        }
        this.sync();
        for (const p of replacements) this.enter(p===this.a?0:1);
        const continuation = this.turnContinuation;
        this.prune({deferReplacement: Boolean(continuation)});
        // A pivot pauses an unfinished turn. Resume it even if its hit ended
        // the opposing team, or its entrant fainted to hazards: residuals must
        // still run before a result or a new mandatory replacement.
        if (continuation) {
            delete this.turnContinuation;
            this.resolveAttacks(continuation);
            return;
        }
        if (!this.checkEnd()) {
            this.sync();
            this.request();
        }
    }
    prune({deferReplacement = false} = {}) {
        if ([0,1].some(i=>this.active(i) && effects.isDead(this.active(i)))) this.sync();
        for (const [index,p] of [this.a,this.b].entries()) {
            const old = this.active(index);
            this.processedFaints ||= new Set();
            const fainted = p.equipe.pokemons.filter(poke => effects.isDead(poke) && !poke.riftFainted && !this.processedFaints.has(poke.uuid));
            for (const poke of fainted) {
                this.processedFaints.add(poke.uuid);
                const protectedKO = this.rules?.permanentDeaths !== false && !p.npc && require('../items/heldItems').effect(poke, this.state) === 'rift_protection';
                if (protectedKO) {
                    poke.heldItem = null; poke.currentHp = 0; poke.riftFainted = true;
                    this.say(`${poke.truename || poke.name} est sauvé par son talisman ! Il reste K.O. jusqu’à un soin hors combat.`);
                    report.event(p,'protection',`Talisman consommé : ${poke.truename || poke.name} reste dans l’équipe à 0 PV.`);
                } else if (!p.npc && this.rules?.report !== false) report.lost(p,poke);
                effects.fainted(poke);
            }
            const needsChoice = !p.npc && effects.isDead(old) && hasAlivePokemon(p.equipe);
            p.equipe.pokemons = p.equipe.pokemons.filter(poke => this.rules?.permanentDeaths === false || !effects.isDead(poke) || poke.riftFainted || ((needsChoice || deferReplacement) && poke===old));
            if (p === this.b && this.type !== 'pvp') for (const defeated of fainted) this.reward(defeated);
            if (this.type === 'pvp' && fainted.length) [this.a,this.b][1-index].chain = Math.min(5, ([this.a,this.b][1-index].chain || 0) + fainted.length);
            if (!deferReplacement && p.npc && effects.isDead(old)) switchPokemonByIndex(p.equipe,trainerTactics.replacementIndex(p.equipe,{
                opponentTeam:[this.a,this.b][1-index].equipe.pokemons,field:this.state,ownSide:this.sides[index],enemySide:this.sides[1-index],
                memory:this.aiMemory,round:this.round,skill:this.trainerSkill(p)}));
            if (old !== this.active(index) && this.active(index)) this.enter(index);
        }
        if ([this.a,this.b].some(p=>p.equipe.pokemons.some(poke=>effects.isDead(poke) && !poke.riftFainted && !this.processedFaints.has(poke.uuid)))) this.prune({deferReplacement});
    }
    reward(defeated, {captured = false} = {}) {
        if (this.rewarded.has(defeated.uuid) || this.experienceRewarded?.has(defeated.uuid)) return;
        this.experienceRewarded ||= new Set();
        this.experienceRewarded.add(defeated.uuid);
        // Captures earn training without becoming KOs for contracts, streaks or scores.
        if (!captured) this.rewarded.add(defeated.uuid);
        if(this.rules?.rewards === false) return;
        const effort = this.rewardEffort(defeated);
        const active = this.a.equipe.pokemons.find(p=>!effects.isDead(p)); if (!active) return;
        const isColosseum = this.a.run?.mode === 'colosseum';
        const sharingBaseFor = recipient => {
            const bonus = effects.value(this.a,43) + (defeated.level > recipient.level ? effects.value(this.a,51) : 0);
            const baseXp = Math.max(1,Math.floor(calculateBattleExperience(defeated, EXPEDITION_EXPERIENCE_MULTIPLIERS[this.type] || EXPEDITION_EXPERIENCE_MULTIPLIERS.wild, recipient) * (1 + bonus/100)));
            return isColosseum ? Math.floor(baseXp * 48 / 10) : baseXp * 2;
        };
        // Evaluate each recipient before levelling anyone up; low-level reserves
        // catch up, while a high-level reserve cannot bypass the overlevel rule.
        const fighterXp = p => isColosseum ? Math.max(1,Math.floor(Math.floor(sharingBaseFor(p)*9/10)*4/5)) : sharingBaseFor(p);
        const expShare = require('../items/expShare').hasEquippedExpShare(this.a.equipe.pokemons);
        const reserveAwards = this.a.equipe.pokemons.filter(p=>p!==active && p.uuid!==defeated.uuid && !effects.isDead(p) && !p.isEgg).map(p=>[p,
            Math.max(Math.floor(sharingBaseFor(p) * ((isColosseum ? 40 : 0) + effects.value(this.a,50))/100),
                expShare ? Math.max(1,Math.floor(fighterXp(p)/2)) : 0)]);
        const sharingBase = sharingBaseFor(active);
        // Keep the Colosseum fighter multiplier and the existing reserve sharing rates.
        const fighterAward = isColosseum ? Math.max(1, Math.floor(Math.floor(sharingBase * 9 / 10) * 4 / 5)) : sharingBase;
        const xp = reduceActiveOverlevelExperience(fighterAward, defeated, active);
        const previousLevel = active.level, previousExperience = active.experience;
        const beforeGrowth = growthSnapshot(active);
        active.gainExperience(xp, {deferEvolution:true});
        this.emit(this.a,'battleExperience',{ pokemon: active, xpGained: xp, previousLevel, previousExperience, effortGained:effort.get(active.uuid)||{},levelGrowth:levelGrowth(active,beforeGrowth) });
        for (const [reserve, reserveXp] of reserveAwards) {
            const beforeLevel=reserve.level,beforeExperience=reserve.experience;
            const reserveGrowth=growthSnapshot(reserve);
            reserve.gainExperience(reserveXp, {deferEvolution:true});
            if (expShare && reserveXp > 0) this.emit(this.a,'battleExperience',{pokemon:reserve,xpGained:reserveXp,previousLevel:beforeLevel,previousExperience:beforeExperience,effortGained:effort.get(reserve.uuid)||{},levelGrowth:levelGrowth(reserve,reserveGrowth)});
        }
        if (!captured) this.a.chain = Math.min(5,(this.a.chain || 0)+1);
    }
    checkEnd() {
        const aliveA = hasAlivePokemon(this.a.equipe), aliveB = hasAlivePokemon(this.b.equipe);
        if (aliveA && aliveB) return false;
        this.finish(aliveA ? this.a : aliveB ? this.b : null, 'finished'); return true;
    }
    resolve() {
        if (this.finished || !this.awaiting || this.replacementPhase) return;
        this.awaiting = false;
        // The encounter kind is authoritative even for a pre-patch checkpoint.
        this.state.battleType=this.type;
        const actors = [this.a,this.b];
        for (const p of actors) if (this.pending.get(p)?.action === 'flee') {
            if (this.type === 'pvp') this.finish(p === this.a ? this.b : this.a, 'forfeit');
            else this.finish(null,'fled');
            return;
        }
        if (this.b.npc && this.type !== 'wild') {
            const command=this.pending.get(this.a),lead=this.active(0);
            require('../battle/humanTrainerAI').observeTurn(this.aiMemory,lead.uuid,lead,command.action);
        }
        planTurnActions(this.state, actors.map((p,index) => {
            const action = this.pending.get(p), pokemon = this.active(index);
            return { pokemon, action: action?.action,
                moveName: getForcedMove(pokemon) || (getUsableMoveIndexes(pokemon, this.state).length ? selectedMoveName(pokemon, action?.number) : 'Struggle') };
        }));
        for (const [i,p] of actors.entries()) {
            const action = this.pending.get(p);
            if (action?.action === 'change' && engine.canSwitchOut(this.active(i), this.active(1-i), this.state)) {
                if (p === this.b && p.npc && this.aiMemory) this.aiMemory.lastSwitchRound = this.round;
                switchPokemonByIndex(p.equipe, action.number); this.enter(i,true); this.prune({deferReplacement:true}); this.sync();
            }
            if (action?.action === 'bag') {
                p.items[action.itemKey]--;
                report.increment(p,'captureAttempts');
                const target = this.active(1), multiplier = getItemDefinition(action.itemKey).catch_multiplier;
                const chance = Math.min(.95, Math.max(.05,captureBaseChance(target)*multiplier*(1+effects.value(p,47)/100)));
                const success = this.random() < chance;
                this.emit(p,'captureAnimation',{ success, shakes: success ? 3 : 1, itemKey: action.itemKey });
                if (success) {
                    this.reward(target,{captured:true});
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
            const name = getForcedMove(pokemon) || (getUsableMoveIndexes(pokemon, this.state).length ? selectedMoveName(pokemon,action?.number) : 'Struggle');
            return { p, index, pokemon, name, moveName: name, side: this.sides[index], driftPriority: action?.action === 'attack' ? this.withDriftSignals(()=>effects.priority(pokemon,engine.getMoveByName(name))) : 0 };
        }), this.state, this.random);
        this.resolveAttacks(ordered.filter(a=>this.pending.get(a.p)?.action==='attack')
            .map(a=>({index:a.index,pokemonUuid:a.pokemon.uuid,name:a.name})));
    }
    resolveAttacks(actions) {
        const actors = [this.a,this.b];
        for (const [offset, action] of actions.entries()) {
            const { index, pokemonUuid, name } = action, p = actors[index], pokemon = this.active(index);
            if (pokemon?.uuid !== pokemonUuid || effects.isDead(pokemon)) continue;
            const defender = this.active(1-index); if (!defender || effects.isDead(defender)) continue;
            const animation = prepareMoveAnimation(pokemon,defender,name,this.state);
            const result = this.withDriftSignals(()=>engine.useattack(name,pokemon,defender,{ battleState:this.state, attackerSide:this.sides[index],defenderSide:this.sides[1-index],attackerTeam:p.equipe.pokemons,defenderTeam:actors[1-index].equipe.pokemons }), resolved => {
                (resolved.beforeActionMessages || []).forEach(m=>this.say(m));
                if (!resolved.actionPrevented) for (const [view,viewer] of actors.entries()) if (!viewer.npc) {
                    this.emit(viewer,'battleMoveAnimation',{...animation,actor:view===index?'player':'opponent'});
                }
            });
            if(p===this.a&&result.damage>0)(this.contractContributors ||= new Set()).add(pokemon.uuid);
            if (this.b.npc && !result.actionPrevented) {
                if (p === this.a) trainerTactics.observe(this.b.equipe,this.aiMemory,pokemon,name);
                else trainerTactics.observe(this.b.equipe,this.aiMemory,defender,name,result,pokemon);
            }
            this.withDriftSignals(()=>effects.afterMove(pokemon,defender,result,{ contact: Boolean(getMoveFlags(result.move).contact),
                status:(target,status,source)=>engine.applyStatus(target,status,target===pokemon?this.sides[index]:this.sides[1-index],result.messages,{attacker:source,battleState:this.state}),
                stage:(target,stat,delta)=>engine.applyStageChange(target,stat,delta,result.messages) }));
            afterActionMessages(result).forEach(m=>this.say(m));
            for (const [view,viewer] of actors.entries()) if(!viewer.npc) this.emit(viewer,'battleMoveResult',serializeMoveResult(view===index?'player':'opponent',result));
            this.sync(); // Damage and K.O. belong to the outgoing sprites, before XP or replacement.
            let attackerIndex;
            if (result.chooseSwitch && result.switchSelf && !effects.isDead(pokemon)) {
                if (!p.npc) {
                    this.requestPivot(p, actions.slice(offset+1));
                    return;
                }
                attackerIndex = trainerTactics.pivotIndex(p.equipe, {
                    opponentTeam:actors[1-index].equipe.pokemons, field:this.state,
                    ownSide:this.sides[index], enemySide:this.sides[1-index], memory:this.aiMemory
                });
            }
            const switched = resolveMoveSwitches(result,p.equipe,actors[1-index].equipe,{attackerIndex});
            if(switched.attacker) this.enter(index); if(switched.defender) this.enter(1-index);
            // Retain the outgoing fainted fighters until residuals have run;
            // neither an NPC reserve nor the result may skip this phase.
            this.prune({deferReplacement:true}); this.sync();
            if(result.escape && this.type==='wild') {this.escapeActor=index===0?'player':'opponent';this.finish(null,'fled'); return;}
        }
        this.withDriftSignals(()=>engine.processEndOfRound(this.active(0),this.active(1),this.sides[0],this.sides[1],this.state)).forEach(m=>this.say(m));
        this.withDriftSignals(()=>{effects.endTurn(this.active(0));effects.endTurn(this.active(1));});this.prune();
        if (!this.checkEnd()) { this.sync(); this.nextRoundAt = this.now() + this.paceMs; }
    }
    grantLoot(source) {
        const loot = economy.drop(this.a, source, this.random);
        this.resultTrackers.get(this.a).loot.push(...loot);
        if (loot.length) this.say(`Butin : ${loot.join(', ')}.`,true);
    }
    finish(winner = null, reason = 'timer') {
        if(this.finished) return; this.finished=true; this.awaiting=false;
        if(reason==='finished')this.sync();
        for (const p of [this.a,this.b]) p.equipe.pokemons = p.equipe.pokemons.filter(poke=>this.rules?.permanentDeaths === false || !effects.isDead(poke) || poke.riftFainted);
        for(const p of [this.a,this.b].filter(p=>!p.npc)){
            const initialTeam=this.originalTeams?.get(p)||this.resultTrackers?.get(p)?.initial.map(e=>e.pokemon)||[];
            for(const key of require('../battle/battleOutcome').recoverLostHeldItems(p,initialTeam)){
                const name=getItemDefinition(key)?.name||key;
                this.say(`${name} est récupéré dans le sac.`,true);
                if(this.rules?.report !== false) report.event(p,'item',`${name} récupéré après le combat.`);
            }
        }
        clearBattleTransientState(this.originals);
        for (const p of [this.a,this.b]) if (!p.npc) require('../battle/partyOrder').restorePartyOrder(p.equipe);
        for (const p of [this.a,this.b]) { p.inbattle=false; p.battle=null; }
        if (this.rules?.rewards !== false && winner === this.a && this.type === 'wild' && ['captured', 'finished'].includes(reason)) {
            const target = this.capturedPokemon || this.originals.find(p => this.rewarded.has(p.uuid));
            if (target) {
                const money = wildMoneyReward(target, 1 + effects.value(this.a,46) / 100);
                this.a.money += money;
                this.resultTrackers.get(this.a).money += money;
            }
        }
        if (this.rules?.rewards !== false && winner === this.a && reason === 'captured' && this.type === 'wild') this.grantLoot('capture');
        if(this.rules?.rewards !== false && winner===this.a && !['captured','timer','fled'].includes(reason) && this.type!=='pvp') {
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
        if(this.rules?.report !== false) require('./contracts').record(this.a,this,winner,reason);
        effects.detach(this.originals);
        for(const p of [this.a,this.b]) if(!p.npc) {
            if(this.rules?.report !== false) this.emit(p,'bagUpdated',{items:economy.bag(p)});
            if(this.rules?.report !== false) require('./fusion').consolidate(p);
            const payload = {
                playerWon: p === winner,
                battleType: this.type === 'arena' ? 'trainer' : this.type,
                reason,
                ...(this.escapeActor?{escapeActor:this.escapeActor}:{}),
                draw: !winner && reason === 'finished'
            };
            payload.summary = buildBattleSummary(payload, this.resultTrackers.get(p)
                .snapshot(p.equipe.pokemons, p === winner ? this.capturedPokemon : null));
            if(this.rules?.report !== false) report.battleFinished(p,this,payload.summary);
            this.emit(p,'endbattle',payload);
            this.emit(p,'teamStateChanged',{equipe:p.equipe,reason:'drift_battle_end'});
        }
        this.onFinish?.(this,winner,reason);
    }
}
module.exports = { DriftBattle };

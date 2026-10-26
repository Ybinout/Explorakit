const { getMapWeather } = require('../world/mapWeather');
const { WILD_ENCOUNTER_CHANCE } = require('../world/encounterRate');
const { randomUUID } = require('node:crypto');
const { DriftBattle } = require('./driftBattle');
const factory = require('./pokemonFactory');
const effects = require('./driftEffects');
const economy = require('./economy');
const report = require('./runReport');
const colosseum = require('./colosseum');
const contracts = require('./contracts');
const trainers = require('./trainers');
const { calculateAccountReward, MAX_EXPLORATION_MS } = require('./accountReward');
const { healTeam } = require('../world/playerRecovery');
const { clearBattleTransientState } = require('../battle/battleOutcome');
const { loadCollisionData, changeMapData, battleMapData, InteractMapData, getNextMap } = require('../world/mapRepository');
const { createPnjStore, isPnjBlockingTile } = require('../world/pnjStore');
const { tickRoaming } = require('../world/pnjMovement');
const { getSentenceForName, getSentenceForMapAndPosition, getEndSentenceInformation, getTeamInformation } = require('../world/interactionRepository');
const { createDialogueAuthorization, isDialogueCompletionAllowed } = require('../world/interactionAuthorization');
const { getPnjTeam } = require('../world/pnjTeamFactory');
const { getPokemonCenterEntryReturn, getPokemonCenterExit } = require('../world/pokemonCenterTravel');
const { sanitizeSpawnPosition, toPublicPlayer, getDirectionFromAction } = require('../../realtime/playerState');
const { isShopMap } = require('../world/shopCatalog');
const progression = require('../../../data/game/progression.json');
const { RECONNECT_MS } = require('./lobbyStore');
const { remainingRepel, stepRepel, repelsWild } = require('../items/repel');
const {devicesForMap,isNearComputer}=require('../world/pokemonComputer');
const computer=require('./pokemonComputer');
const collapse = require('../world/arenaCollapse');
const raphTrial = require('../world/raphTrial');
const stairways = require('../world/stairways');
const lucieScene = require('../world/lucieDeparture');
const ROOM = 'ville1_arene';

function createRunManager({ store, namespace, now = Date.now, random = Math.random, paceMs = 1800, durationMs = null, starterChoiceMs = 45000, accountRepository = null, colosseumRepository = null, revealWait = ms => new Promise(resolve=>setTimeout(resolve,ms)) }) {
    const runs = new Map();
    const personalPnjs = new WeakMap();
    const raphRevealing = new WeakSet();
    const lucieProgress=p=>({flags:{lucie_freed:p.defeated.has(lucieScene.config.actor)?'true':'false',lucie_departure:p.lucieDepartureSeen?'seen':''}});
    function pnjsFor(p) {
        if(!personalPnjs.has(p))personalPnjs.set(p,lucieScene.scopedStore(raphTrial.scopedStore(p.run.pnjs,()=>p.raphTrial),()=>lucieProgress(p),()=>p.lucieDeparture?.until>now()));
        return personalPnjs.get(p);
    }
    function ensureRaphTrial(p,map=p.currentmap,position=p) {
        if(map===raphTrial.config.map && p.run.phase==='exploration' && !p.defeated.has(raphTrial.config.champion))
            p.raphTrial=raphTrial.normalize(p.raphTrial)||raphTrial.create(position,random);
    }
    const repositoryFor = run => run.mode === 'colosseum' ? colosseumRepository : accountRepository;
    let storagePausedAt = null;
    function setStorageAvailable(available) {
        if (!available && storagePausedAt === null) storagePausedAt = now();
        if (available && storagePausedAt !== null) {
            const pause = now() - storagePausedAt;
            for (const run of runs.values()) {
                if(Number.isFinite(run.hozeCollapseStartedAt))run.hozeCollapseStartedAt+=pause;
                for (const key of ['startedAt', 'endsAt', 'selectionEndsAt', 'preparationEndsAt', 'closedAt', 'recoveredAt'])
                    if (Number.isFinite(run[key])) run[key] += pause;
                for (const player of run.players.values()) {
                    if (Number.isFinite(player.disconnectedAt)) player.disconnectedAt += pause;
                    if (Number.isFinite(player.hozeCollapseStartedAt)) player.hozeCollapseStartedAt += pause;
                }
                for (const battle of run.battles) for (const key of ['deadline', 'nextRoundAt'])
                    if (Number.isFinite(battle[key])) battle[key] += pause;
            }
            storagePausedAt = null;
        }
    }
    const playerFor = user => store.getLobby(user)?.run?.players.get(user.id);
    const emit = (p,event,payload) => {
        if(p.socketId && playerFor({id:p.userId})===p) namespace.to(p.socketId).emit(event,payload);
    };
    const fishing = require('../world/fishingController').createFishingController({
        now, random,
        ownsRod: p => p.items.fishing_rod > 0,
        available: p => p.alive && Boolean(p.socketId) && playerFor({id:p.userId})===p && p.run.phase==='exploration' && now()<p.run.endsAt && storagePausedAt===null && !p.run.recoveryWaiting && !p.inbattle && !p.inventoryBusy && p.equipe.pokemons.some(mon=>!effects.isDead(mon)),
        emit,
        onHook: p => {
            const encounter=require('../world/fishingEncounters').fishingEncounter(p.currentmap,random);
            if(!encounter || !p.alive || p.inbattle || p.run.phase!=='exploration' || now()>=p.run.endsAt)return;
            const wild=factory.create(encounter.id,encounter.level,false,random);
            require('./openingBalance').tuneWildMoves(wild);
            battle(p,{npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[],chain:0},'wild',null,null,'lake');
        }
    });
    function publicPlayers(run,map) {
        const result={}; for(const p of run.players.values()) if(p.alive && p.socketId && p.currentmap===map) result[p.socketId]=toPublicPlayer({...p,id:p.socketId});
        return result;
    }
    function state(p) {
        const run=p.run;
        if (run.colosseum?.next && !run.colosseum.next.preview)
            run.colosseum.next = colosseum.waveInfo(run.colosseum.next.wave, run.colosseum.version || 1);
        return { id:run.id, mode:run.mode || 'rift', durationMinutes:run.lobby.rules.durationMinutes, colosseum:run.colosseum ? { ...run.colosseum, ...(run.report ? { resultTeam:colosseum.recordTeam(run.report), defeat:colosseum.recordDefeat(run.report) } : {}) } : null, phase:run.phase, starterChoices:p.starterChoices || [], selectionEndsAt:run.selectionEndsAt || null, serverNow:now(), endsAt:run.endsAt, preparationEndsAt:run.preparationEndsAt,
            alive:p.alive, winnerId:run.winnerId, reason:p.eliminationReason, currentRound:run.round, ready:p.ready,spectatingAvailable:run.mode !== 'colosseum',
            storagePaused:storagePausedAt !== null, recoveredAt:run.recoveredAt || null, recoveryWaiting:Boolean(run.recoveryWaiting), slot:p.slot, slotLimit:economy.SLOT_LIMIT, money:p.money, drifts:p.drifts.map(d=>({...d,...require('./driftStrength').summary(d),salePrice:economy.salePrice(d)})), equipped:p.equipped, lastDriftFusion:p.lastDriftFusion || null,
            repelSteps:remainingRepel(p), team:p.equipe.pokemons, contracts:contracts.view(p), trainers:trainers.list(p), items:economy.bag(p), merchant:isShopMap(p.currentmap)&&run.phase==='exploration'?require('./merchant').view(p):null,
            players:[...run.players.values()].map(a=>({id:a.userId,username:a.username,alive:a.alive,ready:a.ready,
                connected:Boolean(a.socketId&&playerFor({id:a.userId})===a),inBattle:Boolean(a.inbattle),reason:a.eliminationReason||null})),
            matches:run.matches.map(m=>({id:m.id,round:m.round,players:m.players,status:m.status,winnerId:m.winnerId})),
            ...(run.settlement?{settlement:{status:run.settlement.status,coinsAwarded:run.settlement.coinsAwarded||0,
                ...(run.settlement.reward?{reward:run.settlement.reward}:{}),
                ...(run.settlement.ratings?{ratings:run.settlement.ratings}:{})}}:{}),
            ...(run.phase==='results'&&run.report?{report:run.report}:{}) };
    }
    function movementState(p) { return {id:p.run.id,repelSteps:remainingRepel(p)}; }
    function send(p) { emit(p,'drift:state',state(p)); }
    function publish(run) { for(const p of run.players.values()) send(p); }
    function stopSpectating(p, reason = 'stopped', final = {}) {
        if (!p?.watchingMatchId) return;
        const matchId = p.watchingMatchId;
        p.watchingMatchId = null;
        emit(p, 'drift:spectator', { ...final, active: false, matchId, reason });
    }
    function spectatorFrame(run, match, battle) {
        return { active: true, runId: run.id, matchId: match.id, round: match.round, ...battle.spectatorView() };
    }
    function publishSpectators(run, match, battle) {
        if (!match || battle.finished) return;
        for (const p of run.players.values()) if (p.watchingMatchId === match.id) emit(p, 'drift:spectator', spectatorFrame(run, match, battle));
    }
    function spectate(p, matchId) {
        if (!['preparation', 'tournament'].includes(p.run.phase) || p.inbattle || p.ready) economy.fail('Regarde un duel entre tes propres matchs.');
        const match = p.run.matches.find(m => m.id === matchId && m.status === 'battle');
        const battle = match && [...p.run.battles].find(b => !b.finished && b.matchId === match.id);
        if (!battle || match.players.includes(p.userId)) economy.fail('Ce duel n’est pas disponible.');
        stopSpectating(p);
        p.watchingMatchId = match.id;
        emit(p, 'drift:spectator', spectatorFrame(p.run, match, battle));
    }
    function settle(run) {
        const repository = repositoryFor(run);
        if (!repository || run.settlement?.status === 'complete' || run.settling || now() < (run.settleAfter || 0)) return;
        run.settlement = { status: 'pending', coinsAwarded: 0 };
        run.settling = Promise.resolve().then(() => repository.recordRunFinished({ id: run.id,
            players: [...run.players.values()].map(p => ({ id: p.userId, username: p.username })),
            winnerId: run.winnerId, finishedAt: run.finishedAt, explorationMs: run.explorationMs, report: run.report })).then(result => {
            run.settlement = { status: 'complete', coinsAwarded: result.coinsAwarded || 0,
                ...(result.reward ? { reward: result.reward } : {}), ...(result.ratings ? { ratings: result.ratings } : {}) };
            if (result.ratings && run.report) run.report = { ...run.report, ratingChanges: result.ratings };
            publish(run);
        }).catch(error => {
            run.settleAfter = now() + 5000;
            console.error('Règlement RiftMon à réessayer:', error.message);
        }).finally(() => { run.settling = null; });
    }
    function world(run) {
        for(const p of run.players.values()) if(p.socketId) emit(p,'playersList',publicPlayers(run,p.currentmap));
    }
    function showArenaEntry(p) {
        if (!p.alive || p.inbattle || p.run.phase !== 'exploration') return;
        if(p.currentmap===lucieScene.config.map && lucieScene.pending(lucieProgress(p))) {
            const name=lucieScene.config.dialogue;
            p.dialogue={...createDialogueAuthorization({name,map:p.currentmap,x:Math.floor(p.x/32),y:Math.floor(p.y/32)},now()),lucieDeparture:true};
            emit(p,'dialogue',[...getSentenceForName(name),{entryMap:p.currentmap}]);return;
        }
        const scene = require('../world/arenaScenes').entry(p, p.arenaEntriesSeen || {});
        if (!scene) return;
        p.dialogue = {...createDialogueAuthorization({name:scene.name,map:p.currentmap,x:Math.floor(p.x/32),y:Math.floor(p.y/32)},now()),arenaEntry:true};
        emit(p,'dialogue',[scene.sentences,scene.name,{entryMap:p.currentmap}]);
    }
    function syncCollapse(p,force=false) {
        if(p.currentmap!==collapse.config.map){if(force)emit(p,'arenaCollapseState',null);return;}
        p.hozeCollapseStartedAt ??= now();
        const start=p.hozeCollapseStartedAt,time=now();
        const stage=collapse.config.holes.filter(h=>collapse.elapsed(start,time)>=h.atMs).length;
        if(collapse.blocked(start,Math.floor(p.x/32),Math.floor(p.y/32),time)){
            const safe=collapse.safeTile(p,loadCollisionData(p.currentmap),start,time,(x,y)=>p.run.pnjs.isPnjBlockingTile(p.currentmap,x,y));
            if(safe){p.x=safe.x*32+16;p.y=safe.y*32+16;world(p.run);emit(p,'progressionNotice',{message:'Le sol cède ! Tu te mets à l’abri sur une dalle solide.'});}
        }
        if(force||p.hozeCollapseStage!==stage){p.hozeCollapseStage=stage;emit(p,'arenaCollapseState',collapse.snapshot(start,time));}
    }
    function moveTo(p,map,x,y) {
        fishing.cancel(p);
        stairways.clear(p);
        if(p.currentmap!==map) report.visit(p,map);
        ensureRaphTrial(p,map,{x,y});
        const safe=sanitizeSpawnPosition(x,y,loadCollisionData(map),map,{allowTransition:true,blocked:pnjsFor(p).isPnjBlockingTile}); p.currentmap=map;p.x=safe.x;p.y=safe.y;p.dialogue=null;
        emit(p,'newmap',{mapname:map,playersList:publicPlayers(p.run,map),reason:'drift'});
        emit(p,'mapWeatherState',getMapWeather(map));
        emit(p,'worldDevicesState',devicesForMap(map));
        emit(p,'pnjsList',{mapname:map,pnjs:p.run.phase==='exploration'?pnjsFor(p).getPnjsForMap(map):[]});
        syncCollapse(p,true);world(p.run);showArenaEntry(p);
    }
    function purge(p,reason) {
        fishing.cancel(p);
        if(!p.alive) return;
        report.endPlayer(p,reason,economy.bag(p));
        p.alive=false;p.eliminationReason=reason;p.ready=false;p.dialogue=null;
        clearBattleTransientState(p.equipe.pokemons);effects.detach(p.equipe.pokemons);
        p.storage=[];p.equipe={pokemons:[]};p.items={};p.drifts=[];p.equipped=[];p.money=0;p.defeated.clear();p.chain=0;p.centerReturnPoint=null;
        p.x=null;p.y=null;p.currentmap=null;p.slot=null;
    }
    function finishExploration(run, at = now()) {
        if (run.explorationMs == null) {
            if (run.phase === 'selection') { run.explorationMs = 0; return; }
            // Count only the expedition's server clock. Tournament time and SQL
            // retries must never increase a reward, nor may a late tick exceed the timer.
            run.explorationMs = Math.floor(Math.max(0, Math.min(MAX_EXPLORATION_MS,
                Math.min(at, run.endsAt) - run.startedAt)));
        }
    }
    function results(run,winner) {
        if(run.phase==='results') return;
        finishExploration(run);
        run.phase='results';run.winnerId=winner?.userId||null;run.finishedAt=now();run.closedAt=now()+120000;
        if (run.mode !== 'colosseum') run.accountReward = calculateAccountReward(run.participantCount, run.explorationMs, run.winnerId !== null);
        for(const battle of [...run.battles]) battle.finish(null,'closed');
        for(const p of run.players.values()) {
            if(p.alive) {const won=p===winner;purge(p,won?'winner':'finished');}
            emit(p,'teamStateChanged',{equipe:p.equipe,reason:'drift_finished'});
        }
        report.finish(run,now());
        settle(run);
        publish(run);world(run);
    }
    function checkSolo(run) {
        if(run.deferResolution||['results','transition'].includes(run.phase)) return;
        const alive=[...run.players.values()].filter(p=>p.alive);
        if (run.mode === 'colosseum') { if (!alive.length) results(run); return; }
        if(alive.length<=1) results(run,alive[0]);
    }
    function finishBattle(run,battle,winner,reason,match) {
        run.battles.delete(battle);
        if(match) for(const p of run.players.values()) if(p.watchingMatchId===match.id) stopSpectating(p,'finished',{
            ...spectatorFrame(run,match,battle),winnerId:winner?.userId||null });
        if(match) {match.status='finished';match.winnerId=winner?.userId||null;match.finishedAt=now();}
        for(const p of [battle.a,battle.b]) if(!p.npc) p.ready=false;
        if(run.phase==='results') return;
        if (run.mode === 'colosseum' && run.phase === 'colosseum_battle') {
            const p = battle.a;
            run.colosseum.lastTeam = colosseum.snapshotTeam(battle.originalTeams.get(p) || p.equipe.pokemons);
            if (winner === p && reason === 'finished' && p.equipe.pokemons.length) {
                run.colosseum.wins++;
                run.colosseum.score += colosseum.waveInfo(run.colosseum.wave, run.colosseum.version || 1).points;
                if (run.colosseum.version >= 2 && run.colosseum.wins % colosseum.milestoneSize(run.colosseum.version) === 0)
                    run.colosseum.reward = colosseum.rewardOffer(run.colosseum.wins, run.colosseum.version);
                prepareColosseum(run, p);
            } else {
                purge(p, ['fled', 'forfeit'].includes(reason) ? 'forfeit' : 'defeated');
                results(run);
            }
            return;
        }
        for(const p of [battle.a,battle.b]) if(!p.npc && (p.equipe.pokemons.length===0 || (match && p!==winner && reason!=='timer'))) purge(p,reason==='forfeit'?'forfeit':'defeated');
        publish(run);world(run);
        if(run.phase==='transition') return;
        if(match) advance(run); else checkSolo(run);
        if(battle.npcKey===lucieScene.config.actor && winner===battle.a && reason==='finished' && run.phase==='exploration' && battle.a.alive){
            const p=battle.a,name=lucieScene.config.dialogue;
            p.dialogue={...createDialogueAuthorization({name,map:p.currentmap,x:Math.floor(p.x/32),y:Math.floor(p.y/32)},now()),lucieDeparture:true};
            emit(p,'dialogue',[...getSentenceForName(name),{afterBattle:true}]);
        }
        const scene = require('../world/arenaScenes').scenes.find(s => s.champion === battle.npcKey && s.map === battle.a.currentmap);
        if (scene && winner === battle.a && reason === 'finished' && run.phase === 'exploration' && battle.a.alive) {
            const p=battle.a,name='arena_victory:'+scene.champion;
            p.dialogue={...createDialogueAuthorization({name,map:p.currentmap,x:Math.floor(p.x/32),y:Math.floor(p.y/32)},now()),arenaVictory:true};
            emit(p,'dialogue',[[{text:scene.sentences[0].text.split(' : ')[0]+' : Bien joué ! Tu as remporté ce duel. Bonne chance pour la suite de ton expédition.',imageName:scene.sentences[0].imageName}],name,{afterBattle:true}]);
        }
    }
    function battle(p,opponent,type,npcKey=null,match=null,environment=null) {
        const run=p.run;
        fishing.cancel(p);
        if (!p.equipe.pokemons.some(poke => !effects.isDead(poke))) economy.fail('Soigne un compagnon avant de combattre.');
        stopSpectating(p,'own_match');stopSpectating(opponent,'own_match');
        const b=new DriftBattle(p,opponent,{type,npcKey,emit,now,random,paceMs,environment,
            onUpdate:b=>publishSpectators(run,match,b),onFinish:(...args)=>finishBattle(run,...args,match)});
        b.matchId=match?.id||null;
        if(!b.finished) run.battles.add(b);
        publish(run); return b;
    }
    function safeSlots(count) {
        const collision=loadCollisionData(ROOM),changes=changeMapData(ROOM),slots=[];
        for(let y=10;y<Math.min(collision.length-2,16);y+=2) for(let x=4;x<collision[y].length-4;x+=2) {
            if(collision[y][x]===0&&!changes[y]?.[x]&&!isPnjBlockingTile(ROOM,x,y)) slots.push({x:x*32+16,y:y*32+16});
        }
        if(slots.length<count) throw new Error('Places de tournoi insuffisantes.');
        return slots.slice(0,count);
    }
    function prepareRound(run,participants) {
        for(const p of run.players.values()) {stopSpectating(p,'round');p.ready=false;}
        run.round++;run.phase='preparation';run.preparationEndsAt=now()+90000;
        const entries=participants.filter(p=>p?.alive);
        // Draw every round. An odd field grants exactly one bye; rotate it fairly.
        for(let i=entries.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[entries[i],entries[j]]=[entries[j],entries[i]];}
        if(entries.length%2) {
            const minimum=Math.min(...entries.map(p=>p.byeCount||0));
            const index=entries.findIndex(p=>(p.byeCount||0)===minimum);
            const [exempt]=entries.splice(index,1);exempt.byeCount=(exempt.byeCount||0)+1;
            entries.push(exempt,null);
        }
        const slots=safeSlots(participants.filter(Boolean).length);let slotIndex=0;
        for(let index=0;index<entries.length;index+=2) {
            const a=entries[index]||null,b=entries[index+1]||null;
            const match={id:randomUUID(),round:run.round,players:[a?.userId||null,b?.userId||null],status:a&&b?'waiting':'bye',winnerId:a&&!b?a.userId:b&&!a?b.userId:null};
            run.matches.push(match);
            for(const p of [a,b].filter(Boolean)) {
                p.ready=false;p.slot=slots[slotIndex++];if(run.round===1)p.chain=0;
                healTeam(p.equipe);moveTo(p,ROOM,p.slot.x,p.slot.y);
                report.tournament(p,run.round);
                emit(p,'teamStateChanged',{equipe:p.equipe,reason:'drift_round_heal'});
            }
        }
        publish(run);advance(run);
    }
    function advance(run) {
        if(run.deferResolution||!['preparation','tournament'].includes(run.phase)) return;
        const current=run.matches.filter(m=>m.round===run.round);
        if(current.some(m=>m.status==='waiting'||m.status==='battle')) return;
        const winners=current.map(m=>run.players.get(m.winnerId)).filter(p=>p?.alive);
        if(winners.length<=1) {results(run,winners[0]);return;}
        // A double K.O. removes both players before the next draw.
        prepareRound(run,winners);
    }
    function beginTournament(run) {
        if(run.phase!=='exploration') return;
        finishExploration(run);
        run.phase='transition';
        for(const b of [...run.battles]) b.finish(null,'timer');
        const survivors=[...run.players.values()].filter(p=>p.alive&&p.equipe.pokemons.length);
        if (run.mode === 'colosseum') {
            if (survivors.length) prepareColosseum(run, survivors[0]);
            else results(run);
            return;
        }
        if(survivors.length<=1) {results(run,survivors[0]);return;}
        prepareRound(run,survivors);
    }
    function prepareColosseum(run, p) {
        // Prune before healing, including a K.O. at the timer boundary.
        p.equipe.pokemons = p.equipe.pokemons.filter(pokemon => !effects.isDead(pokemon) || pokemon.riftFainted);
        if (!p.equipe.pokemons.length) { purge(p, 'defeated'); results(run); return; }
        healTeam(p.equipe);
        p.ready = false;
        run.phase = 'colosseum_ready';
        run.colosseum.next = colosseum.waveInfo(run.colosseum.wins + 1, run.colosseum.version || 1);
        p.slot = safeSlots(1)[0];
        if (run.colosseum.wave === 0) {
            run.colosseum.lastTeam = colosseum.snapshotTeam(p.equipe.pokemons);
            report.tournament(p, 1);
        }
        moveTo(p, ROOM, p.slot.x, p.slot.y);
        emit(p, 'teamStateChanged', { equipe: p.equipe, reason: 'colosseum_heal' });
        report.event(p, 'colosseum', `Colosseum : ${run.colosseum.score} points. Les survivants sont soignés.`);
        publish(run);
    }
    function startColosseum(user, options = {}) {
        const minutes = colosseum.durationMinutes(options?.durationMinutes);
        const existing = store.getLobby(user);
        if (existing && existing.rules.mode !== 'colosseum') economy.fail('Quitte ton salon Rift avant de lancer le Colosseum.');
        if (existing?.run && existing.run.phase !== 'results') return store.snapshot(user);
        if (existing?.run) store.leave(user);
        if (!store.getLobby(user)) store.create(user, { mode: 'colosseum', durationMinutes: minutes });
        store.ready(user, true);
        return start(user);
    }
    function chooseStarter(p, uuid) {
        if (!p.alive || p.run.phase!=='selection' || !p.starterChoices?.length) economy.fail('Le choix du compagnon est terminé.');
        const chosen=p.starterChoices.find(poke=>poke.uuid===uuid);
        if (!chosen) economy.fail('Choisis l’un des trois compagnons proposés.');
        p.equipe.pokemons=[chosen]; p.starterChoices=[]; report.init(p,now);
        if ([...p.run.players.values()].every(player=>!player.alive || !player.starterChoices?.length)) beginExploration(p.run);
        publish(p.run);
        return {success:true};
    }
    function beginExploration(run) {
        if (run.phase!=='selection') return;
        for(const p of run.players.values()) if(p.alive && p.starterChoices?.length) {
            p.equipe.pokemons=[p.starterChoices[0]];p.starterChoices=[];report.init(p,now);
        }
        run.phase='exploration';run.startedAt=now();run.endsAt=now()+run.explorationDuration;run.selectionEndsAt=null;
        publish(run);world(run);
    }
    function start(user) {
        const lobby=store.start(user);
        const roster=[...lobby.players.keys()].sort((a,b)=>a-b).join(',');
        const retryId=lobby.pendingStartRoster===roster?lobby.pendingStartId:null;
        const mode = lobby.rules.mode === 'colosseum' ? 'colosseum' : 'rift';
        const explorationDuration = mode === 'colosseum' ? colosseum.durationMinutes(lobby.rules.durationMinutes)*60000 : (durationMs ?? lobby.rules.durationMinutes*60000);
        const run={id:retryId||randomUUID(),mode,...(mode==='colosseum'?{colosseum:colosseum.initialState()}:{}),merchant:require('./merchant').createStock(random),explorationDuration,selectionEndsAt:starterChoiceMs>0?now()+starterChoiceMs:null,startedAt:now(),phase:starterChoiceMs>0?'selection':'exploration',endsAt:now()+explorationDuration,participantCount:lobby.players.size,players:new Map(),matches:[],round:0,battles:new Set(),winnerId:null,lobby,pnjs:createPnjStore(trainers.entries),pnjDeadlines:new Map()};
        for(const member of lobby.players.values()) {
            const choices=starterChoiceMs>0?factory.starterChoices(random, mode === 'colosseum' ? 10 : 0):[];
            const p={contracts:contracts.create(),starterChoices:choices,userId:member.id,username:member.username,run,alive:true,ready:false,equipe:{pokemons:choices.length?[]:[factory.starter(random, mode === 'colosseum' ? 10 : 0)]},
                currentmap:'start',x:80,y:208,sprite:'sprite.png',direction:'down',animationFrame:0,inbattle:false,battle:null,
                drifts:[],equipped:[],items:{pokeball:10,drift_potion:3},discoveredItems:new Set(),money:500,defeated:new Set(),chain:0,dialogue:null,lastMove:0,
                socketId:null,disconnectedAt:now()};
            run.players.set(p.userId,p);
        }
        const activate = () => {
            run.startedAt=now();run.endsAt=run.startedAt+explorationDuration;
            if(run.phase==='selection') run.selectionEndsAt=now()+starterChoiceMs;
            for(const p of run.players.values()) {p.disconnectedAt=now();report.init(p,now);}
            lobby.run=run;lobby.starting=false;delete lobby.pendingStartId;delete lobby.pendingStartRoster;runs.set(run.id,run);
            // Lobby sockets receive the phase and navigate to the existing world renderer.
            return store.snapshot(user);
        };
        const repository = repositoryFor(run);
        if (!repository) return activate();
        lobby.starting=true;lobby.pendingStartId=run.id;lobby.pendingStartRoster=roster;
        return Promise.resolve().then(() => repository.recordRunStarted({ id: run.id, durationMinutes: lobby.rules.durationMinutes,
            players: [...run.players.values()].map(p => ({ id: p.userId, username: p.username })) }))
            .then(activate).catch(error => { lobby.starting=false;throw error; });
    }
    function enter(user,socket,sprite,palette) {
        const p=playerFor(user); if(!p) economy.fail('Aucune expédition active.');
        p.lucieDeparture=null; // Its permanent run flag already records a started disappearance.
        if (sprite) p.sprite = sprite;
        if(palette!==undefined)p.spritePalette=require('../world/trainerPalette').normalizeTrainerPalette(palette);
        stopSpectating(p,'replaced');
        if(p.socketId && p.socketId!==socket.id) namespace.to(p.socketId).emit('drift:replaced',{});
        p.socketId=socket.id;p.disconnectedAt=null;
        contracts.migrate(p);require('./fusion').consolidate(p);
        if(p.alive) {
            ensureRaphTrial(p);
            // Author map replacements may invalidate an expedition checkpoint's world tile.
            Object.assign(p,sanitizeSpawnPosition(p.x,p.y,loadCollisionData(p.currentmap),p.currentmap,{blocked:pnjsFor(p).isPnjBlockingTile}));
            emit(p,'playersList',publicPlayers(p.run,p.currentmap));
            emit(p,'mapWeatherState',getMapWeather(p.currentmap));
            emit(p,'worldDevicesState',devicesForMap(p.currentmap));
            emit(p,'pnjsList',{mapname:p.currentmap,pnjs:p.run.phase==='exploration'?pnjsFor(p).getPnjsForMap(p.currentmap):[]});
            if(p.inbattle) {emit(p,'battletrigger',{trainerKey:p.battle.npcKey,battleType:p.battle.type,musicKind:p.battle.musicKind(),environment:p.battle.environment||null,field:require('../battle/battleEvents').serializeFieldState(p.battle.state,p===p.battle.b?'enemy':'player')});p.battle.resume(p);}
        }
        syncCollapse(p,true);send(p);world(p.run);showArenaEntry(p);return state(p);
    }
    function guard(user,socket,mutable=true) {
        const p=playerFor(user);
        if(!p || p.socketId!==socket.id) economy.fail('Cette expédition est ouverte dans un autre onglet.');
        if(p.run.recoveryWaiting)economy.fail('Reprise en attente des autres joueurs (5 minutes maximum).');
        if(p.run.phase==='selection'&&now()>=p.run.selectionEndsAt)beginExploration(p.run);
        if(p.run.phase==='exploration'&&now()>=p.run.endsAt) beginTournament(p.run);
        if(['preparation','tournament'].includes(p.run.phase)&&now()>=p.run.preparationEndsAt)tick();
        if(mutable && p.lucieDeparture?.until>now())economy.fail('Patiente un instant.');
        if(mutable) economy.requireMutable(p);
        return p;
    }
    function recoverPosition(p) {
        economy.requireMutable(p);
        if (p.inventoryBusy || p.run.phase!=='exploration') economy.fail('Déblocage disponible pendant l’exploration, hors combat.');
        if (Number.isFinite(p.lastPositionRecovery) && now()-p.lastPositionRecovery<10000) economy.fail('Patiente quelques secondes avant de réessayer.');
        const safe=sanitizeSpawnPosition(p.x,p.y,loadCollisionData(p.currentmap),p.currentmap,{manual:true,blocked:pnjsFor(p).isPnjBlockingTile});
        moveTo(p,p.currentmap,safe.x,safe.y);
        p.isMoving=false;p.isInteracting=false;p.animationFrame=0;p.lastMove=now();p.lastPositionRecovery=now();
        return {success:true,message:'Personnage replacé sur une case accessible à proximité.'};
    }
    function move(p,action) {
        if(getDirectionFromAction(action))fishing.cancel(p);
        if(!p.alive||p.inbattle||raphRevealing.has(p)||p.dialogue?.arenaEntry||p.dialogue?.lucieDeparture||p.lucieDeparture?.until>now()||p.run.phase!=='exploration'||now()-p.lastMove<130) return;
        const direction=getDirectionFromAction(action);if(!direction)return;
        const stair=stairways.departure(p,direction);
        if(stair){const from=p.currentmap;p.lastMove=now();p.direction=direction;p.isMoving=false;moveTo(p,stair.nextMap,stair.nextX,stair.nextY);stairways.arrived(p,from);return;}
        const delta={move_z:[0,-32],move_s:[0,32],move_q:[-32,0],move_d:[32,0]}[action];
        const x=p.x+delta[0],y=p.y+delta[1],tx=Math.floor(x/32),ty=Math.floor(y/32);
        if(p.currentmap===collapse.config.map&&Number.isFinite(p.hozeCollapseStartedAt)&&collapse.blocked(p.hozeCollapseStartedAt,tx,ty,now()))return;
        if(loadCollisionData(p.currentmap)[ty]?.[tx]!==0||pnjsFor(p).isPnjBlockingTile(p.currentmap,tx,ty))return;
        const previous={x:p.x,y:p.y};p.x=x;p.y=y;p.direction=direction;p.lastMove=now();p.dialogue=null;
        stairways.moved(p,previous);
        const repelProtection=stepRepel(p);
        if(repelProtection?.expired)emit(p,'progressionNotice',{message:'L’effet du Repousse est terminé.'});
        report.increment(p,'steps');
        for(const other of p.run.players.values()) if(other.alive&&other.currentmap===p.currentmap) emit(other,'playerMoved',{id:p.socketId,player:toPublicPlayer({...p,id:p.socketId})});
        if(changeMapData(p.currentmap)[ty]?.[tx]) {
            const next=getNextMap(p.currentmap,tx,ty);
            if(next?.staircase && next.triggerOnExit)return;
            const flags=Object.fromEntries([...p.defeated].flatMap(name=>Object.entries(progression.npcBattles[name]?.reward?.flags || {})));
            // Expeditions have no Adventure gate actors or key handover scenes.
            // Preserve their existing access rule without granting an Adventure key.
            if(p.defeated.has('champion_wanda'))flags.gwenn_house_key_received='true';
            const blocked=require('../world/storyProgression').transitionBlock(next,flags);
            if(blocked){emit(p,'progressionNotice',{message:blocked});return;}
            if(next){
                let destination={map:next.nextMap,x:next.nextX,y:next.nextY};
                if(p.currentmap==='centre')destination=getPokemonCenterExit(p.centerReturnPoint);
                else if(destination.map==='centre')p.centerReturnPoint=getPokemonCenterEntryReturn(p.currentmap,tx,ty,previous);
                moveTo(p,destination.map,destination.x,destination.y);return;
            }
        }
        if(p.equipe.pokemons.some(poke=>!effects.isDead(poke))&&battleMapData(p.currentmap)[ty]?.[tx]&&random()<WILD_ENCOUNTER_CHANCE) {
            const wild=factory.wild(p.currentmap,p,random);
            if(wild&&!repelsWild(repelProtection,wild))battle(p,{npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[],chain:0},'wild');
        }
    }
    async function revealRaph(p,state) {
        raphRevealing.add(p);
        const socketId=p.socketId;
        try {
            const wait=Math.max(0,state.availableAt-now());
            if(wait)await revealWait(wait);
            if(!p.alive||!p.socketId||p.socketId!==socketId||p.inbattle||p.run.phase!=='exploration'
                || now()>=p.run.endsAt || p.currentmap!==raphTrial.config.map
                || !raphTrial.ready(p.raphTrial,now())||!raphTrial.atDais(p))return;
            p.dialogue=createDialogueAuthorization({name:raphTrial.config.champion,map:p.currentmap,x:Math.floor(p.x/32),y:Math.floor(p.y/32)},now());
            endDialogue(p,raphTrial.config.champion);
        } finally {raphRevealing.delete(p);}
    }
    function interact(p) {
        if(raphRevealing.has(p)||p.inbattle||!p.alive)return;
        if (p.dialogue?.arenaEntry || p.dialogue?.lucieDeparture || p.lucieDeparture?.until>now()) return;
        if(p.run.phase!=='exploration')return;
        if(fishing.current(p)){fishing.reel(p,fishing.current(p).id);return;}
        if(isNearComputer(p)){emit(p,'pcOpened',computer.open(p));return;}
        const x=Math.floor(p.x/32),y=Math.floor(p.y/32);
        for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
            const tx=x+dx,ty=y+dy,pnj=pnjsFor(p).getPnjAtTile(p.currentmap,tx,ty);
            if(pnj?.interactionName===raphTrial.config.champion && p.raphTrial && !p.defeated.has(raphTrial.config.champion)) {
                if(p.dialogue)return;
                const result=raphTrial.advance(p.raphTrial,p,now(),random);p.raphTrial=result.state;
                if(result.changed) {
                    p.dialogue=null;
                    emit(p,'pnjsList',{mapname:p.currentmap,pnjs:pnjsFor(p).getPnjsForMap(p.currentmap),teleport:result.transition});
                    if(!result.state.revealed){const i=(result.state.step+raphTrial.config.messages.length-1)%raphTrial.config.messages.length;
                        emit(p,'progressionNotice',{message:raphTrial.config.messages[i],messageEn:raphTrial.config.messagesEn[i]});}
                }
                if(result.state?.revealed && raphTrial.atDais(p)) {
                    return revealRaph(p,result.state);
                }
                return;
            }
            const trainer=pnj&&trainers.find(pnj.interactionName);
            if(trainer){p.dialogue=createDialogueAuthorization({name:trainer.id,map:p.currentmap,x:tx,y:ty},now());emit(p,'expedition:trainerOffer',trainers.view(trainer,p));return;}
            const storyState=pnj?.interactionName==='lucie_route2'?{flags:{sevenp_defeated:p.defeated.has('champion_7p')?'true':'false',lucie_freed:p.defeated.has('lucie_route2')?'true':'false'}}:null;
            const sentence=pnj?getSentenceForName(pnj.interactionName||pnj.name,storyState):InteractMapData(p.currentmap)[ty]?.[tx]?getSentenceForMapAndPosition(p.currentmap,tx,ty):null;
            if(sentence){p.dialogue=createDialogueAuthorization({name:sentence[1],map:p.currentmap,x:tx,y:ty},now());emit(p,'dialogue',sentence);return;}
        }
        return fishing.offer(p);
    }
    function endDialogue(p,name) {
        if(p.run.phase==='exploration'&&p.dialogue?.lucieDeparture&&name===lucieScene.config.dialogue&&p.dialogue.map===p.currentmap&&lucieScene.pending(lucieProgress(p))) {
            p.dialogue=null;p.lucieDepartureSeen=true;p.lucieDeparture={id:require('node:crypto').randomUUID(),until:now()+lucieScene.config.duration};
            emit(p,'lucieDeparture',{...lucieScene.config,id:p.lucieDeparture.id,active:true});send(p);return;
        }
        if (p.run.phase==='exploration' && p.dialogue?.arenaVictory && p.dialogue.name===name && p.dialogue.map===p.currentmap) { p.dialogue=null; return; }
        if (p.run.phase==='exploration' && p.dialogue?.arenaEntry && p.dialogue.name===name && p.dialogue.map===p.currentmap) {
            p.arenaEntriesSeen ||= {}; p.arenaEntriesSeen[name]='true'; p.dialogue=null; send(p); return;
        }
        if(p.run.phase!=='exploration'||!isDialogueCompletionAllowed(p.dialogue,{name,map:p.currentmap,playerX:Math.floor(p.x/32),playerY:Math.floor(p.y/32)},now()))economy.fail('Dialogue expiré.');
        if(name===raphTrial.config.champion && !raphTrial.ready(p.raphTrial,now()))economy.fail('Retrouve d’abord Raph dans la salle.');
        p.dialogue=null;const trainer=trainers.find(name);
        if(trainer){if(p.defeated.has(name))economy.fail('Ce dresseur a déjà été vaincu dans cette expédition.');battle(p,trainers.opponent(trainer),'trainer',name);return;}
        const end=getEndSentenceInformation(name);
        if(end==='heal'){
            healTeam(p.equipe);
            if(p.currentmap==='centre')report.increment(p,'centerHeals');
            report.event(p,'heal',name==='dia0'?'Maman a soigné toute l’équipe.':'L’équipe est soignée au Centre Pokémon.');
            send(p);emit(p,'teamStateChanged',{equipe:p.equipe,reason:'heal'});
        }
        if(end==='shop'&&isShopMap(p.currentmap))emit(p,'shopOpened',economy.shop(p));
        if(end==='battle') {
            if(p.defeated.has(name)) {emit(p,'progressionNotice',{message:'Ce dresseur a déjà été vaincu dans cette expédition.'});return;}
            const team=getPnjTeam(getTeamInformation(name));if(!team?.pokemons.length)return;
            const def=progression.npcBattles?.[name];
            battle(p,{npc:true,equipe:team,drifts:[],equipped:[],chain:0},def?.battleType==='arena'||p.currentmap.includes('arene')?'arena':'trainer',name);
        }
    }
    function ready(p) {
        if (p.run.mode === 'colosseum') {
            if (p.run.phase !== 'colosseum_ready' || p.inbattle || !p.alive) economy.fail('Aucun défi du Colosseum en préparation.');
            const run = p.run;
            if (run.colosseum.reward) economy.fail('Choisis ta récompense de palier avant le prochain défi.');
            run.colosseum.wave = run.colosseum.wins + 1;
            run.colosseum.lastTeam = colosseum.snapshotTeam(p.equipe.pokemons);
            run.phase = 'colosseum_battle';
            battle(p, colosseum.opponent(run.colosseum.wave, run.colosseum.version || 1), 'arena', `colosseum_${run.colosseum.wave}`);
            return;
        }
        if(!['preparation','tournament'].includes(p.run.phase))economy.fail('Aucun round en préparation.');
        const match=p.run.matches.find(m=>m.round===p.run.round&&m.status==='waiting'&&m.players.includes(p.userId));
        if(!match)economy.fail('Tu attends le prochain round.');
        stopSpectating(p,'own_match');
        p.ready=true;moveTo(p,ROOM,p.slot.x,p.slot.y);
        const [a,b]=match.players.map(id=>p.run.players.get(id));
        if(a.ready&&b.ready){match.status='battle';match.startedAt=now();p.run.phase='tournament';battle(a,b,'pvp',null,match);}
        publish(p.run);
    }
    function abandon(p,reason='forfeit') {
        stopSpectating(p,'exit');
        if(!p?.alive)return;const run=p.run;
        if(p.battle) {const b=p.battle;purge(p,reason);b.finish(b.type==='pvp'?(b.a===p?b.b:b.a):null,'forfeit');}
        else {purge(p,reason);for(const m of run.matches.filter(m=>m.status==='waiting'&&m.players.includes(p.userId))){m.status='finished';m.finishedAt=now();m.winnerId=m.players.find(id=>id!==p.userId&&run.players.get(id)?.alive)||null;}advance(run);checkSolo(run);}
        publish(run);world(run);
    }
    function tick() {
        fishing.prune();
        if (storagePausedAt !== null) return;
        for(const run of [...runs.values()]) {
            if(run.recoveryWaiting) {
                if(now()-run.recoveredAt<300000 && [...run.players.values()].some(p=>p.alive&&!p.socketId))continue;
                const wait=now()-run.recoveredAt;
                for(const key of ['startedAt','endsAt','selectionEndsAt','preparationEndsAt'])if(Number.isFinite(run[key]))run[key]+=wait;
                for(const b of run.battles)for(const key of ['deadline','nextRoundAt'])if(Number.isFinite(b[key]))b[key]+=wait;
                if(Number.isFinite(run.hozeCollapseStartedAt))run.hozeCollapseStartedAt+=wait;
                for(const p of run.players.values())if(Number.isFinite(p.hozeCollapseStartedAt))p.hozeCollapseStartedAt+=wait;
                run.recoveryWaiting=false;
            }
            if(run.phase==='results') {
                settle(run);
                if(now()>=run.closedAt){
                    for(const p of run.players.values())if(store.getLobby({id:p.userId})===run.lobby)store.leave({id:p.userId});
                    if(!repositoryFor(run)||run.settlement?.status==='complete')runs.delete(run.id);
                }
                continue;
            }
            const expired=[...run.players.values()].filter(p=>p.alive&&p.disconnectedAt!==null&&now()-p.disconnectedAt>=RECONNECT_MS);
            if(expired.length) {
                // Resolve simultaneous absences together: the last expired account is not a winner.
                run.deferResolution=true;
                try {for(const p of expired)abandon(p,'disconnected');}
                finally {run.deferResolution=false;}
                advance(run);checkSolo(run);
            }
            if(run.phase==='selection' && now()>=run.selectionEndsAt) beginExploration(run);
            if(run.phase==='exploration'&&now()>=run.endsAt)beginTournament(run);
            if (run.phase === 'exploration') {
                const occupants = [...run.players.values()].filter(p => p.alive && p.socketId);
                for(const p of occupants)syncCollapse(p);
                const changed = tickRoaming(occupants, now(), run.pnjDeadlines, random, run.pnjs);
                for (const p of occupants) if (changed.has(p.currentmap)) emit(p, 'pnjsList', {
                    mapname: p.currentmap, pnjs: pnjsFor(p).getPnjsForMap(p.currentmap), walking: true
                });
            }
            for(const b of [...run.battles])b.tick();
            if(['preparation','tournament'].includes(run.phase)&&now()>=run.preparationEndsAt){
                for(const m of run.matches.filter(m=>m.round===run.round&&m.status==='waiting')) {
                    const candidates=m.players.map(id=>run.players.get(id)).filter(Boolean);
                    for(const p of candidates)if(!p.ready||!p.socketId)purge(p,'not_ready');
                    m.status='finished';m.finishedAt=now();m.winnerId=candidates.find(p=>p.alive)?.userId||null;
                }
                advance(run);
            }
            if (!run.lastPublished || now()-run.lastPublished>=1000) {run.lastPublished=now();publish(run);}
            for(const p of run.players.values())if(p.lucieDeparture&&now()>=p.lucieDeparture.until){p.lucieDeparture=null;emit(p,'lucieDeparture',{map:lucieScene.config.map,active:false});emit(p,'pnjsList',{mapname:p.currentmap,pnjs:pnjsFor(p).getPnjsForMap(p.currentmap)});}
        }
    }
    async function reconcileSettlements() {
        if (!runs.size) return;
        const receipts = [];
        for (const repository of [accountRepository, colosseumRepository]) {
            const ids = [...runs.values()].filter(run => repositoryFor(run) === repository).map(run => run.id);
            if (ids.length && repository?.getFinishedRuns) receipts.push(...await repository.getFinishedRuns(ids));
        }
        for (const receipt of receipts) {
            const run = runs.get(receipt.id);
            if (!run) continue;
            run.phase = 'results'; run.recoveryWaiting = false;
            run.winnerId = receipt.winnerId; run.finishedAt = receipt.finishedAt;
            run.closedAt = now() + 120000; run.explorationMs = receipt.reward?.explorationMs ?? (receipt.report.rules?.durationMinutes ?? 60)*60000;
            if (receipt.report.colosseum) run.colosseum = receipt.report.colosseum;
            for (const battle of run.battles) { battle.finished = true; battle.awaiting = false; }
            run.battles.clear();
            for (const player of run.players.values()) {
                player.inbattle = false; player.battle = null;
                const previous = receipt.report.players.find(entry => entry.id === player.userId);
                purge(player, previous?.reason || (player.userId === receipt.winnerId ? 'winner' : 'finished'));
            }
            run.report = receipt.report;
            run.settlement = { status: 'complete', coinsAwarded: receipt.coinsAwarded, reward: receipt.reward, ...(receipt.ratings ? {ratings:receipt.ratings} : {}) };
        }
    }
    function restore(saved, savedAt) {
        const downtime = Math.max(0, now() - savedAt);
        for (const run of saved.values()) {
            if(Number.isFinite(run.hozeCollapseStartedAt))run.hozeCollapseStartedAt+=downtime;
            for (const key of ['startedAt','endsAt','selectionEndsAt','preparationEndsAt','closedAt']) if (Number.isFinite(run[key])) run[key]+=downtime;
            run.pnjs=createPnjStore(trainers.entries); run.pnjDeadlines=new Map(); run.settling=null; run.settleAfter=0;
            run.recoveredAt=now(); run.recoveryWaiting=run.phase!=='results';
            for (const p of run.players.values()) {
                // Preserve visited players' old shared epoch, without advancing
                // a teammate who has never entered Hoze's room.
                if(!Number.isFinite(p.hozeCollapseStartedAt) && Number.isFinite(run.hozeCollapseStartedAt)
                    && (p.currentmap===collapse.config.map || Number.isFinite(p.hozeCollapseStage)))
                    p.hozeCollapseStartedAt=run.hozeCollapseStartedAt;
                else if(Number.isFinite(p.hozeCollapseStartedAt))p.hozeCollapseStartedAt+=downtime;
                p.socketId=null; p.disconnectedAt=now()+210000; p.dialogue=null; p.watchingMatchId=null;
                if (p.runReport) p.runReport.now=now;
                contracts.migrate(p);require('./fusion').consolidate(p);
            }
            for (const b of run.battles) {
                b.emit=emit; b.now=now; b.random=random;
                const match=run.matches.find(m=>m.id===b.matchId);
                b.onUpdate=battle=>publishSpectators(run,match,battle);
                b.onFinish=(...args)=>finishBattle(run,...args,match);
                for (const key of ['deadline','nextRoundAt']) if (Number.isFinite(b[key])) b[key]+=downtime+30000;
            }
            runs.set(run.id,run);
        }
    }
    return { movementState,fishing,reconcileSettlements,setStorageAvailable,restore,start,startColosseum,chooseStarter,enter,guard,recoverPosition,move,interact,endDialogue,ready,abandon,tick,send,publish,state,playerFor,battle,beginTournament,runs,spectate,stopSpectating,
        disconnect(user,socket){const p=playerFor(user);if(p?.socketId===socket.id){fishing.cancel(p);stopSpectating(p,'disconnected');p.socketId=null;p.disconnectedAt=now();world(p.run);}}};
}
module.exports={createRunManager};

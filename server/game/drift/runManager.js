const { randomUUID } = require('node:crypto');
const { DriftBattle } = require('./driftBattle');
const factory = require('./pokemonFactory');
const effects = require('./driftEffects');
const economy = require('./economy');
const report = require('./runReport');
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
const ROOM = 'ville1_arene';

function createRunManager({ store, namespace, now = Date.now, random = Math.random, paceMs = 1800, durationMs = null, accountRepository = null }) {
    const runs = new Map();
    let storagePausedAt = null;
    function setStorageAvailable(available) {
        if (!available && storagePausedAt === null) storagePausedAt = now();
        if (available && storagePausedAt !== null) {
            const pause = now() - storagePausedAt;
            for (const run of runs.values()) {
                for (const key of ['startedAt', 'endsAt', 'preparationEndsAt', 'closedAt', 'recoveredAt'])
                    if (Number.isFinite(run[key])) run[key] += pause;
                for (const player of run.players.values())
                    if (Number.isFinite(player.disconnectedAt)) player.disconnectedAt += pause;
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
    function publicPlayers(run,map) {
        const result={}; for(const p of run.players.values()) if(p.alive && p.socketId && p.currentmap===map) result[p.socketId]=toPublicPlayer({...p,id:p.socketId});
        return result;
    }
    function state(p) {
        const run=p.run;
        return { id:run.id, phase:run.phase, serverNow:now(), endsAt:run.endsAt, preparationEndsAt:run.preparationEndsAt,
            alive:p.alive, winnerId:run.winnerId, reason:p.eliminationReason, currentRound:run.round, ready:p.ready,spectatingAvailable:true,
            storagePaused:storagePausedAt !== null, recoveredAt:run.recoveredAt || null, recoveryWaiting:Boolean(run.recoveryWaiting), slot:p.slot, slotLimit:economy.SLOT_LIMIT, money:p.money, drifts:p.drifts, equipped:p.equipped,
            team:p.equipe.pokemons, items:economy.bag(p),
            players:[...run.players.values()].map(a=>({id:a.userId,username:a.username,alive:a.alive,ready:a.ready,
                connected:Boolean(a.socketId&&playerFor({id:a.userId})===a),inBattle:Boolean(a.inbattle),reason:a.eliminationReason||null})),
            matches:run.matches.map(m=>({id:m.id,round:m.round,players:m.players,status:m.status,winnerId:m.winnerId})),
            ...(run.settlement?{settlement:{status:run.settlement.status,coinsAwarded:run.settlement.coinsAwarded||0,
                ...(run.settlement.reward?{reward:run.settlement.reward}:{})}}:{}),
            ...(run.phase==='results'&&run.report?{report:run.report}:{}) };
    }
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
        if (!accountRepository || run.settlement?.status === 'complete' || run.settling || now() < (run.settleAfter || 0)) return;
        run.settlement = { status: 'pending', coinsAwarded: 0 };
        run.settling = Promise.resolve().then(() => accountRepository.recordRunFinished({ id: run.id,
            players: [...run.players.values()].map(p => ({ id: p.userId, username: p.username })),
            winnerId: run.winnerId, finishedAt: run.finishedAt, explorationMs: run.explorationMs, report: run.report })).then(result => {
            run.settlement = { status: 'complete', coinsAwarded: result.coinsAwarded || 0,
                ...(result.reward ? { reward: result.reward } : {}) };
            publish(run);
        }).catch(error => {
            run.settleAfter = now() + 5000;
            console.error('Règlement RiftMon à réessayer:', error.message);
        }).finally(() => { run.settling = null; });
    }
    function world(run) {
        for(const p of run.players.values()) if(p.socketId) emit(p,'playersList',publicPlayers(run,p.currentmap));
    }
    function moveTo(p,map,x,y) {
        if(p.currentmap!==map) report.visit(p,map);
        const safe=sanitizeSpawnPosition(x,y,loadCollisionData(map),map); p.currentmap=map;p.x=safe.x;p.y=safe.y;p.dialogue=null;
        emit(p,'newmap',{mapname:map,playersList:publicPlayers(p.run,map),reason:'drift'});
        emit(p,'pnjsList',{mapname:map,pnjs:p.run.phase==='exploration'?p.run.pnjs.getPnjsForMap(map):[]});
        world(p.run);
    }
    function purge(p,reason) {
        if(!p.alive) return;
        report.endPlayer(p,reason,economy.bag(p));
        p.alive=false;p.eliminationReason=reason;p.ready=false;p.dialogue=null;
        clearBattleTransientState(p.equipe.pokemons);effects.detach(p.equipe.pokemons);
        p.equipe={pokemons:[]};p.items={};p.drifts=[];p.equipped=[];p.money=0;p.defeated.clear();p.chain=0;p.centerReturnPoint=null;
        p.x=null;p.y=null;p.currentmap=null;p.slot=null;
    }
    function finishExploration(run, at = now()) {
        if (run.explorationMs == null) {
            // Count only the expedition's server clock. Tournament time and SQL
            // retries must never increase a reward, nor may a late tick exceed the timer.
            run.explorationMs = Math.floor(Math.max(0, Math.min(MAX_EXPLORATION_MS,
                Math.min(at, run.endsAt) - run.startedAt)));
        }
    }
    function results(run,winner) {
        if(run.phase==='results') return;
        run.phase='results';run.winnerId=winner?.userId||null;run.finishedAt=now();run.closedAt=now()+120000;
        finishExploration(run, run.finishedAt);
        run.accountReward = calculateAccountReward(run.participantCount, run.explorationMs, run.winnerId !== null);
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
        if(alive.length<=1) results(run,alive[0]);
    }
    function finishBattle(run,battle,winner,reason,match) {
        run.battles.delete(battle);
        if(match) for(const p of run.players.values()) if(p.watchingMatchId===match.id) stopSpectating(p,'finished',{
            ...spectatorFrame(run,match,battle),winnerId:winner?.userId||null });
        if(match) {match.status='finished';match.winnerId=winner?.userId||null;match.finishedAt=now();}
        for(const p of [battle.a,battle.b]) if(!p.npc) p.ready=false;
        if(run.phase==='results') return;
        for(const p of [battle.a,battle.b]) if(!p.npc && (p.equipe.pokemons.length===0 || (match && p!==winner && reason!=='timer'))) purge(p,reason==='forfeit'?'forfeit':'defeated');
        publish(run);world(run);
        if(run.phase==='transition') return;
        if(match) advance(run); else checkSolo(run);
    }
    function battle(p,opponent,type,npcKey=null,match=null) {
        const run=p.run;
        stopSpectating(p,'own_match');stopSpectating(opponent,'own_match');
        const b=new DriftBattle(p,opponent,{type,npcKey,emit,now,random,paceMs,
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
        if(survivors.length<=1) {results(run,survivors[0]);return;}
        prepareRound(run,survivors);
    }
    function start(user) {
        const lobby=store.start(user);
        const roster=[...lobby.players.keys()].sort((a,b)=>a-b).join(',');
        const retryId=lobby.pendingStartRoster===roster?lobby.pendingStartId:null;
        const run={id:retryId||randomUUID(),startedAt:now(),phase:'exploration',endsAt:now()+(durationMs ?? lobby.rules.durationMinutes*60000),participantCount:lobby.players.size,players:new Map(),matches:[],round:0,battles:new Set(),winnerId:null,lobby,pnjs:createPnjStore(),pnjDeadlines:new Map()};
        for(const member of lobby.players.values()) {
            const p={userId:member.id,username:member.username,run,alive:true,ready:false,equipe:{pokemons:[factory.starter(random)]},
                currentmap:'start',x:80,y:208,sprite:'sprite.png',direction:'down',animationFrame:0,inbattle:false,battle:null,
                drifts:[],equipped:[],items:{pokeball:10,drift_potion:3},money:500,defeated:new Set(),chain:0,dialogue:null,lastMove:0,
                socketId:null,disconnectedAt:now()};
            run.players.set(p.userId,p);
        }
        const activate = () => {
            run.startedAt=now();run.endsAt=run.startedAt+(durationMs ?? lobby.rules.durationMinutes*60000);
            for(const p of run.players.values()) {p.disconnectedAt=now();report.init(p,now);}
            lobby.run=run;lobby.starting=false;delete lobby.pendingStartId;delete lobby.pendingStartRoster;runs.set(run.id,run);
            // Lobby sockets receive the phase and navigate to the existing world renderer.
            return store.snapshot(user);
        };
        if (!accountRepository) return activate();
        lobby.starting=true;lobby.pendingStartId=run.id;lobby.pendingStartRoster=roster;
        return Promise.resolve().then(() => accountRepository.recordRunStarted({ id: run.id,
            players: [...run.players.values()].map(p => ({ id: p.userId, username: p.username })) }))
            .then(activate).catch(error => { lobby.starting=false;throw error; });
    }
    function enter(user,socket) {
        const p=playerFor(user); if(!p) economy.fail('Aucune expédition active.');
        stopSpectating(p,'replaced');
        if(p.socketId && p.socketId!==socket.id) namespace.to(p.socketId).emit('drift:replaced',{});
        p.socketId=socket.id;p.disconnectedAt=null;
        if(p.alive) {
            emit(p,'playersList',publicPlayers(p.run,p.currentmap));
            emit(p,'pnjsList',{mapname:p.currentmap,pnjs:p.run.phase==='exploration'?p.run.pnjs.getPnjsForMap(p.currentmap):[]});
            if(p.inbattle) {emit(p,'battletrigger',{battleType:p.battle.type});p.battle.resume(p);}
        }
        send(p);world(p.run);return state(p);
    }
    function guard(user,socket,mutable=true) {
        const p=playerFor(user);
        if(!p || p.socketId!==socket.id) economy.fail('Cette expédition est ouverte dans un autre onglet.');
        if(p.run.recoveryWaiting)economy.fail('Reprise en attente des autres joueurs (5 minutes maximum).');
        if(p.run.phase==='exploration'&&now()>=p.run.endsAt) beginTournament(p.run);
        if(['preparation','tournament'].includes(p.run.phase)&&now()>=p.run.preparationEndsAt)tick();
        if(mutable) economy.requireMutable(p);
        return p;
    }
    function move(p,action) {
        if(!p.alive||p.inbattle||p.run.phase!=='exploration'||now()-p.lastMove<130) return;
        const direction=getDirectionFromAction(action);if(!direction)return;
        const delta={move_z:[0,-32],move_s:[0,32],move_q:[-32,0],move_d:[32,0]}[action];
        const x=p.x+delta[0],y=p.y+delta[1],tx=Math.floor(x/32),ty=Math.floor(y/32);
        if(loadCollisionData(p.currentmap)[ty]?.[tx]!==0||p.run.pnjs.isPnjBlockingTile(p.currentmap,tx,ty))return;
        const previous={x:p.x,y:p.y};p.x=x;p.y=y;p.direction=direction;p.lastMove=now();p.dialogue=null;
        report.increment(p,'steps');
        for(const other of p.run.players.values()) if(other.alive&&other.currentmap===p.currentmap) emit(other,'playerMoved',{id:p.socketId,player:toPublicPlayer({...p,id:p.socketId})});
        if(changeMapData(p.currentmap)[ty]?.[tx]) {
            const next=getNextMap(p.currentmap,tx,ty);if(next){
                let destination={map:next.nextMap,x:next.nextX,y:next.nextY};
                if(p.currentmap==='centre')destination=getPokemonCenterExit(p.centerReturnPoint);
                else if(destination.map==='centre')p.centerReturnPoint=getPokemonCenterEntryReturn(p.currentmap,tx,ty,previous);
                moveTo(p,destination.map,destination.x,destination.y);return;
            }
        }
        if(battleMapData(p.currentmap)[ty]?.[tx]&&random()<1/15) {
            const wild=factory.wild(p.currentmap,p,random);
            if(wild)battle(p,{npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[],chain:0},'wild');
        }
    }
    function interact(p) {
        if(p.run.phase!=='exploration')return;
        const x=Math.floor(p.x/32),y=Math.floor(p.y/32);
        for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
            const tx=x+dx,ty=y+dy,pnj=p.run.pnjs.getPnjAtTile(p.currentmap,tx,ty);
            const sentence=pnj?getSentenceForName(pnj.interactionName||pnj.name):InteractMapData(p.currentmap)[ty]?.[tx]?getSentenceForMapAndPosition(p.currentmap,tx,ty):null;
            if(sentence){p.dialogue=createDialogueAuthorization({name:sentence[1],map:p.currentmap,x:tx,y:ty},now());emit(p,'dialogue',sentence);return;}
        }
    }
    function endDialogue(p,name) {
        if(p.run.phase!=='exploration'||!isDialogueCompletionAllowed(p.dialogue,{name,map:p.currentmap,playerX:Math.floor(p.x/32),playerY:Math.floor(p.y/32)},now()))economy.fail('Dialogue expiré.');
        p.dialogue=null;const end=getEndSentenceInformation(name);
        if(end==='heal'){healTeam(p.equipe);report.increment(p,'centerHeals');report.event(p,'heal','L’équipe est soignée au Centre Pokémon.');send(p);emit(p,'teamStateChanged',{equipe:p.equipe,reason:'heal'});}
        if(end==='shop'&&isShopMap(p.currentmap))emit(p,'shopOpened',economy.shop(p));
        if(end==='battle') {
            if(p.defeated.has(name)) {emit(p,'progressionNotice',{message:'Ce dresseur a déjà été vaincu dans cette expédition.'});return;}
            const team=getPnjTeam(getTeamInformation(name));if(!team?.pokemons.length)return;
            const def=progression.npcBattles?.[name];
            battle(p,{npc:true,equipe:team,drifts:[],equipped:[],chain:0},def?.battleType==='arena'||p.currentmap.includes('arene')?'arena':'trainer',name);
        }
    }
    function ready(p) {
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
        if (storagePausedAt !== null) return;
        for(const run of [...runs.values()]) {
            if(run.recoveryWaiting) {
                if(now()-run.recoveredAt<300000 && [...run.players.values()].some(p=>p.alive&&!p.socketId))continue;
                const wait=now()-run.recoveredAt;
                for(const key of ['startedAt','endsAt','preparationEndsAt'])if(Number.isFinite(run[key]))run[key]+=wait;
                for(const b of run.battles)for(const key of ['deadline','nextRoundAt'])if(Number.isFinite(b[key]))b[key]+=wait;
                run.recoveryWaiting=false;
            }
            if(run.phase==='results') {
                settle(run);
                if(now()>=run.closedAt){
                    for(const p of run.players.values())if(store.getLobby({id:p.userId})===run.lobby)store.leave({id:p.userId});
                    if(!accountRepository||run.settlement?.status==='complete')runs.delete(run.id);
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
            if(run.phase==='exploration'&&now()>=run.endsAt)beginTournament(run);
            if (run.phase === 'exploration') {
                const occupants = [...run.players.values()].filter(p => p.alive && p.socketId);
                const changed = tickRoaming(occupants, now(), run.pnjDeadlines, random, run.pnjs);
                for (const p of occupants) if (changed.has(p.currentmap)) emit(p, 'pnjsList', {
                    mapname: p.currentmap, pnjs: run.pnjs.getPnjsForMap(p.currentmap), walking: true
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
        }
    }
    async function reconcileSettlements() {
        if (!accountRepository?.getFinishedRuns || !runs.size) return;
        const receipts = await accountRepository.getFinishedRuns(runs.keys());
        for (const receipt of receipts) {
            const run = runs.get(receipt.id);
            if (!run) continue;
            run.phase = 'results'; run.recoveryWaiting = false;
            run.winnerId = receipt.winnerId; run.finishedAt = receipt.finishedAt;
            run.closedAt = now() + 120000; run.explorationMs = receipt.reward.explorationMs;
            for (const battle of run.battles) { battle.finished = true; battle.awaiting = false; }
            run.battles.clear();
            for (const player of run.players.values()) {
                player.inbattle = false; player.battle = null;
                const previous = receipt.report.players.find(entry => entry.id === player.userId);
                purge(player, previous?.reason || (player.userId === receipt.winnerId ? 'winner' : 'finished'));
            }
            run.report = receipt.report;
            run.settlement = { status: 'complete', coinsAwarded: receipt.coinsAwarded, reward: receipt.reward };
        }
    }
    function restore(saved, savedAt) {
        const downtime = Math.max(0, now() - savedAt);
        for (const run of saved.values()) {
            for (const key of ['startedAt','endsAt','preparationEndsAt','closedAt']) if (Number.isFinite(run[key])) run[key]+=downtime;
            run.pnjs=createPnjStore(); run.pnjDeadlines=new Map(); run.settling=null; run.settleAfter=0;
            run.recoveredAt=now(); run.recoveryWaiting=run.phase!=='results';
            for (const p of run.players.values()) {
                p.socketId=null; p.disconnectedAt=now()+210000; p.dialogue=null; p.watchingMatchId=null;
                if (p.runReport) p.runReport.now=now;
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
    return {reconcileSettlements,setStorageAvailable,restore,start,enter,guard,move,interact,endDialogue,ready,abandon,tick,send,publish,state,playerFor,battle,beginTournament,runs,spectate,stopSpectating,
        disconnect(user,socket){const p=playerFor(user);if(p?.socketId===socket.id){stopSpectating(p,'disconnected');p.socketId=null;p.disconnectedAt=now();world(p.run);}}};
}
module.exports={createRunManager};

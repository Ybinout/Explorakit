const content = require('../game/draft/content'),
    prep = require('../game/draft/preparation'),
    room = require('../game/draft/room');
const codec = require('../game/drift/checkpointCodec'),
    locks = require('../game/social/tradeLocks');
const { DriftBattle } = require('../game/drift/driftBattle');
const { onAccountEvent } = require('./accountConnection');
const servers = new WeakMap();
function createDraftManager(
    io,
    {
        store = require('../persistence/draftRepository'),
        now = Date.now,
        random = content.random,
        tickMs = 250,
        Battle = DriftBattle,
    } = {}
) {
    const tables = new Map(),
        members = new Map(),
        contexts = new Map(),
        queues = new Map();
    let stopped = false,
        ticking = false;
    const fail =
        prep.fail ||
        ((message) => {
            throw Object.assign(Error(message), { statusCode: 409 });
        });
    const ready = store.loadActive().then((runs) => {
        for (const r of runs) {
            for (const s of r.seats)
                if (s.userId) {
                    s.online = false;
                    s.disconnectedAt ||= now();
                }
            tables.set(r.id, r);
            index(r);
            bind(r);
            if (r.phase !== 'lobby')
                locks.acquire(
                    r.seats
                        .filter((s) => s.userId && !s.left && !s.eliminated)
                        .map((s) => s.userId),
                    'draft:' + r.id
                );
        }
    });
    function index(r) {
        for (const [id, table] of members)
            if (table === r.id) members.delete(id);
        if (!['finished', 'cancelled'].includes(r.phase))
            for (const s of r.seats)
                if (s.userId && !s.left && !s.eliminated)
                    members.set(s.userId, r.id);
    }
    function ctx(id) {
        const c = contexts.get(id);
        if (!c?.socket.connected || !c.account.active())
            fail('Connexion interrompue.');
        return c;
    }
    function free(id) {
        const c = ctx(id),
            p = c.getPlayer();
        if (
            !p ||
            p.inbattle ||
            p.inventoryBusy ||
            !c.canUse() ||
            locks.locked(id)
        )
            fail('Termine l’action en cours avant de rejoindre la draft.');
        if (p.currentmap !== room.MAP)
            fail('Rejoins la Maison des Drafts, à la Ville du Lac.');
        return c;
    }
    function current(id, data) {
        const r = tables.get(members.get(id));
        if (!r || data?.id !== r.id)
            fail('Cette partie n’est plus active. Rouvre la table.');
        return r;
    }
    function seat(r, id) {
        const s = r.seats.find((s) => s.userId === id && !s.left);
        if (!s) fail('Tu ne participes pas à cette partie.');
        return s;
    }
    function exclusive(id, work) {
        const before = queues.get(id) || Promise.resolve();
        const task = before.then(async () => {
            await ready;
            if (stopped) throw Error('Serveur en cours de fermeture.');
            return work();
        });
        const tail = task.catch(() => {});
        queues.set(id, tail);
        tail.finally(() => {
            if (queues.get(id) === tail) queues.delete(id);
        });
        return task;
    }
    function event(r, userId, name, data) {
        r._events ||= [];
        r._events.push([userId, name, JSON.parse(JSON.stringify(data))]);
    }
    function bind(r) {
        for (const m of r.matches || [])
            if (m.battle) {
                const b = m.battle;
                b.now = now;
                b.random = random;
                b.onUpdate = null;
                b.onFinish = (_b, winner, reason) => {
                    m.outcome = {
                        winner: winner ? winner.draftSeat : null,
                        reason,
                    };
                };
                b.emit = (actor, e, d) => {
                    const s = r.seats[actor.draftSeat];
                    if (!s?.userId || s.left || s.eliminated) return;
                    if (['teamStateChanged', 'bagUpdated'].includes(e)) return;
                    if (e === 'battletrigger')
                        d = {
                            ...d,
                            environment: 'draft-house',
                            musicKind: 'pvp',
                            draft: true,
                            message: 'Le duel de Draft commence !',
                            bagAllowed: false,
                        };
                    if (e === 'endbattle')
                        d = {
                            ...d,
                            draft: true,
                            summary: {
                                ...d.summary,
                                mode: 'draft',
                                money: 0,
                                loot: [],
                            },
                        };
                    event(r, s.userId, e, d);
                };
                for (const p of [b.a, b.b]) {
                    const c = contexts.get(r.seats[p.draftSeat].userId);
                    p.id = p.socketId =
                        c?.socket.id || 'draft:' + r.id + ':' + p.draftSeat;
                }
            }
    }
    function syncFlags(r) {
        for (const s of r.seats)
            if (s.userId) {
                const p = contexts.get(s.userId)?.getPlayer();
                const busy =
                    !s.left &&
                    !s.eliminated &&
                    !['lobby', 'finished', 'cancelled'].includes(r.phase);
                if (busy) {
                    locks.acquire([s.userId], 'draft:' + r.id);
                    if (p) {
                        p.__draftId = r.id;
                        p.inventoryBusy = true;
                        p.inbattle = !!matchFor(r, s.index);
                    }
                } else {
                    locks.release([s.userId], 'draft:' + r.id);
                    if (p?.__draftId === r.id) {
                        delete p.__draftId;
                        p.inventoryBusy = false;
                        p.inbattle = false;
                    }
                }
            }
    }
    function view(r, id) {
        const s = r.seats.find((s) => s.userId === id),
            active = s && matchFor(r, s.index);
        return {
            id: r.id,
            phase: r.phase,
            version: r.version,
            hostId: r.hostId,
            you: s?.index ?? -1,
            level: r.level,
            serverNow: now(),
            deadline: r.deadline || null,
            round: r.round,
            pick: r.pick,
            packSize:
                r.round === 4
                    ? content.config.riftPackSize
                    : content.config.packSize,
            moveCompatibility: content.config.moveCompatibility,
            abilityCompatibility: content.config.abilityCompatibility,
            participants: r.seats.map((s) => ({
                index: s.index,
                userId: s.userId,
                name: s.name,
                bot: !!s.bot,
                online: !!s.online,
                ready:
                    r.phase === 'draft'
                        ? r.choices?.[s.index] !== null
                        : !!s.plan?.confirmed,
                count: s.collection?.length || 0,
                remaining: r.packs?.[s.index]?.length || 0,
                rank: s.rank || null,
                eliminated: !!s.eliminated,
                forfeited: !!s.forfeited,
            })),
            pack:
                s && r.phase === 'draft'
                    ? (r.packs[s.index] || []).map((id) =>
                          content.view(r.cards.get(id))
                      )
                    : [],
            picked: s && r.phase === 'draft' ? r.choices[s.index] : null,
            collection:
                s && ['draft', 'preparation'].includes(r.phase)
                    ? s.collection.map((id) => content.view(r.cards.get(id)))
                    : [],
            preparation:
                s && r.phase === 'preparation'
                    ? {
                          ...s.plan,
                          used: prep.consumed(s.plan),
                          team: s.plan.slots.map((id) =>
                              id
                                  ? {
                                        cardId: id,
                                        ...require('../game/storage/pokemonStorage').view(
                                            [prep.build(r, s, id)],
                                            []
                                        ).team[0],
                                    }
                                  : null
                          ),
                      }
                    : null,
            finalists: r.finalists || null,
            finalDeadline: r.finalDeadline || null,
            finalReady: !!s?.finalReady,
            matches: (r.matches || []).map((m) => ({
                id: m.id,
                round: m.round,
                seats: m.seats,
                status: m.status,
                winner: m.winner,
                turn: m.battle?.round || 0,
            })),
            activeMatch: active
                ? {
                      id: active.id,
                      round: active.round,
                      turnId: active.battle.token,
                      rift: s.plan?.rift
                          ? content.view(r.cards.get(s.plan.rift))
                          : null,
                      opponentRift: (() => {
                          const other =
                              r.seats[active.seats.find((i) => i !== s.index)];
                          return other.plan?.rift
                              ? content.view(r.cards.get(other.plan.rift))
                              : null;
                      })(),
                  }
                : null,
            results:
                r.phase === 'finished'
                    ? r.seats.map((s) => ({
                          index: s.index,
                          name: s.name,
                          bot: !!s.bot,
                          rank: s.rank || 3,
                          reward: s.reward || 0,
                          forfeited: !!s.forfeited,
                          team: s.resultTeam || [],
                      }))
                    : null,
        };
    }
    function emit(r) {
        for (const s of r.seats)
            if (s.userId && !s.left) {
                const c = contexts.get(s.userId);
                if (c?.socket.connected)
                    c.socket.emit('draft:state', view(r, s.userId));
            }
    }
    async function atomic(r, work) {
        const existed = tables.has(r.id),
            before = codec.encode(r);
        r._events = [];
        try {
            await work(r);
            const events = r._events;
            delete r._events;
            const result = await store.save(r, r.version || 0);
            r.version = result.version;
            tables.set(r.id, r);
            index(r);
            syncFlags(r);
            emit(r);
            for (const [id, e, d] of events)
                contexts.get(id)?.socket.emit(e, d);
            for (const p of result.payments || [])
                contexts.get(p.userId)?.socket.emit('draft:wallet', p);
            return r;
        } catch (error) {
            const restored = codec.decode(before);
            delete restored._events;
            if (existed) {
                tables.set(r.id, restored);
                bind(restored);
                index(restored);
                syncFlags(restored);
            } else {
                tables.delete(r.id);
                for (const [id, key] of members)
                    if (key === r.id) members.delete(id);
            }
            throw error;
        }
    }
    function newSeat(index, id = null, name = 'Place libre') {
        return {
            index,
            userId: id,
            name,
            bot: false,
            online: !!id,
            collection: [],
            plan: null,
            left: false,
            eliminated: false,
        };
    }
    function catalog() {
        return [...tables.values()]
            .filter((r) => r.phase === 'lobby')
            .map((r) => ({
                id: r.id,
                host: r.seats.find((s) => s.userId === r.hostId)?.name,
                level: r.level,
                participants: r.seats.filter((s) => s.userId || s.bot).length,
            }));
    }
    async function create(id, data = {}) {
        return exclusive('lobby', async () => {
            if (members.has(id)) return view(tables.get(members.get(id)), id);
            const c = free(id),
                level = data.level ?? content.config.defaultLevel;
            if (!room.target(c.getPlayer()))
                fail('Approche-toi de la table ronde.');
            if (!content.config.levels.includes(level))
                fail('Choisis un niveau commun proposé par la table.');
            const r = {
                id: content.uuid(),
                hostId: id,
                phase: 'lobby',
                version: 0,
                level,
                seats: Array.from({ length: 4 }, (_, i) =>
                    newSeat(
                        i,
                        i === 0 ? id : null,
                        i === 0 ? c.username : 'Place libre'
                    )
                ),
                cards: new Map(),
                matches: [],
                invitations: [],
                deadline: now() + content.config.lobbyMs,
            };
            await atomic(r, () => {});
            return view(r, id);
        });
    }
    async function join(id, data) {
        return exclusive(data.id, async () => {
            if (members.has(id) && members.get(id) !== data.id)
                fail('Tu es déjà inscrit à une autre draft.');
            const c = free(id),
                r = tables.get(data.id);
            if (!r || r.phase !== 'lobby')
                fail('Cette table n’accepte plus de participants.');
            if (r.seats.some((s) => s.userId === id)) return view(r, id);
            await atomic(r, () => {
                const target = r.seats.find((s) => !s.userId && !s.bot);
                if (!target) fail('Les quatre places sont occupées.');
                Object.assign(target, newSeat(target.index, id, c.username));
            });
            return view(r, id);
        });
    }
    function openRound(r) {
        const special = r.round === content.config.classicRounds,
            size = special
                ? content.config.riftPackSize
                : content.config.packSize;
        r.pick = 0;
        r.packs = Array.from({ length: 4 }, () =>
            Array.from({ length: size }, () => {
                const card = content.createCard(r.level, random, special);
                r.cards.set(card.id, card);
                return card.id;
            })
        );
        r.choices = [null, null, null, null];
        r.deadline = now() + content.config.pickMs;
        botPicks(r);
    }
    function botPicks(r) {
        for (const s of r.seats)
            if (s.bot || s.left) {
                const pool = r.packs[s.index];
                r.choices[s.index] = [...pool].sort(
                    (a, b) =>
                        prep.pickScore(r.cards.get(b), r, s) -
                        prep.pickScore(r.cards.get(a), r, s)
                )[0];
            }
    }
    function pass(r) {
        for (let i = 0; i < 4; i++) {
            const id = r.choices[i],
                pack = r.packs[i];
            if (!pack.includes(id)) fail('Choix Draft incohérent.');
            r.seats[i].collection.push(id);
            pack.splice(pack.indexOf(id), 1);
        }
        if (!r.packs[0].length) {
            r.round++;
            if (r.round > content.config.classicRounds) {
                r.phase = 'preparation';
                r.deadline = now() + content.config.preparationMs;
                for (const s of r.seats) {
                    s.plan = prep.empty();
                    if (s.bot || s.left) prep.finalize(r, s);
                }
                return;
            }
            openRound(r);
            return;
        }
        const old = r.packs;
        r.packs = old.map((_, i) => old[(i + 3) % 4]);
        r.pick++;
        r.choices = [null, null, null, null];
        r.deadline = now() + content.config.pickMs;
        botPicks(r);
    }
    async function start(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data);
            if (r.hostId !== id || r.phase !== 'lobby')
                fail('Seul l’hôte peut lancer cette table.');
            for (const s of r.seats.filter((s) => s.userId)) free(s.userId);
            locks.acquire(
                r.seats.filter((s) => s.userId).map((s) => s.userId),
                'draft:' + r.id
            );
            for (const s of r.seats.filter((s) => s.userId)) {
                const p = ctx(s.userId).getPlayer();
                p.__draftId = r.id;
                p.inventoryBusy = true;
            }
            await atomic(r, () => {
                for (const s of r.seats)
                    if (!s.userId)
                        Object.assign(s, {
                            bot: true,
                            name:
                                ['Ada', 'Basile', 'Céleste', 'Dorian'][
                                    s.index
                                ] + ' · IA',
                        });
                r.phase = 'draft';
                r.round = 0;
                openRound(r);
            });
            return view(r, id);
        });
    }
    async function pick(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data),
                s = seat(r, id);
            if (
                r.phase !== 'draft' ||
                data.round !== r.round ||
                data.pick !== r.pick ||
                now() >= r.deadline
            )
                fail('Ce booster a déjà circulé.');
            await atomic(r, () => {
                if (r.choices[s.index] !== null)
                    fail('Tu as déjà choisi ta carte.');
                if (!r.packs[s.index].includes(data.cardId))
                    fail('Cette carte n’est pas dans ton booster.');
                r.choices[s.index] = data.cardId;
                if (r.choices.every(Boolean)) pass(r);
            });
            return view(r, id);
        });
    }
    async function edit(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data),
                s = seat(r, id);
            if (r.phase !== 'preparation' || now() >= r.deadline)
                fail('La préparation est terminée.');
            await atomic(r, () => {
                prep.edit(r, s, data);
                for (const id of Object.keys(s.plan.attachments))
                    prep.build(r, s, id);
            });
            return view(r, id);
        });
    }
    async function confirm(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data),
                s = seat(r, id);
            if (r.phase !== 'preparation' || now() >= r.deadline)
                fail('La préparation est terminée.');
            await atomic(r, () => {
                prep.validate(r, s);
                s.plan.confirmed = true;
                if (r.seats.every((s) => s.plan.confirmed)) tournament(r);
            });
            return view(r, id);
        });
    }
    function actor(r, index) {
        const s = r.seats[index],
            p = {
                id: 'draft:' + r.id + ':' + index,
                socketId: contexts.get(s.userId)?.socket.id,
                userId: s.userId,
                username: s.name,
                draftSeat: index,
                npc: false,
                currentmap: room.MAP,
                equipe: { pokemons: prep.team(r, s) },
                drifts: [],
                equipped: [],
                items: {},
                money: 0,
                defeated: new Set(),
            };
        p.draftRift = s.plan.rift ? r.cards.get(s.plan.rift).rift : null;
        return p;
    }
    function matchFor(r, index) {
        return (r.matches || []).find(
            (m) => m.status === 'active' && m.seats.includes(index)
        );
    }
    function makeMatch(r, a, b, round) {
        const m = {
            id: content.uuid(),
            round,
            seats: [a, b],
            status: 'active',
            winner: null,
            startedAt: now(),
            memories: [{ seen: {} }, { seen: {} }],
        };
        r.matches.push(m);
        const alive = (i) =>
            !r.seats[i].forfeited && r.seats[i].plan.slots.some(Boolean);
        if (!alive(a) || !alive(b)) {
            m.status = 'finished';
            m.winner = alive(a) ? a : alive(b) ? b : null;
            return m;
        }
        m.battle = new Battle(actor(r, a), actor(r, b), {
            type: 'pvp',
            now,
            random,
            paceMs: 1800,
            rules: {
                rewards: false,
                report: false,
                permanentDeaths: false,
                bagAllowed: false,
                fleeAllowed: true,
                restoreBerries: true,
                musicKind: 'pvp',
            },
            emit: () => {},
        });
        bind(r);
        for (const p of [m.battle.a, m.battle.b]) {
            const s = r.seats[p.draftSeat];
            if (s.userId) {
                event(r, s.userId, 'battletrigger', {
                    battleType: 'pvp',
                    musicKind: 'pvp',
                    environment: 'draft-house',
                    draft: true,
                    bagAllowed: false,
                    message: 'Le duel de Draft commence !',
                });
                m.battle.resume(p);
            }
        }
        return m;
    }
    function tournament(r) {
        r.phase = 'tournament';
        r.deadline = null;
        makeMatch(r, 0, 1, 'semi');
        makeMatch(r, 2, 3, 'semi');
        advance(r);
    }
    function advance(r) {
        for (const m of r.matches.filter(
            (m) => m.status === 'active' && m.battle.finished
        )) {
            m.status = 'finished';
            const b = m.battle;
            const alive = [b.a, b.b].map((p) =>
                p.equipe.pokemons.some((p) => p.currentHp > 0)
            );
            m.winner = m.outcome
                ? m.outcome.winner
                : alive[0] && !alive[1]
                ? m.seats[0]
                : alive[1] && !alive[0]
                ? m.seats[1]
                : m.forfeitWinner ?? null;
        }
        const semis = r.matches.filter((m) => m.round === 'semi');
        for (const m of semis.filter((m) => m.status === 'finished'))
            for (const i of m.seats)
                if (i !== m.winner) {
                    r.seats[i].rank = 3;
                    r.seats[i].eliminated = true;
                }
        if (
            semis.length === 2 &&
            semis.every((m) => m.status === 'finished') &&
            !r.matches.some((m) => m.round === 'final')
        ) {
            const winners = semis.map((m) => m.winner);
            if (winners.every((i) => i !== null)) {
                if (!r.finalists) {
                    r.finalists = winners;
                    r.finalDeadline = now() + 60000;
                }
                if (
                    now() >= r.finalDeadline ||
                    winners.every(
                        (i) => r.seats[i].bot || r.seats[i].finalReady
                    )
                )
                    makeMatch(r, winners[0], winners[1], 'final');
            } else {
                const winner = winners.find((i) => i !== null);
                if (winner !== undefined) r.seats[winner].rank = 1;
                finish(r);
                return;
            }
        }
        const final = r.matches.find((m) => m.round === 'final');
        if (final?.status === 'finished') {
            for (const i of final.seats)
                r.seats[i].rank = i === final.winner ? 1 : 2;
            finish(r);
        }
    }
    function finish(r) {
        r.phase = 'finished';
        r.finishedAt = now();
        r.deadline = null;
        for (const s of r.seats) {
            s.resultTeam = s.plan
                ? prep.team(r, s).map((p) => ({ id: p.data.id, k: p.k }))
                : [];
            s.rank ||= 3;
            s.plan = null;
            s.collection = [];
        }
        r.cards = new Map();
        r.packs = null;
        r.choices = null;
        for (const m of r.matches) {delete m.battle;delete m.memories;}
    }
    function botAction(m, index) {
        const b = m.battle,
            p = [b.a, b.b][index],
            other = [b.a, b.b][1 - index];
        if (b.replacementPhase) {
            if (!b.replacementPlayers.has(p)) return null;
            const indexes =
                require('../game/battle/replacementChoice').replacementIndexes(
                    p.equipe
                );
            const choice =
                require('../game/battle/humanTrainerAI').chooseReplacement({
                    team: indexes.map((i) => p.equipe.pokemons[i]),
                    opponentTeam: other.equipe.pokemons,
                    field: b.state,
                    ownSide: b.sides[index],
                    enemySide: b.sides[1 - index],
                    memory: m.memories[index],
                    round: b.round,
                    skill: 1,
                });
            return { action: 'change', number: indexes[choice] ?? indexes[0] };
        }
        return require('../game/battle/humanTrainerAI').chooseAction({
            team: p.equipe.pokemons,
            opponentTeam: other.equipe.pokemons,
            field: b.state,
            ownSide: b.sides[index],
            enemySide: b.sides[1 - index],
            memory: m.memories[index],
            round: b.round,
            skill: 1,
        });
    }
    async function action(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data),
                s = seat(r, id),
                m = matchFor(r, s.index);
            if (!m || data.matchId !== m.id) fail('Ce duel est terminé.');
            await atomic(r, () => {
                if (
                    !m.battle.action(
                        [m.battle.a, m.battle.b][m.seats.indexOf(s.index)],
                        data
                    )
                )
                    fail('Cette action n’est plus disponible.');
                advance(r);
            });
            return view(r, id);
        });
    }
    async function leave(id, data) {
        return exclusive(data.id, async () => {
            const r = tables.get(data.id),
                s = r && seat(r, id);
            if (!r) fail('Cette table est déjà fermée.');
            await atomic(r, () => {
                s.left = true;
                if (
                    !s.eliminated &&
                    !['finished', 'cancelled'].includes(r.phase)
                )
                    s.forfeited = true;
                s.online = false;
                if (r.phase === 'lobby') {
                    Object.assign(s, newSeat(s.index));
                    if (r.hostId === id) {
                        const next = r.seats.find((s) => s.userId);
                        if (next) r.hostId = next.userId;
                        else {
                            r.phase = 'cancelled';
                            r.finishedAt = now();
                        }
                    }
                } else {
                    if (r.seats.filter((s) => s.userId).every((s) => s.left)) {
                        r.phase = 'cancelled';
                        r.finishedAt = now();
                        r.cards.clear();
                        for (const m of r.matches || [])
                            if (m.battle) {
                                require('../game/drift/driftEffects').detach(
                                    m.battle.originals
                                );
                                delete m.battle;
                            }
                        return;
                    }
                    if (r.phase === 'draft') botPicks(r);
                    if (r.phase === 'preparation' && !s.plan.confirmed)
                        prep.finalize(r, s);
                    const m = matchFor(r, s.index);
                    if (m) {
                        const winner = m.seats.find((i) => i !== s.index);
                        m.forfeitWinner = winner;
                        m.battle.finish(
                            [m.battle.a, m.battle.b][m.seats.indexOf(winner)],
                            'forfeit'
                        );
                        advance(r);
                    }
                }
            });
            const c = contexts.get(id);
            locks.release([id], 'draft:' + r.id);
            if (c?.getPlayer()?.__draftId === r.id) {
                delete c.getPlayer().__draftId;
                c.getPlayer().inventoryBusy = false;
                c.getPlayer().inbattle = false;
            }
            c?.socket.emit('draft:state', null);
            return { left: true };
        });
    }
    async function tick() {
        for (const [id, r] of tables)
            if (
                ['finished', 'cancelled'].includes(r.phase) &&
                now() - (r.finishedAt || now()) > 300000
            )
                tables.delete(id);
        if (ticking || stopped) return;
        ticking = true;
        try {
            await ready;
            for (const r0 of tables.values())
                if (!['finished', 'cancelled'].includes(r0.phase))
                    await exclusive(r0.id, async () => {
                        let r = tables.get(r0.id);
                        const need =
                            r.phase === 'lobby'
                                ? now() >= r.deadline ||
                                  r.seats.some(
                                      (s) =>
                                          s.userId === r.hostId &&
                                          !s.online &&
                                          now() - (s.disconnectedAt || now()) >=
                                              content.config.reconnectMs
                                  )
                                : r.phase === 'draft'
                                ? now() >= r.deadline ||
                                  r.choices.every(Boolean)
                                : r.phase === 'preparation'
                                ? now() >= r.deadline ||
                                  r.seats.every((s) => s.plan.confirmed)
                                : (r.finalists &&
                                      !r.matches.some(
                                          (m) => m.round === 'final'
                                      ) &&
                                      (now() >= r.finalDeadline ||
                                          r.finalists.every(
                                              (i) =>
                                                  r.seats[i].bot ||
                                                  r.seats[i].finalReady
                                          ))) ||
                                  r.matches.some(
                                      (m) =>
                                          m.status === 'active' &&
                                          (now() - m.startedAt >=
                                              content.config.maximumMatchMs ||
                                              (!m.battle.awaiting &&
                                                  now() >=
                                                      m.battle.nextRoundAt) ||
                                              (m.battle.awaiting &&
                                                  (now() >= m.battle.deadline ||
                                                      m.seats.some(
                                                          (s, i) =>
                                                              r.seats[s].bot &&
                                                              !m.battle.pending.has(
                                                                  [
                                                                      m.battle
                                                                          .a,
                                                                      m.battle
                                                                          .b,
                                                                  ][i]
                                                              )
                                                      ))))
                                  );
                        const offline =
                            r.phase !== 'lobby' &&
                            r.seats.some(
                                (s) =>
                                    s.userId &&
                                    !s.left &&
                                    !s.eliminated &&
                                    !s.online &&
                                    now() - (s.disconnectedAt || now()) >=
                                        content.config.reconnectMs
                            );
                        if (!need && !offline) return;
                        await atomic(r, () => {
                            if (r.phase === 'lobby') {
                                const next = r.seats.find(
                                    (s) => s.userId && s.online
                                );
                                if (now() >= r.deadline || !next) {
                                    r.phase = 'cancelled';
                                    r.finishedAt = now();
                                    return;
                                }
                                const old = r.seats.find(
                                    (s) => s.userId === r.hostId
                                );
                                Object.assign(old, newSeat(old.index));
                                r.hostId = next.userId;
                                return;
                            }
                            for (const s of r.seats)
                                if (
                                    s.userId &&
                                    !s.left &&
                                    !s.eliminated &&
                                    !s.online &&
                                    now() - (s.disconnectedAt || now()) >=
                                        content.config.reconnectMs
                                ) {
                                    s.forfeited = true;
                                    s.bot = true;
                                    s.left = true;
                                    const m = matchFor(r, s.index);
                                    if (m) {
                                        m.forfeitWinner = m.seats.find(
                                            (i) => i !== s.index
                                        );
                                        m.battle.finish(
                                            [m.battle.a, m.battle.b][
                                                m.seats.indexOf(m.forfeitWinner)
                                            ],
                                            'forfeit'
                                        );
                                    }
                                }
                            if (r.phase === 'draft') {
                                if (now() >= r.deadline)
                                    for (let i = 0; i < 4; i++)
                                        if (!r.choices[i])
                                            r.choices[i] = content.choose(
                                                r.packs[i],
                                                random
                                            );
                                if (r.choices.every(Boolean)) pass(r);
                            }
                            if (r.phase === 'preparation') {
                                if (now() >= r.deadline)
                                    for (const s of r.seats)
                                        if (!s.plan.confirmed)
                                            prep.finalize(r, s);
                                if (r.seats.every((s) => s.plan.confirmed))
                                    tournament(r);
                            }
                            if (r.phase === 'tournament') {
                                for (const m of r.matches.filter(
                                    (m) => m.status === 'active'
                                )) {
                                    const b = m.battle;
                                    if (
                                        now() - m.startedAt >=
                                        content.config.maximumMatchMs
                                    )
                                        b.finish(null, 'draw');
                                    else {
                                        b.tick();
                                        if (b.awaiting)
                                            for (let i = 0; i < 2; i++)
                                                if (
                                                    r.seats[m.seats[i]].bot &&
                                                    !b.pending.has(
                                                        [b.a, b.b][i]
                                                    )
                                                ) {
                                                    const command = botAction(
                                                        m,
                                                        i
                                                    );
                                                    if (command)
                                                        b.action(
                                                            [b.a, b.b][i],
                                                            {
                                                                ...command,
                                                                turnId: b.token,
                                                            }
                                                        );
                                                }
                                    }
                                }
                                advance(r);
                            }
                        });
                    });
        } catch (e) {
            console.error('Draft :', e.message);
        } finally {
            ticking = false;
        }
    }
    async function invite(id, data) {
        const target = Number(data.userId);
        if (!Number.isInteger(target) || target === id) fail('Choisis un ami.');
        if (
            (await require('../persistence/trainerRepository').relationship(
                id,
                target
            )) !== 'friends'
        )
            fail('Les invitations sont réservées à tes amis.');
        return exclusive(data.id, async () => {
            const r = current(id, data);
            if (r.phase !== 'lobby' || r.hostId !== id)
                fail('Seul l’hôte peut inviter avant la draft.');
            const other = ctx(target);
            if (members.has(target))
                fail('Cet ami participe déjà à une draft.');
            await atomic(r, () => {
                const previous = r.invitations.findLast(
                    (i) => i.target === target
                );
                if (previous && previous.expiresAt > now())
                    fail('Une invitation a déjà été envoyée.');
                const i = {
                    id: content.uuid(),
                    tableId: r.id,
                    target,
                    host: ctx(id).username,
                    expiresAt: now() + 120000,
                };
                r.invitations = r.invitations.filter(
                    (i) => i.expiresAt > now()
                );
                r.invitations.push(i);
                event(r, target, 'draft:invitation', i);
            });
            return { invited: other.username };
        });
    }
    async function bots(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data);
            if (r.phase !== 'lobby' || r.hostId !== id)
                fail('Seul l’hôte peut compléter sa table.');
            await atomic(r, () => {
                for (const s of r.seats)
                    if (!s.userId)
                        Object.assign(s, {
                            bot: data.fill !== false,
                            name:
                                data.fill === false
                                    ? 'Place libre'
                                    : ['Ada', 'Basile', 'Céleste', 'Dorian'][
                                          s.index
                                      ] + ' · IA',
                        });
            });
            return { state: view(r, id) };
        });
    }
    async function nextFinal(id, data) {
        return exclusive(data.id, async () => {
            const r = current(id, data),
                s = seat(r, id);
            if (
                !r.finalists?.includes(s.index) ||
                r.matches.some((m) => m.round === 'final')
            )
                fail('La finale n’attend pas de confirmation.');
            await atomic(r, () => {
                s.finalReady = true;
                advance(r);
            });
            return { state: view(r, id) };
        });
    }
    function attach(c) {
        contexts.set(c.id, c);
        const handlers = {};
        let period = 0,
            calls = 0;
        const command = (name, fn) =>
            onAccountEvent(
                c.socket,
                'draft:' + name,
                async (data = {}, ack) => {
                    try {
                        if (
                            !data ||
                            typeof data !== 'object' ||
                            Array.isArray(data)
                        )
                            fail('Requête Draft invalide.');
                        if (
                            data.id !== undefined &&
                            (typeof data.id !== 'string' ||
                                !/^[a-f0-9-]{36}$/.test(data.id))
                        )
                            fail('Identifiant de draft invalide.');
                        if (now() > period) {
                            period = now() + 10000;
                            calls = 0;
                        }
                        if (++calls > 80)
                            fail('Patiente un instant avant de réessayer.');
                        const value = await fn(data);
                        if (typeof ack === 'function')
                            ack({ success: true, ...value });
                    } catch (error) {
                        if (typeof ack === 'function')
                            ack({
                                success: false,
                                message: error.code
                                    ? 'Service Draft indisponible. Réessaie.'
                                    : error.message,
                            });
                    }
                }
            );
        command('open', async () => {
            await ready;
            const r = tables.get(members.get(c.id));
            if (r) {
                c.socket.emit('draft:open', view(r, c.id));
                return { state: view(r, c.id) };
            }
            free(c.id);
            if (!room.target(c.getPlayer()))
                fail('Approche-toi de la table ronde.');
            const payload = {
                tables: catalog(),
                levels: content.config.levels,
                defaultLevel: content.config.defaultLevel,
            };
            c.socket.emit('draft:open', payload);
            return payload;
        });
        command('friends', async () => ({
            friends: (
                await require('../persistence/trainerRepository').friends(c.id)
            ).accepted.map((f) => ({
                id: f.id,
                name: f.username,
                online: !!contexts.get(f.id)?.socket.connected,
                here: contexts.get(f.id)?.getPlayer()?.currentmap === room.MAP,
            })),
        }));
        command('invite', (d) => invite(c.id, d));
        command('bots', (d) => bots(c.id, d));
        command('continue', (d) => nextFinal(c.id, d));
        command('accept', async (d) => {
            const r = tables.get(d.id);
            if (
                !r?.invitations.some(
                    (i) =>
                        i.id === d.invitationId &&
                        i.target === c.id &&
                        i.expiresAt > now()
                )
            )
                fail('Cette invitation n’est plus disponible.');
            return { state: await join(c.id, d) };
        });
        command('create', (d) => create(c.id, d).then((state) => ({ state })));
        command('join', (d) => join(c.id, d).then((state) => ({ state })));
        command('start', (d) => start(c.id, d).then((state) => ({ state })));
        command('pick', (d) => pick(c.id, d).then((state) => ({ state })));
        command('edit', (d) => edit(c.id, d).then((state) => ({ state })));
        command('confirm', (d) =>
            confirm(c.id, d).then((state) => ({ state }))
        );
        command('action', (d) => action(c.id, d).then((state) => ({ state })));
        command('leave', (d) => leave(c.id, d));
        command('refresh', async (d) =>
            exclusive(members.get(c.id) || 'refresh:' + c.id, async () => {
                const r = tables.get(members.get(c.id));
                if (r) {
                    if (draftPlaying(r, c.id)) {
                        bind(r);
                        const m = matchFor(r, seat(r, c.id).index);
                        if (!d.battleSync)
                            c.socket.emit('battletrigger', {
                                battleType: 'pvp',
                                environment: 'draft-house',
                                musicKind: 'pvp',
                                draft: true,
                                resumed: true,
                                bagAllowed: false,
                            });
                        m.battle.resume(
                            [m.battle.a, m.battle.b][
                                m.seats.indexOf(seat(r, c.id).index)
                            ]
                        );
                        for (const [id, e, d] of r._events || [])
                            contexts.get(id)?.socket.emit(e, d);
                        delete r._events;
                    }
                    return { state: view(r, c.id) };
                }
                return { state: null };
            })
        );
        handlers.initialize = async () => {
            await ready;
            for (const r of tables.values())
                if (r.phase === 'lobby')
                    for (const i of r.invitations || [])
                        if (i.target === c.id && i.expiresAt > now())
                            c.socket.emit('draft:invitation', i);
            const r = tables.get(members.get(c.id));
            if (r)
                await exclusive(r.id, () =>
                    atomic(r, () => {
                        const s = seat(r, c.id);
                        s.online = true;
                        s.disconnectedAt = null;
                        bind(r);
                        syncFlags(r);
                        if (draftPlaying(r, c.id)) {
                            event(r, c.id, 'battletrigger', {
                                battleType: 'pvp',
                                environment: 'draft-house',
                                musicKind: 'pvp',
                                draft: true,
                                resumed: true,
                                bagAllowed: false,
                            });
                            const m = matchFor(r, s.index);
                            m.battle.resume(
                                [m.battle.a, m.battle.b][
                                    m.seats.indexOf(s.index)
                                ]
                            );
                        }
                    })
                );
        };
        handlers.interact = async () => {
            if (!room.target(c.getPlayer())) return false;
            const r = tables.get(members.get(c.id));
            c.socket.emit(
                'draft:open',
                r
                    ? view(r, c.id)
                    : {
                          tables: catalog(),
                          levels: content.config.levels,
                          defaultLevel: content.config.defaultLevel,
                      }
            );
            return true;
        };
        c.account.onClose(() =>
            stopped
                ? Promise.resolve(contexts.delete(c.id))
                : exclusive(members.get(c.id) || 'detach', async () => {
                      if (contexts.get(c.id) !== c) return;
                      const r = tables.get(members.get(c.id));
                      contexts.delete(c.id);
                      if (r)
                          await atomic(r, () => {
                              const s = seat(r, c.id);
                              s.online = false;
                              s.disconnectedAt = now();
                          });
                  })
        );
        return handlers;
    }
    function draftPlaying(r, id) {
        const s = r.seats.find((s) => s.userId === id);
        return r.phase === 'tournament' && s && !!matchFor(r, s.index);
    }
    const timer = tickMs ? setInterval(() => void tick(), tickMs) : null;
    timer?.unref();
    return {
        ready,
        attach,
        tick,
        tables,
        contexts,
        view,
        create,
        join,
        start,
        pick,
        edit,
        confirm,
        action,
        leave,
        async stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            await Promise.all([...queues.values()]);
            for (const r of tables.values())
                for (const s of r.seats)
                    if (s.userId) {
                        locks.release([s.userId], 'draft:' + r.id);
                        const p = contexts.get(s.userId)?.getPlayer();
                        if (p?.__draftId === r.id) {
                            delete p.__draftId;
                            p.inventoryBusy = false;
                            p.inbattle = false;
                        }
                    }
        },
    };
}
function getDraftManager(io) {
    if (!servers.has(io)) servers.set(io, createDraftManager(io));
    return servers.get(io);
}
module.exports = { createDraftManager, getDraftManager };

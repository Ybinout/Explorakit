const catalogue = require('../../../data/game/drifts.json');
const moveDefinitions = new Map(require('../../../data/game/moves.json').map(move => [move.ename, move]));
const definitions = new Map(catalogue.definitions.map(drift => [drift.id, drift]));
const npcNames = new Map(require('../../../data/game/interact.json')
    .filter(dialogue => dialogue.end === 'battle')
    .map(dialogue => [dialogue.name, dialogue.sentences?.[0]?.text?.match(/^([^:]{1,60}) : /)?.[1]?.trim()])
    .filter(([, name]) => name));
const MAX_EVENTS = 500;
const MAX_COLLECTION = 1000;
const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
const COUNTERS = ['battles', 'wildWins', 'trainerWins', 'arenaWins', 'pvpWins', 'defeats', 'draws', 'interrupted',
    'fled', 'captures', 'captureAttempts', 'pokemonLost', 'xpGained', 'levelsGained', 'moneyEarned', 'moneySpent',
    'driftsFound', 'driftsSold', 'driftsDiscarded', 'potionsUsed', 'centerHeals', 'steps', 'evolutions'];
const copy = value => JSON.parse(JSON.stringify(value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
function timestamp(p) { return p.runReport?.now() ?? Date.now(); }
function increment(p, key, amount = 1) {
    if (p.runReport) p.runReport.stats[key] = (p.runReport.stats[key] || 0) + Math.max(0, finite(amount));
}
function event(p, type, text, map = null) {
    const report = p.runReport;
    if (!report) return;
    if (report.events.length === MAX_EVENTS) { report.events.shift(); report.eventsOmitted++; }
    report.events.push({ at: timestamp(p), type, text: String(text).slice(0, 300), ...(map ? { map } : {}) });
}
function pokemonSnapshot(pokemon, previous = {}, at = 0, source = 'team') {
    const stats = Object.fromEntries(STAT_KEYS.map(key => [key, finite(key === 'hp' ? pokemon.maxHp : pokemon[key])]));
    const normalized = object => Object.fromEntries(STAT_KEYS.map(key => [key, finite(object?.[key])]));
    const moves = (pokemon.__moveAndStatOverrides?.abilities || pokemon.abilities || []).slice(0, 4);
    return {
        uuid: pokemon.uuid, pokemonId: finite(pokemon.data?.id), name: pokemon.truename || pokemon.name || 'Pokémon',
        level: finite(pokemon.level), initialLevel: previous.initialLevel ?? finite(pokemon.level),
        nature: pokemon.nature || 'Bashful', types: (pokemon.data?.type || []).slice(0, 2), moves: [...moves],
        moveNames: moves.map(move => moveDefinitions.get(move)?.fname || move),
        stats, ivs: normalized(pokemon.iv), evs: normalized(pokemon.ev), potential: finite(pokemon.k),
        passiveAbility: pokemon.__passiveAbilityBeforeBattle || pokemon.passiveAbility || null,
        heldItem: Object.hasOwn(pokemon,'__heldItemBeforeExchange') ? pokemon.__heldItemBeforeExchange : pokemon.heldItem || null,
        experience: finite(pokemon.experience), currentHp: finite(pokemon.currentHp),
        obtainedAt: previous.obtainedAt ?? at, source: previous.source || source, lostAt: previous.lostAt ?? null
    };
}
function rememberPokemon(p, pokemon, source = 'team') {
    const report = p.runReport;
    if (!report || !pokemon?.uuid) return null;
    const old = report.pokemon.get(pokemon.uuid);
    if (!old && report.pokemon.size >= MAX_COLLECTION) {
        // Keep current companions even in an unusually long run; forget the oldest memorial first.
        const oldest = [...report.pokemon.values()].find(entry => entry.lostAt !== null)
            || [...report.pokemon.values()].find(entry => !p.equipe.pokemons.some(current => current.uuid === entry.uuid));
        if (!oldest) return null;
        report.pokemon.delete(oldest.uuid); report.pokemonOmitted++;
    }
    const snapshot = pokemonSnapshot(pokemon, old, timestamp(p), source);
    report.pokemon.set(pokemon.uuid, snapshot);
    if (old && old.pokemonId !== snapshot.pokemonId) {
        increment(p,'evolutions'); event(p,'evolution',`${old.name} évolue en ${snapshot.name} !`);
    }
    return snapshot;
}
function syncTeam(p, replace = true) {
    if (!p.runReport) return;
    const team = p.equipe.pokemons.map(pokemon => rememberPokemon(p, pokemon)).filter(Boolean);
    if (replace && team.length) p.runReport.team = team.map(pokemon => pokemon.uuid);
}
function visit(p, map) {
    if (!p.runReport || !map) return;
    if (!p.runReport.visitedMaps.some(entry => entry.map === map)) p.runReport.visitedMaps.push({ map, visitedAt: timestamp(p) });
    event(p, 'map', `Arrivée : ${map}.`, map);
}
function init(p, now = Date.now) {
    p.runReport = { now, pokemon: new Map(), drifts: new Map(), stats: Object.fromEntries(COUNTERS.map(key => [key, 0])),
        team: [], tournamentTeam: [], equipped: [], starter: null, visitedMaps: [], events: [], eventsOmitted: 0,
        pokemonOmitted: 0, driftsOmitted: 0, endedAt: null, reason: null, finalMoney: p.money, finalItems: [] };
    const starter = rememberPokemon(p, p.equipe.pokemons[0], 'starter');
    p.runReport.starter = starter ? copy(starter) : null;
    syncTeam(p);
    event(p, 'start', `Départ avec ${starter?.name || 'un compagnon'} niveau ${starter?.level || 5}.`);
    visit(p, p.currentmap);
}
function battleStarted(p, battle) {
    if (!p.runReport) return;
    syncTeam(p);
    increment(p, 'battles');
    const other = battle.a === p ? battle.b : battle.a;
    const npcName = npcNames.get(battle.npcKey) || (battle.type === 'arena' ? 'un champion' : 'un dresseur');
    event(p, 'battle', `Combat ${battle.type === 'pvp' ? `contre ${other.username}` : battle.type === 'arena' ? `d’arène contre ${npcName}` : battle.type === 'trainer' ? `contre ${npcName}` : `sauvage : ${other.equipe.pokemons[0]?.truename || 'Pokémon'}`}.`);
}
function lost(p, pokemon) {
    const previous = p.runReport?.pokemon.get(pokemon.uuid);
    if (!p.runReport || previous?.lostAt != null) return;
    const snapshot = rememberPokemon(p, pokemon);
    if (snapshot) snapshot.lostAt = timestamp(p);
    increment(p, 'pokemonLost');
    event(p, 'lost', `${pokemon.truename || pokemon.name} niveau ${pokemon.level} est tombé au combat.`);
}
function capture(p, pokemon) {
    rememberPokemon(p, pokemon, 'capture');
    increment(p, 'captures');
    event(p, 'capture', `${pokemon.truename || pokemon.name} niveau ${pokemon.level} rejoint l’équipe.`);
}
function battleFinished(p, battle, summary) {
    if (!p.runReport) return;
    // Final snapshots are taken after the engine restores temporary transformations.
    for (const pokemon of battle.originalTeams.get(p) || []) rememberPokemon(p, pokemon);
    syncTeam(p, p.equipe.pokemons.length > 0 && p.runReport.endedAt === null);
    if (summary.outcome === 'victory') increment(p, `${battle.type}Wins`);
    else if (summary.outcome === 'defeat') increment(p, 'defeats');
    else if (summary.outcome === 'draw') increment(p, 'draws');
    else if (summary.outcome === 'fled') increment(p, 'fled');
    else if (summary.outcome === 'interrupted') increment(p, 'interrupted');
    for (const pokemon of summary.experience) {
        increment(p, 'xpGained', pokemon.xpGained);
        increment(p, 'levelsGained', pokemon.level - pokemon.previousLevel);
        if (pokemon.level > pokemon.previousLevel) event(p,'level',`${pokemon.name} passe du niveau ${pokemon.previousLevel} au niveau ${pokemon.level}.`);
    }
    increment(p, 'moneyEarned', summary.money);
    const outcome = { victory: 'Victoire', defeat: 'Défaite', draw: 'Double K.O.', captured: 'Capture réussie', fled: 'Fuite', interrupted: 'Combat interrompu' }[summary.outcome];
    const xp = summary.experience.reduce((sum, pokemon) => sum + pokemon.xpGained, 0);
    event(p, 'battle_result', `${outcome}${xp ? ` · +${xp} XP` : ''}${summary.money ? ` · +${summary.money} ₽` : ''}.`);
}
function driftSnapshot(p, drift, previous = {}) {
    const definition = definitions.get(drift.definitionId);
    return { uuid: drift.uuid, definitionId: drift.definitionId, rarity: drift.rarity, element: drift.element || null,
        name: definition?.name || drift.definitionId, description: definition?.description || '', category: definition?.category || '',
        value: finite(definition?.values[drift.rarity]), unit: definition?.unit || '',
        obtainedAt: previous.obtainedAt ?? timestamp(p), source: previous.source || null,
        status: p.equipped.includes(drift.uuid) ? 'equipped' : 'stored', ...previous };
}
function syncDrifts(p) {
    if (!p.runReport) return;
    for (const drift of p.drifts) {
        const previous = p.runReport.drifts.get(drift.uuid);
        if (!previous && p.runReport.drifts.size >= MAX_COLLECTION) {
            if (!p.equipped.includes(drift.uuid)) continue;
            const evicted = [...p.runReport.drifts.values()].find(entry => !p.equipped.includes(entry.uuid));
            if (!evicted) continue;
            p.runReport.drifts.delete(evicted.uuid);
        }
        const snapshot = driftSnapshot(p, drift, previous);
        snapshot.status = p.equipped.includes(drift.uuid) ? 'equipped' : 'stored';
        p.runReport.drifts.set(drift.uuid, snapshot);
    }
}
function driftFound(p, drift, source) {
    if (!p.runReport) return;
    increment(p, 'driftsFound');
    if (p.runReport.drifts.size < MAX_COLLECTION) p.runReport.drifts.set(drift.uuid, driftSnapshot(p, drift, { source }));
    else p.runReport.driftsOmitted++;
    event(p, 'drift', `Drift obtenu : ${definitions.get(drift.definitionId)?.name || drift.definitionId} (${catalogue.rarities.find(r => r.key === drift.rarity)?.name || drift.rarity}).`);
}
function driftRemoved(p, drift, sell, money = 0) {
    if (!p.runReport) return;
    syncDrifts(p);
    const snapshot = p.runReport.drifts.get(drift.uuid);
    if (snapshot) { snapshot.status = sell ? 'sold' : 'discarded'; snapshot.removedAt = timestamp(p); snapshot.salePrice = money; }
    increment(p, sell ? 'driftsSold' : 'driftsDiscarded');
    if (sell) increment(p, 'moneyEarned', money);
    event(p, sell ? 'sale' : 'discard', `${snapshot?.name || drift.definitionId} ${sell ? `vendu · +${money} ₽` : 'recyclé'}.`);
}
function tournament(p, round) {
    syncTeam(p);
    if (p.runReport && round === 1) p.runReport.tournamentTeam = p.equipe.pokemons.map(pokemon => p.runReport.pokemon.get(pokemon.uuid)).filter(Boolean).map(copy);
    event(p, 'round', `Préparation du round ${round} : les survivants sont soignés.`);
}
function endPlayer(p, reason, items = []) {
    if (!p.runReport || p.runReport.endedAt !== null) return;
    syncTeam(p); syncDrifts(p);
    p.runReport.equipped = [...p.equipped];
    p.runReport.endedAt = timestamp(p); p.runReport.reason = reason;
    p.runReport.finalMoney = p.money;
    p.runReport.finalItems = items.map(item => ({ key: item.key, name: item.name, quantity: item.quantity }));
    event(p, 'end', { winner: 'Vainqueur de l’expédition !', defeated: 'Élimination au combat.', forfeit: 'Abandon de l’expédition.',
        disconnected: 'Élimination après déconnexion.', not_ready: 'Élimination : absent au départ du round.', finished: 'Fin de l’expédition.' }[reason] || 'Fin de l’expédition.');
}
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function finish(run, at) {
    if (run.report) return run.report;
    const players = [...run.players.values()].map(p => {
        const r = p.runReport;
        const drifts = [...r.drifts.values()];
        return { id: p.userId, username: p.username, reason: r.reason, endedAt: r.endedAt,
            survivedMs: Math.max(0, (r.endedAt ?? at) - run.startedAt), starter: r.starter,
            pokemon: [...r.pokemon.values()], team: r.team.map(id => r.pokemon.get(id)).filter(Boolean), tournamentTeam: r.tournamentTeam,
            equippedDrifts: r.equipped.map(id => r.drifts.get(id)).filter(Boolean), drifts,
            stats: r.stats, visitedMaps: r.visitedMaps, events: r.events, eventsOmitted: r.eventsOmitted,
            pokemonOmitted: r.pokemonOmitted, driftsOmitted: Math.max(r.driftsOmitted, r.stats.driftsFound - drifts.length), finalMoney: r.finalMoney, finalItems: r.finalItems };
    });
    // No live model, socket, inventory, auth or game-action references can escape into the souvenir.
    run.report = freeze(copy({ version: 1, runId: run.id, startedAt: run.startedAt, finishedAt: at,
        mode: run.mode || 'rift', ...(run.colosseum ? { colosseum: run.colosseum } : {}),
        durationMs: Math.max(0, at - run.startedAt), rules: { ...run.lobby.rules }, winnerId: run.winnerId, players,
        ...(run.accountReward ? { accountReward: run.accountReward } : {}),
        matches: run.matches.map(match => ({ id: match.id, round: match.round, players: [...match.players], status: match.status,
            winnerId: match.winnerId, startedAt: match.startedAt ?? null, finishedAt: match.finishedAt ?? at,
            durationMs: match.startedAt == null ? 0 : Math.max(0, (match.finishedAt ?? at) - match.startedAt) })) }));
    return run.report;
}
module.exports = { MAX_EVENTS, MAX_COLLECTION, init, increment, event, syncTeam, visit, battleStarted, battleFinished,
    lost, capture, syncDrifts, driftFound, driftRemoved, tournament, endPlayer, finish, pokemonSnapshot };

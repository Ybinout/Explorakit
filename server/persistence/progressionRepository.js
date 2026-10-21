const progressionCatalog = require('../../data/game/progression.json');
const pokedexCatalog = require('../../data/game/pokedex.json');
const { dbPool, withTransaction } = require('../config/database');
const { meetsRequirements, hasCompletedBattle, effectiveStoryFlags, deriveStoryQuest, deriveChapter2 } = require('../game/world/storyProgression');

const QUEST_STATUSES = new Set(['active', 'completed']);
const questDefinitions = new Map((progressionCatalog.quests || []).map((quest) => [quest.key, quest]));
const badgeDefinitions = new Map((progressionCatalog.badges || []).map((badge) => [badge.key, badge]));
const visiblePokedex = pokedexCatalog.filter((pokemon) => Number(pokemon.id) >= 1 && Number(pokemon.id) <= 493);

function normalizeUserId(userId) {
    const parsed = Number.parseInt(userId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Utilisateur invalide.');
    return parsed;
}

function resolvePokemonId(pokemonOrId) {
    const rawId = typeof pokemonOrId === 'object'
        ? pokemonOrId?.data?.id ?? pokemonOrId?.pokemon_id ?? pokemonOrId?.id
        : pokemonOrId;
    const pokemonId = Number.parseInt(rawId, 10);
    return Number.isInteger(pokemonId) && pokemonId > 0 ? pokemonId : null;
}

async function ensureInitialProgress(userId, executor = dbPool) {
    const id = normalizeUserId(userId);
    await executor.execute(
        `INSERT IGNORE INTO player_story_flags (user_id, flag_key, flag_value)
         VALUES (?, 'starter_chosen', 'true')`,
        [id]
    );
    for (const quest of progressionCatalog.quests || []) {
        if (quest.defaultStatus !== 'active' || quest.enabled === false) continue;
        await executor.execute(
            `INSERT IGNORE INTO player_quests (user_id, quest_key, status, progress)
             VALUES (?, ?, 'active', 0)`,
            [id, quest.key]
        );
    }
}

async function reconcileMoonpunchBadge(userId, executor = dbPool) {
    const id = normalizeUserId(userId);
    // Reconcile only a recorded victory, never an inferred story prerequisite.
    // Preserve its date and existing rewards/receipts, including legacy flag-only saves.
    const [result] = await executor.execute(
        `INSERT IGNORE INTO player_badges (user_id, badge_key, awarded_at)
         SELECT u.id, 'lake_badge', COALESCE(b.completed_at, f.updated_at, CURRENT_TIMESTAMP)
         FROM users u
         LEFT JOIN user_npc_battles b ON b.user_id = u.id AND b.battle_key = 'moonpunch_ville1'
         LEFT JOIN player_story_flags f ON f.user_id = u.id AND f.flag_key = 'moonpunch_defeated' AND f.flag_value = 'true'
         WHERE u.id = ? AND (b.user_id IS NOT NULL OR f.user_id IS NOT NULL)`, [id]
    );
    return result.affectedRows;
}

async function loadProgressState(userId) {
    const id = normalizeUserId(userId);
    await ensureInitialProgress(id);
    await reconcileMoonpunchBadge(id);
    const [[flagRows], [questRows], [badgeRows], [battleRows], [moneyRows]] = await Promise.all([
        dbPool.execute('SELECT flag_key, flag_value, updated_at FROM player_story_flags WHERE user_id = ?', [id]),
        dbPool.execute('SELECT quest_key, status, progress, updated_at, completed_at FROM player_quests WHERE user_id = ?', [id]),
        dbPool.execute('SELECT badge_key, awarded_at FROM player_badges WHERE user_id = ?', [id]),
        dbPool.execute('SELECT battle_key, dialogue_name, completed_at FROM user_npc_battles WHERE user_id = ?', [id]),
        dbPool.execute('SELECT money FROM users WHERE id = ? LIMIT 1', [id])
    ]);

    const flags = Object.fromEntries(flagRows.map((row) => [row.flag_key, row.flag_value]));
    const storyQuest = deriveStoryQuest({ flags });
    const effectiveFlags = effectiveStoryFlags({ flags });
    const storedQuests = new Map(questRows.map((row) => [row.quest_key, row]));
    const storedBadges = new Map(badgeRows.map((row) => [row.badge_key, row]));
    const quests = (progressionCatalog.quests || []).filter(definition=>meetsRequirements(definition,{flags})).map((definition) => {
        const stored = storedQuests.get(definition.key);
        return {
            ...definition,
            status: stored?.status || definition.defaultStatus || 'active',
            progress: Number(stored?.progress) || 0,
            completedAt: stored?.completed_at || null,
            updatedAt: stored?.updated_at || null,
            ...(definition.key === 'first_challenge' && effectiveFlags.route_guard_defeated === 'true' ? { status:'completed', progress:1 } : {}),
            ...(definition.key === 'clara_chapter2' ? deriveChapter2({flags}) : {}),
            ...(definition.key === 'refuges' ? {progress:['refuge_lyse_met','refuge_abel_met'].filter(k=>flags[k]==='true').length,status:['refuge_lyse_met','refuge_abel_met'].every(k=>flags[k]==='true')?'completed':'active'} : {}),
            ...(definition.key === 'main_sister_search' ? {
                ...storyQuest,
                completedAt: storyQuest.status === 'completed'
                    ? stored?.completed_at || null : null
            } : {})
        };
    });
    const badges = (progressionCatalog.badges || [])
        .map((definition) => ({
            ...definition,
            earned: storedBadges.has(definition.key),
            awardedAt: storedBadges.get(definition.key)?.awarded_at || null
        }))
        .sort((left, right) => Number(left.order) - Number(right.order));

    const objective=quests.find(q=>q.key==='main_sister_search'&&q.status==='active')||quests.find(q=>q.key==='clara_chapter2'&&q.status==='active');
    return {
        objective:objective?{title:objective.title,text:objective.description,destination:objective.destination||null,map:objective.map||null}:null,
        flags,
        quests,
        badges,
        completedNpcBattles: battleRows.map((row) => ({
            battleKey: row.battle_key,
            dialogueName: row.dialogue_name,
            completedAt: row.completed_at
        })),
        money: Number(moneyRows[0]?.money) || 0,
        syncedAt: new Date().toISOString()
    };
}

async function loadPokedex(userId) {
    const id = normalizeUserId(userId);
    const [rows] = await dbPool.execute(
        `SELECT pokemon_id, seen_count, caught_count, first_seen_at, first_caught_at
         FROM user_pokedex WHERE user_id = ?`,
        [id]
    );
    const stored = new Map(rows.map((row) => [Number(row.pokemon_id), row]));
    const entries = visiblePokedex.map((pokemon) => {
        const record = stored.get(Number(pokemon.id));
        return {
            id: Number(pokemon.id),
            name: pokemon.name?.french || pokemon.name?.english || `Pokemon ${pokemon.id}`,
            types: Array.isArray(pokemon.type) ? pokemon.type : [],
            seen: Number(record?.seen_count) > 0,
            caught: Number(record?.caught_count) > 0,
            seenCount: Number(record?.seen_count) || 0,
            caughtCount: Number(record?.caught_count) || 0,
            firstSeenAt: record?.first_seen_at || null,
            firstCaughtAt: record?.first_caught_at || null
        };
    });
    return {
        total: entries.length,
        seen: entries.filter((entry) => entry.seen).length,
        caught: entries.filter((entry) => entry.caught).length,
        entries,
        syncedAt: new Date().toISOString()
    };
}

async function markPokemonSeen(userId, pokemonOrId, executor = dbPool) {
    const id = normalizeUserId(userId);
    const pokemonId = resolvePokemonId(pokemonOrId);
    if (!pokemonId) return false;
    await executor.execute(
        `INSERT INTO user_pokedex (user_id, pokemon_id, seen_count, caught_count, first_seen_at)
         VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE seen_count = seen_count + 1,
            first_seen_at = COALESCE(first_seen_at, CURRENT_TIMESTAMP)`,
        [id, pokemonId]
    );
    return true;
}

async function markPokemonCaught(userId, pokemonOrId, executor = dbPool) {
    const id = normalizeUserId(userId);
    const pokemonId = resolvePokemonId(pokemonOrId);
    if (!pokemonId) return false;
    await executor.execute(
        `INSERT INTO user_pokedex
            (user_id, pokemon_id, seen_count, caught_count, first_seen_at, first_caught_at)
         VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
            seen_count = GREATEST(seen_count, 1),
            caught_count = caught_count + 1,
            first_seen_at = COALESCE(first_seen_at, CURRENT_TIMESTAMP),
            first_caught_at = COALESCE(first_caught_at, CURRENT_TIMESTAMP)`,
        [id, pokemonId]
    );
    return true;
}

async function synchronizeCaughtPokemon(userId, pokemons = [], executor = dbPool) {
    const id = normalizeUserId(userId);
    for (const pokemon of Array.isArray(pokemons) ? pokemons : []) {
        const pokemonId = resolvePokemonId(pokemon);
        if (!pokemonId) continue;
        await executor.execute(
            `INSERT INTO user_pokedex
                (user_id, pokemon_id, seen_count, caught_count, first_seen_at, first_caught_at)
             VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                seen_count = GREATEST(seen_count, 1),
                caught_count = GREATEST(caught_count, 1),
                first_seen_at = COALESCE(first_seen_at, CURRENT_TIMESTAMP),
                first_caught_at = COALESCE(first_caught_at, CURRENT_TIMESTAMP)`,
            [id, pokemonId]
        );
    }
}

function getNpcBattleDefinition(dialogueName) {
    if (typeof dialogueName !== 'string') return null;
    const definition = progressionCatalog.npcBattles?.[dialogueName];
    return definition ? { dialogueName, ...definition } : null;
}

async function isNpcBattleCompleted(userId, dialogueName) {
    const definition = getNpcBattleDefinition(dialogueName);
    if (!definition?.once) return false;
    if (hasCompletedBattle(definition, { flags: await loadStoryFlags(normalizeUserId(userId), dbPool) })) return true;
    const [rows] = await dbPool.execute(
        'SELECT battle_key FROM user_npc_battles WHERE user_id = ? AND battle_key = ? LIMIT 1',
        [normalizeUserId(userId), definition.battleKey]
    );
    return rows.length > 0;
}

async function loadStoryFlags(id, connection) {
    const [rows] = await connection.execute(
        'SELECT flag_key, flag_value FROM player_story_flags WHERE user_id = ?', [id]
    );
    return Object.fromEntries(rows.map((row) => [row.flag_key, row.flag_value]));
}

async function grantReward(id, reward, connection) {
    const money = Math.max(0, Math.floor(Number(reward.money) || 0));
    if (money > 0) await connection.execute('UPDATE users SET money = money + ? WHERE id = ?', [money, id]);
    for(const [key,count]of Object.entries(reward.items||{})) {
        if(!Number.isSafeInteger(count)||count<1||count>99)throw Error('Récompense objet invalide.');
        await connection.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[id,key,count]);
    }
    for (const [key, value] of Object.entries(reward.flags || {})) {
        await connection.execute(
            `INSERT INTO player_story_flags (user_id, flag_key, flag_value) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value)`, [id, key, String(value)]
        );
    }
    for (const update of reward.quests || []) {
        if (!questDefinitions.has(update.key) || update.key === 'main_sister_search') continue;
        const status = QUEST_STATUSES.has(update.status) ? update.status : 'active';
        const progress = Math.max(0, Math.floor(Number(update.progress) || 0));
        await connection.execute(
            `INSERT INTO player_quests (user_id, quest_key, status, progress, completed_at)
             VALUES (?, ?, ?, ?, IF(? = 'completed', CURRENT_TIMESTAMP, NULL))
             ON DUPLICATE KEY UPDATE
                status = IF(status = 'completed', status, VALUES(status)),
                progress = GREATEST(progress, VALUES(progress)),
                completed_at = IF(VALUES(status) = 'completed', COALESCE(completed_at, CURRENT_TIMESTAMP), completed_at)`,
            [id, update.key, status, progress, status]
        );
    }
    for (const key of reward.badges || []) {
        if (badgeDefinitions.has(key)) await connection.execute(
            'INSERT IGNORE INTO player_badges (user_id, badge_key) VALUES (?, ?)', [id, key]
        );
    }
    const quest = deriveStoryQuest({ flags: await loadStoryFlags(id, connection) });
    await connection.execute(
        `INSERT INTO player_quests (user_id, quest_key, status, progress, completed_at)
         VALUES (?, 'main_sister_search', ?, ?, IF(? = 'completed', CURRENT_TIMESTAMP, NULL))
         ON DUPLICATE KEY UPDATE status = VALUES(status), progress = VALUES(progress),
            completed_at = IF(VALUES(status) = 'completed', COALESCE(completed_at, CURRENT_TIMESTAMP), NULL)`,
        [id, quest.status, quest.progress, quest.status]
    );
    return money;
}

async function completeNpcBattle(userId, dialogueName) {
    const id = normalizeUserId(userId);
    const definition = getNpcBattleDefinition(dialogueName);
    if (!definition) return { granted: false, reason: 'unknown_battle', progress: await loadProgressState(id) };
    const reward = {...(definition.reward || {}), money:Math.floor(Math.max(0,Number(definition.reward?.money)||0)*1.5)};
    const result = await withTransaction(async (connection) => {
        // Une victoire et une scène simultanées ne doivent pas contourner les prérequis.
        await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
        const flags = await loadStoryFlags(id, connection);
        if (!meetsRequirements(definition, { flags })) {
            return { granted: false, reason: 'requirements_not_met' };
        }
        if (hasCompletedBattle(definition, { flags })) return { granted: false, reason: 'already_completed' };
        const [battleResult] = await connection.execute(
            `INSERT IGNORE INTO user_npc_battles (user_id, battle_key, dialogue_name, reward_json)
             VALUES (?, ?, ?, ?)`, [id, definition.battleKey, dialogueName, JSON.stringify(reward)]
        );
        if (!battleResult.affectedRows) return { granted: false, reason: 'already_completed' };
        const money = await grantReward(id, reward, connection);
        return { granted: true, money, battleKey: definition.battleKey };
    });
    return { ...result, progress: await loadProgressState(id) };
}

async function completeStoryEvent(userId, dialogueName) {
    const id = normalizeUserId(userId);
    const definition = progressionCatalog.storyEvents?.[dialogueName];
    if (!definition) return { granted: false, reason: 'unknown_story_event', progress: await loadProgressState(id) };
    const result = await withTransaction(async (connection) => {
        await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
        const flags = await loadStoryFlags(id, connection);
        if (!meetsRequirements(definition, { flags })) return { granted: false, reason: 'requirements_not_met' };
        if (flags[definition.completionFlag] === 'true') return { granted: false, reason: 'already_completed' };
        const money = await grantReward(id, {
            ...definition.reward,
            flags: { ...definition.reward?.flags, [definition.completionFlag]: 'true' }
        }, connection);
        return { granted: true, money };
    });
    return { ...result, progress: await loadProgressState(id) };
}

module.exports = {
    completeNpcBattle,
    completeStoryEvent,
    ensureInitialProgress,
    getNpcBattleDefinition,
    isNpcBattleCompleted,
    loadPokedex,
    loadProgressState,
    markPokemonCaught,
    markPokemonSeen,
    resolvePokemonId,
    reconcileMoonpunchBadge,
    synchronizeCaughtPokemon
};

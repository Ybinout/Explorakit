// Operator-only repair. No HTTP/socket handler exposes this function. Restore
// only casualties proven by an ended raid, with an account/raid receipt.
const { withTransaction } = require('../config/database');
const codec = require('../game/drift/checkpointCodec');
const pc = require('./pokemonStorageRepository');
const storage = require('../game/storage/pokemonStorage');
async function recover({ raidId, userIds, dryRun = true }) {
    if (
        typeof raidId !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(raidId) ||
        !Array.isArray(userIds) ||
        !userIds.length ||
        userIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
        throw Error('Raid et comptes explicites requis.');
    const ids = [...new Set(userIds)].sort((a, b) => a - b);
    return withTransaction(async (c) => {
        const names = new Map();
        for (const id of ids) {
            const [[u]] = await c.execute(
                'SELECT id,username FROM users WHERE id=? FOR UPDATE',
                [id]
            );
            if (!u) throw Error('Compte introuvable.');
            names.set(id, u.username);
        }
        const [[row]] = await c.execute(
            'SELECT phase,snapshot FROM corruption_raids WHERE id=? FOR UPDATE',
            [raidId]
        );
        if (!row || !['won', 'lost'].includes(row.phase))
            throw Error('Seul un raid terminé permet une restauration.');
        const run = codec.decode(row.snapshot),
            result = [];
        for (const id of ids) {
            const member = run.members.find((m) => m.id === id);
            if (!member) throw Error('Ce compte ne participait pas à ce raid.');
            const flag = 'support_raid_recovery:' + raidId;
            const [[previous]] = await c.execute(
                'SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',
                [id, flag]
            );
            if (previous) {
                result.push({
                    userId: id,
                    username: names.get(id),
                    duplicate: true,
                    receipt: JSON.parse(previous.flag_value),
                });
                continue;
            }
            const entries = await pc.loadEntries(id, c, true),
                restored = [],
                skipped = [];
            for (const casualty of member.casualties || []) {
                if (casualty.protected) continue;
                const entry = run.combat?.models.find(
                    (v) => v.ownerId === id && v.pokemon.uuid === casualty.uuid
                );
                if (
                    !entry ||
                    !member.selected.includes(casualty.uuid) ||
                    !entry.pokemon.__darkContinentDead ||
                    entry.pokemon.currentHp > 0
                )
                    throw Error('Preuve de perte définitive incomplète.');
                const [party] = await c.execute(
                    'SELECT t.user_id FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE p.uuid=?',
                    [casualty.uuid]
                );
                const [stored] = await c.execute(
                    'SELECT user_id FROM pokemon_storage WHERE uuid=?',
                    [casualty.uuid]
                );
                if ([...party, ...stored].some((v) => v.user_id !== id))
                    throw Error(
                        'Ce Pokémon appartient désormais à un autre compte.'
                    );
                if (party.length || stored.length) {
                    skipped.push(casualty.uuid);
                    continue;
                }
                // Canonical row round-trip strips combat-only flags/copies and
                // preserves species, XP, K, IV/EV, moves, nature and corruption.
                const pokemon = pc.decodePokemon(
                    pc.encodePokemon(entry.pokemon)
                );
                pokemon.heldItem = entry.initialHeld || null;
                require('../game/world/playerRecovery').healTeam({
                    pokemons: [pokemon],
                });
                const where = storage.freeSlot(entries),
                    item = pokemon.heldItem;
                let refundedItemReused = false;
                if (item) {
                    const [[bag]] = await c.execute(
                        'SELECT quantity FROM user_items WHERE user_id=? AND item_key=? FOR UPDATE',
                        [id, item]
                    );
                    refundedItemReused = Number(bag?.quantity || 0) > 0;
                    if (!dryRun && refundedItemReused)
                        await c.execute(
                            'UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>0',
                            [id, item]
                        );
                }
                if (!dryRun)
                    await c.execute(
                        'INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',
                        [
                            pokemon.uuid,
                            id,
                            where.box,
                            where.slot,
                            pc.encodePokemon(pokemon),
                        ]
                    );
                entries.push({ ...where, pokemon });
                restored.push({
                    uuid: pokemon.uuid,
                    species: pokemon.data.id,
                    name: pokemon.truename,
                    level: pokemon.level,
                    k: pokemon.k,
                    item,
                    refundedItemReused,
                    ...where,
                });
            }
            const receipt = {
                raidId,
                restored,
                skipped,
                at: new Date().toISOString(),
            };
            if (!dryRun)
                await c.execute(
                    'INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?)',
                    [
                        id,
                        flag,
                        JSON.stringify({
                            version: 1,
                            count: restored.length,
                            skipped: skipped.length,
                            hash: require('node:crypto')
                                .createHash('sha256')
                                .update(JSON.stringify(receipt))
                                .digest('hex'),
                            at: receipt.at,
                        }),
                    ]
                );
            result.push({
                userId: id,
                username: names.get(id),
                duplicate: false,
                receipt,
            });
        }
        return { dryRun, raidId, accounts: result };
    });
}
module.exports = { recover };

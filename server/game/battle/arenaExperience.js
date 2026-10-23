const { withTransaction } = require('../../config/database');
const { editEquipe } = require('../../persistence/teamRepository');
const { clearBattleTransientState } = require('./battleOutcome');

// Stage training without changing live combat objects or emitting unsaved XP.
// Preserve non-enumerable ability/Transform memories, but rebind team cycles.
function cloneTeam(team) {
    const pokemons = team.pokemons.map(pokemon => {
        const descriptors = Object.getOwnPropertyDescriptors(pokemon);
        delete descriptors.__abilityTeam;
        // These are identities, not training state. Cloning their Pokémon would
        // break ownership after Trick/Recycle or consuming an exchanged item.
        const owners = {};
        for (const key of ['__heldItemOrigin', '__consumedHeldItemOrigin']) {
            if (descriptors[key]) owners[key] = descriptors[key];
            delete descriptors[key];
        }
        return Object.create(Object.getPrototypeOf(pokemon), { ...structuredClone(descriptors), ...owners });
    });
    require('../abilities/abilityForms').attachTeam(pokemons);
    return { pokemons };
}

function createArenaExperience(battleKey, initialRoster) {
    if (typeof battleKey !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(battleKey)) {
        throw Error('Identité persistante de l’arène manquante.');
    }
    // Original slots, not battle order, species or freshly generated UUIDs.
    const slots = new Map(initialRoster.map((pokemon, slot) => [pokemon, slot]));
    return {
        async reward(userId, player, defeated, multiplier, io, tracker) {
            const slot = slots.get(defeated);
            if (slot === undefined) throw Error('Adversaire absent de l’équipe d’arène.');
            const key = `arena_xp:${battleKey}:${slot}`;
            const events = [];
            const staged = cloneTeam(player.equipe);
            let awards;
            let alreadyClaimed = false;
            const wasRewarded = tracker.rewarded.has(defeated);
            const hadEffort = tracker.effortRewarded.has(defeated);
            try {
                await withTransaction(async connection => {
                    const [[owner]] = await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
                    if (!owner) throw Error('Joueur introuvable.');
                    const [rows] = await connection.execute(
                        'SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key=?', [userId, key]);
                    alreadyClaimed = rows.length > 0;
                    if (alreadyClaimed) return;
                    awards = tracker.reward({ ...player, equipe: staged }, defeated, multiplier,
                        { to: target => ({ emit: (name, payload) => events.push({ target, name, payload }) }) },
                        { grantExperience: true });
                    // No living eligible participant: do not consume the future XP reward.
                    if (awards.length) await connection.execute(
                        'INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?)', [userId, key, 'true']);
                    const persisted = cloneTeam(staged);
                    clearBattleTransientState(persisted.pokemons);
                    await editEquipe(userId, persisted, connection);
                });
            } catch (error) {
                if (!wasRewarded) tracker.rewarded.delete(defeated);
                if (!hadEffort) tracker.effortRewarded.delete(defeated);
                throw error;
            }
            if (alreadyClaimed) {
                const result = tracker.reward(player, defeated, multiplier, io, { grantExperience: false });
                result.alreadyClaimed = true;
                return result;
            }
            for (let i = 0; i < staged.pokemons.length; i++) {
                const original = player.equipe.pokemons[i];
                const descriptors = Object.getOwnPropertyDescriptors(staged.pokemons[i]);
                delete descriptors.__abilityTeam;
                Object.defineProperties(original, descriptors);
            }
            for (const event of events) io.to(event.target).emit(event.name, event.payload);
            // Retain the existing array contract for narration and result summaries.
            const result = awards.map(award => ({ ...award, pokemon: player.equipe.pokemons.find(p => p.uuid === award.pokemon.uuid) }));
            result.alreadyClaimed = alreadyClaimed;
            return result;
        }
    };
}

module.exports = { createArenaExperience };

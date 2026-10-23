const { equipHeldItem, loadUserItems } = require('../../persistence/itemRepository');
const { saveUserSprite, sanitizeSpriteName } = require('../../persistence/playerRepository');

const DEFAULT_SPRITE = 'sprite.png';

function registerPlayerProfileHandlers({ socket, io, players, userId }) {
    let appearanceBusy = false;
    socket.on('setSprite', async (payload = {}, acknowledge = () => {}) => {
        const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
        const player = players[socket.id];
        if (!player || player.inbattle || appearanceBusy) return reply({ success: false, message: 'Apparence indisponible maintenant.' });

        const requestedSprite = sanitizeSpriteName(payload.sprite || DEFAULT_SPRITE);
        if (player.sprite === requestedSprite) return reply({ success: true, sprite: requestedSprite });

        appearanceBusy = true;
        try {
            await saveUserSprite(userId, requestedSprite);
            player.sprite = requestedSprite;
        } catch (error) {
            console.error(`Erreur de sauvegarde sprite user ${userId}:`, error.message);
            return reply({ success: false, message: 'Impossible d’enregistrer cette apparence. Réessaie.' });
        } finally {
            appearanceBusy = false;
        }
        reply({ success: true, sprite: requestedSprite });

        for (const id in players) {
            if (players[id].currentmap === player.currentmap) {
                io.to(id).emit('playerAppearanceUpdated', { id: socket.id, sprite: requestedSprite });
            }
        }
    });

    socket.on('equipHeldItem', async (payload = {}, acknowledge = () => {}) => {
        const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
        const player = players[socket.id];
        if (!player || player.inbattle || player.inventoryBusy) {
            reply({ success: false, message: 'Objet non modifiable pendant un combat.' });
            return;
        }

        const teamId = Number.parseInt(payload.teamId, 10);
        const pokemonUuid = typeof payload.pokemonUuid === 'string' ? payload.pokemonUuid : '';
        const itemKey = payload.itemKey || null;
        player.inventoryBusy = true;
        try {
            const heldItem = await equipHeldItem(userId, teamId, pokemonUuid, itemKey);
            const pokemon = player.equipe?.pokemons?.find((candidate) => candidate.uuid === pokemonUuid);
            if (pokemon) pokemon.heldItem = heldItem;
            reply({ success: true, heldItem, items: await loadUserItems(userId) });
        } catch (error) {
            reply({ success: false, message: error.message || "Impossible d'equiper cet objet." });
        } finally {
            player.inventoryBusy = false;
        }
    });
}

module.exports = { DEFAULT_SPRITE, registerPlayerProfileHandlers };

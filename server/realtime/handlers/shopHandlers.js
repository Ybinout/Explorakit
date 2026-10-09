const { loadUserItems, purchaseUserItem } = require('../../persistence/itemRepository');
const { loadProgressState } = require('../../persistence/progressionRepository');
const { getShopCatalog, isShopMap } = require('../../game/world/shopCatalog');

function registerShopHandlers({ socket, userId, getPlayer }) {
    const replyTo = (acknowledge) => (typeof acknowledge === 'function' ? acknowledge : () => {});

    const openShop = async (acknowledge) => {
        const reply = replyTo(acknowledge);
        const player = getPlayer();
        if (!player || !isShopMap(player.currentmap)) {
            const response = { success: false, reason: 'not_in_shop' };
            reply(response);
            return response;
        }
        if (player.inbattle) {
            const response = { success: false, reason: 'battle_active' };
            reply(response);
            return response;
        }

        try {
            const [items, progression] = await Promise.all([
                loadUserItems(userId),
                loadProgressState(userId)
            ]);
            const response = {
                success: true,
                catalog: getShopCatalog(),
                items,
                money: progression.money
            };
            socket.emit('shopOpened', response);
            reply(response);
            return response;
        } catch (error) {
            console.error(`Erreur ouverture boutique user ${userId}:`, error.message);
            const response = { success: false, reason: 'shop_unavailable' };
            reply(response);
            return response;
        }
    };

    socket.on('requestShop', openShop);

    socket.on('buyShopItem', async (payload = {}, acknowledge) => {
        const reply = replyTo(acknowledge);
        const player = getPlayer();
        if (!player || !isShopMap(player.currentmap)) {
            reply({ success: false, reason: 'not_in_shop' });
            return;
        }
        if (player.inbattle) {
            reply({ success: false, reason: 'battle_active' });
            return;
        }

        try {
            const result = await purchaseUserItem(userId, payload.itemKey, payload.quantity);
            if (!result.success) {
                reply(result);
                return;
            }

            const progression = await loadProgressState(userId);
            const response = { ...result, progression };
            socket.emit('bagUpdated', { items: result.items });
            socket.emit('progressionState', progression);
            socket.emit('shopPurchaseCompleted', response);
            reply(response);
        } catch (error) {
            console.error(`Erreur achat boutique user ${userId}:`, error.message);
            reply({ success: false, reason: 'shop_unavailable' });
        }
    });

    return { openShop };
}

module.exports = { registerShopHandlers };

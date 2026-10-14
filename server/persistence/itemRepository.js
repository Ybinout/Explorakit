const itemsCatalog = require('../../data/game/items.json');
const { dbPool, withTransaction } = require('../config/database');

const itemCatalogByKey = (itemsCatalog.items || []).reduce((accumulator, item) => {
    if (!item || !item.key) return accumulator;
    accumulator[item.key] = item;
    return accumulator;
}, {});

function hydrateItems(rows) {
    return rows.map((row) => {
        const itemFromCatalog = itemCatalogByKey[row.item_key] || {};
        return {
            key: row.item_key,
            name: itemFromCatalog.name || row.item_key,
            category: itemFromCatalog.category || null,
            description: itemFromCatalog.description || null,
            catch_multiplier: itemFromCatalog.catch_multiplier || null,
            buyPrice: Number(itemFromCatalog.buy_price) || null,
            quantity: Number(row.quantity) || 0,
            heal: itemFromCatalog.heal || null,
            cure: itemFromCatalog.cure || null,
            revive: Boolean(itemFromCatalog.revive),
            fieldUse: itemFromCatalog.fieldUse || null
        };
    });
}

function getPurchasableItem(itemKey) {
    const item = itemCatalogByKey[itemKey];
    const buyPrice = Math.floor(Number(item?.buy_price));
    if (!item || !Number.isInteger(buyPrice) || buyPrice <= 0) return null;
    return { ...item, buyPrice };
}

async function loadUserItems(userId) {
    const [rows] = await dbPool.execute(
        `SELECT item_key, quantity
         FROM user_items
         WHERE user_id = ? AND quantity > 0
         ORDER BY item_key`,
        [userId]
    );

    return hydrateItems(rows);
}

async function consumeUserItem(userId, itemKey, quantity = 1) {
    const normalizedQuantity = Number(quantity);
    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0) {
        return { success: false, reason: 'invalid_quantity' };
    }

    const [updateResult] = await dbPool.execute(
        `UPDATE user_items
         SET quantity = quantity - ?
         WHERE user_id = ? AND item_key = ? AND quantity >= ?`,
        [normalizedQuantity, userId, itemKey, normalizedQuantity]
    );

    if (!updateResult || updateResult.affectedRows === 0) {
        return { success: false, reason: 'not_enough_items' };
    }

    const [rows] = await dbPool.execute(
        `SELECT quantity
         FROM user_items
         WHERE user_id = ? AND item_key = ?
         LIMIT 1`,
        [userId, itemKey]
    );

    const remaining = rows.length ? Number(rows[0].quantity) || 0 : 0;
    return { success: true, remaining };
}

async function purchaseUserItem(userId, itemKey, quantity = 1) {
    const normalizedUserId = Number(userId);
    const normalizedQuantity = Number(quantity);
    const item = getPurchasableItem(itemKey);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        return { success: false, reason: 'invalid_user' };
    }
    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0 || normalizedQuantity > 99) {
        return { success: false, reason: 'invalid_quantity' };
    }
    if (!item) {
        return { success: false, reason: 'item_unavailable' };
    }

    const totalPrice = item.buyPrice * normalizedQuantity;
    return withTransaction(async (connection) => {
        const [userRows] = await connection.execute(
            'SELECT money FROM users WHERE id = ? FOR UPDATE',
            [normalizedUserId]
        );
        if (!userRows.length) {
            return { success: false, reason: 'invalid_user' };
        }

        const currentMoney = Number(userRows[0].money) || 0;
        if (currentMoney < totalPrice) {
            return { success: false, reason: 'insufficient_funds', money: currentMoney };
        }

        const [debitResult] = await connection.execute(
            'UPDATE users SET money = money - ? WHERE id = ? AND money >= ?',
            [totalPrice, normalizedUserId, totalPrice]
        );
        if (!debitResult.affectedRows) {
            return { success: false, reason: 'insufficient_funds', money: currentMoney };
        }

        await connection.execute(
            `INSERT INTO user_items (user_id, item_key, quantity) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [normalizedUserId, item.key, normalizedQuantity]
        );

        const [itemRows] = await connection.execute(
            `SELECT item_key, quantity
             FROM user_items
             WHERE user_id = ? AND quantity > 0
             ORDER BY item_key`,
            [normalizedUserId]
        );

        return {
            success: true,
            itemKey: item.key,
            quantity: normalizedQuantity,
            totalPrice,
            money: currentMoney - totalPrice,
            items: hydrateItems(itemRows)
        };
    });
}

async function equipHeldItem(userId, teamId, pokemonUuid, itemKey) {
    if (!Number.isInteger(userId) || !Number.isInteger(teamId) || teamId <= 0 || typeof pokemonUuid !== 'string' || !pokemonUuid) {
        const error = new Error('Demande d’objet tenu invalide.');
        error.statusCode = 400;
        throw error;
    }
    const item = itemKey ? itemCatalogByKey[itemKey] : null;
    if (itemKey && item?.category !== 'held') {
        const error = new Error('Objet tenu invalide.');
        error.statusCode = 400;
        throw error;
    }

    return withTransaction(async (connection) => {
        const [pokemonRows] = await connection.execute(
            `SELECT p.held_item
             FROM pokemons p
             INNER JOIN teams t ON t.id = p.team_id
             WHERE p.team_id = ? AND p.uuid = ? AND t.user_id = ?
             FOR UPDATE`,
            [teamId, pokemonUuid, userId]
        );
        if (!pokemonRows.length) {
            const error = new Error('Pokémon introuvable.');
            error.statusCode = 404;
            throw error;
        }

        const previousItem = pokemonRows[0].held_item || null;
        if (previousItem === itemKey) return itemKey;

        if (itemKey) {
            const [consumeResult] = await connection.execute(
                `UPDATE user_items SET quantity = quantity - 1
                 WHERE user_id = ? AND item_key = ? AND quantity >= 1`,
                [userId, itemKey]
            );
            if (!consumeResult.affectedRows) {
                const error = new Error("L'objet n'est plus disponible dans le sac.");
                error.statusCode = 409;
                throw error;
            }
        }

        if (previousItem) {
            await connection.execute(
                `INSERT INTO user_items (user_id, item_key, quantity) VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
                [userId, previousItem]
            );
        }

        await connection.execute(
            'UPDATE pokemons SET held_item = ? WHERE team_id = ? AND uuid = ?',
            [itemKey, teamId, pokemonUuid]
        );
        return itemKey;
    });
}

module.exports = {
    equipHeldItem,
    getPurchasableItem,
    loadUserItems,
    consumeUserItem,
    purchaseUserItem
};

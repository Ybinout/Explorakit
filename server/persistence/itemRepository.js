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
            sellPrice: require('../game/items/itemSales').getSellPrice(row.item_key),
            quantity: Number(row.quantity) || 0,
            heal: itemFromCatalog.heal || null,
            cure: itemFromCatalog.cure || null,
            revive: Boolean(itemFromCatalog.revive),
            fieldUse: itemFromCatalog.fieldUse || null,
            ...(itemFromCatalog.voidTravel ? { voidTravel: true } : {}),
            repelSteps: itemFromCatalog.repelSteps || null,
            unique: Boolean(itemFromCatalog.unique),
            dropOnly: Boolean(itemFromCatalog.dropOnly)
        };
    });
}

function getPurchasableItem(itemKey, context = {}) {
    const {getShopCatalog,isShopMap}=require('../game/world/shopCatalog');
    if(!isShopMap(context.mapName))return null;
    const offer=getShopCatalog(context).find(i=>i.key===itemKey);
    return offer&&!offer.locked?{...itemCatalogByKey[itemKey],buyPrice:offer.price}:null;
}

async function hydrateUserItems(userId, rows, executor = dbPool) {
    const items = hydrateItems(rows);
    if (items.some(item => item.category === 'evolution' || item.fieldUse?.abilityReroll)) {
        const { rowToPokemon } = require('./teamRepository');
        const stones = require('../game/items/stoneEvolution');
        const [teamRows] = await executor.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? ORDER BY p.position', [userId]);
        const team = teamRows.map(rowToPokemon);
        for (const item of items) if (item.category === 'evolution') {
            item.evolutions = Object.fromEntries(team.map(p => [p.uuid, stones.target(p, item.key)]).filter(([, target]) => target));
        }
        for(const item of items)if(item.fieldUse?.abilityReroll)Object.assign(item,require('../game/items/abilityCapsule').decorate(item,team));
    }
    return require('./voidEndingRepository').decorateItems(userId,items,executor);
}

async function loadUserItems(userId, executor = dbPool) {
    const [rows] = await executor.execute(
        `SELECT item_key, quantity
         FROM user_items
         WHERE user_id = ? AND quantity > 0
         ORDER BY item_key`,
        [userId]
    );

    return hydrateUserItems(userId, rows, executor);
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

async function purchaseUserItem(userId, itemKey, quantity = 1, context = {}) {
    const normalizedUserId = Number(userId);
    const normalizedQuantity = Number(quantity);

    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        return { success: false, reason: 'invalid_user' };
    }
    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0 || normalizedQuantity > 99) {
        return { success: false, reason: 'invalid_quantity' };
    }
    if (!itemCatalogByKey[itemKey] || !require('../game/world/shopCatalog').isShopMap(context.mapName))return {success:false,reason:'item_unavailable'};
    return withTransaction(async (connection) => {
        const [userRows] = await connection.execute(
            'SELECT money FROM users WHERE id = ? FOR UPDATE',
            [normalizedUserId]
        );
        if (!userRows.length) {
            return { success: false, reason: 'invalid_user' };
        }

        const [flagRows]=await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[normalizedUserId]);
        const flags=Object.fromEntries(flagRows.map(r=>[r.flag_key,r.flag_value]));
        const offered=require('../game/world/shopCatalog').getShopCatalog({mapName:context.mapName,flags}).find(item=>item.key===itemKey);
        if(offered?.locked)return {success:false,reason:'badge_required',unlockLabel:offered.unlockLabel};
        const item=getPurchasableItem(itemKey,{mapName:context.mapName,flags});
        if(!item)return {success:false,reason:'item_unavailable'};
        if (item.purchaseLimit) {
            const [owned] = await connection.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?', [normalizedUserId, item.key]);
            if ((Number(owned[0]?.quantity) || 0) + normalizedQuantity > item.purchaseLimit)
                return { success: false, reason: 'purchase_limit' };
        }
        const totalPrice=item.buyPrice*normalizedQuantity;
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
            items: await hydrateUserItems(normalizedUserId, itemRows, connection)
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
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        require('../game/social/tradeLocks').assertUnlocked(userId);
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

async function sellUserItem(userId,itemKey,quantity=1,context={}){
    if(!Number.isInteger(userId)||userId<=0)return {success:false,reason:'invalid_user'};
    if(!Number.isInteger(quantity)||quantity<1||quantity>99)return {success:false,reason:'invalid_quantity'};
    if(!require('../game/world/shopCatalog').isShopMap(context.mapName))return {success:false,reason:'not_in_shop'};
    const unitPrice=require('../game/items/itemSales').getSellPrice(itemKey);
    if(!unitPrice)return {success:false,reason:'item_not_sellable'};
    return withTransaction(async c=>{
        const [[user]]=await c.execute('SELECT money FROM users WHERE id=? FOR UPDATE',[userId]);
        if(!user)return {success:false,reason:'invalid_user'};
        const totalPrice=unitPrice*quantity,money=Number(user.money);
        if(!Number.isSafeInteger(money+totalPrice))return {success:false,reason:'money_limit'};
        const [removed]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,userId,itemKey,quantity]);
        if(!removed.affectedRows)return {success:false,reason:'not_enough_items'};
        await c.execute('UPDATE users SET money=money+? WHERE id=?',[totalPrice,userId]);
        return {success:true,itemKey,quantity,unitPrice,totalPrice,money:money+totalPrice,items:await loadUserItems(userId,c)};
    });
}

module.exports = {
    equipHeldItem,
    getPurchasableItem,
    loadUserItems,
    consumeUserItem,
    purchaseUserItem,
    sellUserItem
};

const itemsCatalog = require('../../../data/game/items.json');

const SHOP_MAPS = new Set([
    'ville1_shop',
    'gen_shop1',
    'gen_shop_ville2_1',
    'gen_shop_ville5_1'
]);

function isShopMap(mapName) {
    return SHOP_MAPS.has(mapName);
}

function getShopCatalog() {
    return (itemsCatalog.items || [])
        .filter((item) => Number(item?.buy_price) > 0)
        .map((item) => ({
            key: item.key,
            name: item.name,
            category: item.category,
            description: item.description || '',
            price: Math.floor(Number(item.buy_price))
        }));
}

module.exports = {
    getShopCatalog,
    isShopMap,
    SHOP_MAPS
};

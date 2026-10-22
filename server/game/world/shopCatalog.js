const itemsCatalog = require('../../../data/game/items.json');
const { tiers, offers } = require('../../../data/game/shop_offers.json');
const SHOP_MAPS = new Set(['ville1_shop','ville_safe1_shop','ville3_shop','ville4_shop','ville5_shop','gen_shop1','gen_shop_route10','gen_shop_ville2_1','gen_shop_ville5_1']);
function isShopMap(mapName) { return SHOP_MAPS.has(mapName); }
function shopTier(flags = {}) { return tiers.reduce((tier, entry, i) => entry.flag && flags[entry.flag] === 'true' ? Math.max(tier,i) : tier,0); }
function getShopMeta({mapName,flags={},expedition=false}={}) {
    const tier=expedition?tiers.length-1:shopTier(flags),training=mapName==='ville5_shop';
    return {tier,name:expedition?'Fournitures d’expédition':tiers[tier].name,next:expedition?'Les objets achetés restent dans cette expédition.':tiers[tier].next,specialty:training?'training':null,trainingAvailable:training&&tier>=5};
}
function getShopCatalog(context = {}) {
    const {mapName,expedition=false}=context;
    if (mapName && !isShopMap(mapName)) return [];
    const {tier}=getShopMeta(context);
    return (itemsCatalog.items || []).filter(item=>{
        const offer=offers[item.key],price=offer?.price ?? item.buy_price;
        if (!(Number(price)>0) || (item.dropOnly&&!offer) || (item.riftOnly&&!expedition&&!offer))return false;
        if (offer?.maps&&!offer.maps.includes(mapName))return false;
        return expedition || tier>=(offer?.tier||0);
    }).map(item=>({key:item.key,name:item.name,category:item.category,description:item.description||'',price:Math.floor(Number(offers[item.key]?.price ?? item.buy_price)),fieldUse:item.fieldUse||null}));
}
module.exports = { getShopCatalog, getShopMeta, shopTier, isShopMap, SHOP_MAPS };

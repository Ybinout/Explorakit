const itemsCatalog = require('../../../data/game/items.json');
const { tiers, offers } = require('../../../data/game/shop_offers.json');
const departmentStore = require('../../../data/game/department_store.json');
const BADGE_LABELS = ['', 'Badge du Sang-Froid · Mounir', 'Badge Dune · Hoze', 'Badge Illusion · Raphael', 'Badge Noblesse · Ana', 'Badge Force · Wanda'];
const BADGE_LABELS_EN = ['', 'Composure Badge · Mounir', 'Dune Badge · Hoze', 'Illusion Badge · Raphael', 'Nobility Badge · Ana', 'Strength Badge · Wanda'];
const getDepartment = mapName => Object.hasOwn(departmentStore.floors,mapName) ? departmentStore.floors[mapName] : null;
const SHOP_MAPS = new Set(['ville1_shop','ville_safe1_shop','ville3_shop','ville4_shop','ville5_shop','gen_shop1','gen_shop_route10','gen_shop_ville2_1','gen_shop_ville5_1',...Object.keys(departmentStore.floors)]);
function isShopMap(mapName) { return SHOP_MAPS.has(mapName); }
function shopTier(flags = {}) { return tiers.reduce((tier, entry, i) => entry.flag && flags[entry.flag] === 'true' ? Math.max(tier,i) : tier,0); }
function getShopMeta({mapName,flags={},expedition=false}={}) {
    const department=getDepartment(mapName);
    if(department)return {tier:expedition?tiers.length-1:shopTier(flags),badgeProgression:!expedition,name:`${departmentStore.name} · ${department.name}`,next:department.description,specialty:department.specialty,trainingAvailable:department.specialty==='training',department:department.number,directory:Object.values(departmentStore.floors).map(f=>({number:f.number,name:f.name}))};
    const tier=expedition?tiers.length-1:shopTier(flags),training=mapName==='ville5_shop';
    return {tier,name:expedition?'Fournitures d’expédition':tiers[tier].name,next:expedition?'Les objets achetés restent dans cette expédition.':tiers[tier].next,specialty:training?'training':null,trainingAvailable:training&&tier>=5};
}
function getShopCatalog(context = {}) {
    const {mapName,expedition=false}=context;
    if (mapName && !isShopMap(mapName)) return [];
    const department=getDepartment(mapName);
    if(department)return itemsCatalog.items.filter(item=>{
        const offer=department.offers[item.key];return offer&&offer.price>0&&(!offer.expeditionOnly||expedition);
    }).map(item=>{
        const offer=department.offers[item.key],requiredTier=offer.requiredTier||0;
        return {key:item.key,name:item.name,category:item.category,description:item.description||'',price:offer.price,fieldUse:item.fieldUse||null,
            locked:!expedition&&shopTier(context.flags)<requiredTier,requiredTier,
            unlockLabel:BADGE_LABELS[requiredTier],unlockLabelEn:BADGE_LABELS_EN[requiredTier],
            ...(item.purchaseLimit?{purchaseLimit:item.purchaseLimit}:{})};
    });
    const {tier}=getShopMeta(context);
    return (itemsCatalog.items || []).filter(item=>{
        const offer=offers[item.key],price=offer?.price ?? item.buy_price;
        if (!(Number(price)>0) || (item.dropOnly&&!offer) || (item.riftOnly&&!expedition&&!offer))return false;
        if (offer?.maps&&!offer.maps.includes(mapName))return false;
        return expedition || tier>=(offer?.tier||0);
    }).map(item=>({key:item.key,name:item.name,category:item.category,description:item.description||'',price:Math.floor(Number(offers[item.key]?.price ?? item.buy_price)),fieldUse:item.fieldUse||null,...(item.purchaseLimit?{purchaseLimit:item.purchaseLimit}:{})}));
}
// Any counter inside the tower can order from its four departments. Keep the
// historical floor-specific catalog for old clients and ordinary shops.
function getDepartmentCatalog(context = {}) {
    if (!getDepartment(context.mapName)) return null;
    return Object.entries(departmentStore.floors).flatMap(([mapName, floor]) =>
        getShopCatalog({ ...context, mapName }).map(item => ({ ...item, department: floor.number })));
}
function resolvePurchaseMap(mapName, department) {
    if (department === undefined) return mapName;
    if (!getDepartment(mapName) || !Number.isInteger(department)) return null;
    return Object.keys(departmentStore.floors).find(map => departmentStore.floors[map].number === department) || null;
}
module.exports = { getShopCatalog, getShopMeta, getDepartmentCatalog, resolvePurchaseMap, shopTier, isShopMap, SHOP_MAPS, getDepartment };

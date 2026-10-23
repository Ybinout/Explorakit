const itemsCatalog = require('../../../data/game/items.json');
const { tiers, offers } = require('../../../data/game/shop_offers.json');
const departmentStore = require('../../../data/game/department_store.json');
const getDepartment = mapName => Object.hasOwn(departmentStore.floors,mapName) ? departmentStore.floors[mapName] : null;
const SHOP_MAPS = new Set(['ville1_shop','ville_safe1_shop','ville3_shop','ville4_shop','ville5_shop','gen_shop1','gen_shop_route10','gen_shop_ville2_1','gen_shop_ville5_1',...Object.keys(departmentStore.floors)]);
function isShopMap(mapName) { return SHOP_MAPS.has(mapName); }
function shopTier(flags = {}) { return tiers.reduce((tier, entry, i) => entry.flag && flags[entry.flag] === 'true' ? Math.max(tier,i) : tier,0); }
function getShopMeta({mapName,flags={},expedition=false}={}) {
    const department=getDepartment(mapName);
    if(department)return {tier:shopTier(flags),name:`${departmentStore.name} · ${department.name}`,next:department.description,specialty:department.specialty,trainingAvailable:department.specialty==='training',department:department.number,directory:Object.values(departmentStore.floors).map(f=>({number:f.number,name:f.name}))};
    const tier=expedition?tiers.length-1:shopTier(flags),training=mapName==='ville5_shop';
    return {tier,name:expedition?'Fournitures d’expédition':tiers[tier].name,next:expedition?'Les objets achetés restent dans cette expédition.':tiers[tier].next,specialty:training?'training':null,trainingAvailable:training&&tier>=5};
}
function getShopCatalog(context = {}) {
    const {mapName,expedition=false}=context;
    if (mapName && !isShopMap(mapName)) return [];
    const department=getDepartment(mapName);
    if(department)return itemsCatalog.items.filter(item=>{
        const offer=department.offers[item.key];return offer&&offer.price>0&&(!offer.expeditionOnly||expedition);
    }).map(item=>({key:item.key,name:item.name,category:item.category,description:item.description||'',price:department.offers[item.key].price,fieldUse:item.fieldUse||null,...(item.purchaseLimit?{purchaseLimit:item.purchaseLimit}:{})}));
    const {tier}=getShopMeta(context);
    return (itemsCatalog.items || []).filter(item=>{
        const offer=offers[item.key],price=offer?.price ?? item.buy_price;
        if (!(Number(price)>0) || (item.dropOnly&&!offer) || (item.riftOnly&&!expedition&&!offer))return false;
        if (offer?.maps&&!offer.maps.includes(mapName))return false;
        return expedition || tier>=(offer?.tier||0);
    }).map(item=>({key:item.key,name:item.name,category:item.category,description:item.description||'',price:Math.floor(Number(offers[item.key]?.price ?? item.buy_price)),fieldUse:item.fieldUse||null,...(item.purchaseLimit?{purchaseLimit:item.purchaseLimit}:{})}));
}
module.exports = { getShopCatalog, getShopMeta, shopTier, isShopMap, SHOP_MAPS, getDepartment };

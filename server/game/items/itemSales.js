const {items}=require('../../../data/game/items.json');
const {offers}=require('../../../data/game/shop_offers.json');
const {floors}=require('../../../data/game/department_store.json');
const expeditionPotions=[
    {key:'drift_potion',name:'Potion',category:'heal',buy_price:100},
    {key:'drift_super_potion',name:'Super Potion',category:'heal',buy_price:300}
];
const byKey=new Map([...items,...expeditionPotions].map(i=>[i.key,i]));
function getSellPrice(key){
    const item=byKey.get(key);
    if(!item||item.category==='key'||item.purchaseLimit)return 0;
    if(Object.hasOwn(item,'sell_price'))return Math.max(0,Math.floor(Number(item.sell_price)||0));
    const prices=[item.buy_price,offers[key]?.price,...Object.values(floors).map(f=>f.offers[key]?.price)]
        .map(Number).filter(p=>Number.isFinite(p)&&p>0);
    // Half the lowest shop price: buying elsewhere can never fund a resale loop.
    return prices.length?Math.floor(Math.min(...prices)/2):0;
}
module.exports={getSellPrice};

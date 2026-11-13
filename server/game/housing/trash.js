const catalog = require('../../../data/game/items.json').items;
function definition(key) {
    return catalog.find(i=>i.key===key)||require('../corruption/modules').get(key);
}
function disposable(item) {
    return Boolean(item && item.category!=='key' && !item.unique
        && !item.darkContinentTravel && !item.superTournamentTravel && !item.voidTravel);
}
function selection(payload) {
    if(payload.confirm!==true||!Array.isArray(payload.items)||!payload.items.length||payload.items.length>100)
        throw Error('Choisis les objets et confirme leur suppression.');
    const seen=new Set();
    return payload.items.map(({key,quantity})=>{
        if(seen.has(key)||!disposable(definition(key))||!Number.isSafeInteger(quantity)||quantity<1)
            throw Error('Cette sélection contient un objet protégé ou une quantité invalide.');
        seen.add(key);return {key,quantity};
    }).sort((a,b)=>a.key.localeCompare(b.key));
}
module.exports={disposable,selection};

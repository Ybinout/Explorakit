const catalogue = require('../../../data/game/drifts.json');
const rarities = catalogue.rarities.map(r=>r.key);
const weights = Object.fromEntries(rarities.map((r,i)=>[r,2**i]));
const definitions = new Map(catalogue.definitions.map(d=>[d.id,d]));
function points(d) { return Math.max(weights[d?.rarity]||0, Math.min(1000000, Math.floor(Number(d?.fusionPoints)||0))); }
function summary(d) {
    const definition=definitions.get(d?.definitionId), total=points(d);
    const valid=rarities.filter(r=>definition?.values[r]!=null && weights[r]<=total);
    const rarity=valid.at(-1)||d?.rarity, next=rarities.find(r=>weights[r]>total&&definition?.values[r]!=null);
    const base=Number(definition?.values[rarity])||0;
    const value=next ? base+(definition.values[next]-base)*(total-weights[rarity])/(weights[next]-weights[rarity]) : base;
    return {rarity,value:Math.round(value*100)/100,points:total,nextPoints:next?weights[next]:null};
}
module.exports={weights,points,summary,value:d=>summary(d).value};

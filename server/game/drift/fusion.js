const catalogue = require('../../../data/game/drifts.json');
const effects = require('./driftEffects');
const report = require('./runReport');
const strength = require('./driftStrength');
const definitions = new Map(catalogue.definitions.map(d=>[d.id,d]));
function consolidate(p) {
    if(p.npc||p.inbattle||p.run?.phase==='results'||p.equipe?.pokemons.some(poke=>effects.states.has(poke)))return [];
    const groups=new Map(),merged=[];
    for(const d of p.drifts||[]){
        if(definitions.get(d.definitionId)?.values[d.rarity]==null)continue;
        const key=JSON.stringify([d.definitionId,d.element||null]);
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);
    }
    for(const group of groups.values()){
        group.sort((a,b)=>Number(p.equipped.includes(b.uuid))-Number(p.equipped.includes(a.uuid)));
        const kept=group[0];
        for(const consumed of group.slice(1)){
            const from=kept.rarity;
            kept.fusionPoints=Math.min(1000000,strength.points(kept)+strength.points(consumed));
            kept.rarity=strength.summary(kept).rarity;
            p.drifts=p.drifts.filter(d=>d.uuid!==consumed.uuid);
            report.driftFused(p,kept,consumed,from);
            merged.push({name:definitions.get(kept.definitionId).name,rarity:kept.rarity,value:strength.value(kept)});
        }
    }
    if(merged.length){p.ready=false;p.lastDriftFusion={count:merged.length,...merged.at(-1)};report.syncDrifts(p);}
    return merged;
}
function acquire(p,drift,source){p.drifts.push(drift);report.driftFound(p,drift,source);consolidate(p);}
module.exports={consolidate,acquire};

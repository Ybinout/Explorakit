const {createHash,randomInt}=require('node:crypto');
const habitats=require('../world/darkHabitats');
const COOLDOWN_MS=20*60*1000;
function pool(map,day){
 return [...new Set([...habitats.landPool(map),...(habitats.WATER[(Number(map.slice(6))-1)%3]||[])])].sort((a,b)=>key(day+':'+map+':'+a).localeCompare(key(day+':'+map+':'+b))).slice(0,12);
}
function key(s){return createHash('sha256').update(String(s)).digest('hex');}
function populate(r,day,previous=null,pick=randomInt){
 const candidates=pool(r.map,day).filter(id=>id!==previous);
 if(!candidates.length)throw Error('Aucun boss différent disponible dans cette zone.');
 r.bossSpecies=candidates[pick(candidates.length)];r.closedUntil=null;return r;
}
function upgrade(world){
 let changed=false;
 for(const r of world.rifts)if(!r.bossSpecies){r.generation=1;populate(r,world.day);changed=true;}
 return changed;
}
function bossSet(id,seed){
 const dex=require('../../../data/game/pokedex.json').find(p=>p.id===id);
 if(id===202)return {id,moves:['Counter','Mirror Coat','Safeguard','Destiny Bond'],ability:'Shadow Tag',nature:'Calm',special:true};
 const plan=require('../drift/colosseumSets').plan(id,30,parseInt(key(seed).slice(0,6),16),{key:'raid',abilities:[],attacks:[],support:[],role:'Boss'});
 return {id,moves:plan.moves,ability:plan.ability,nature:dex.base['Sp. Attack']>dex.base.Attack?'Modest':'Adamant',special:dex.base['Sp. Attack']>dex.base.Attack};
}
function closedWorld(world,run,now){
 if(!['won','lost'].includes(run.phase))return null;
 const r=world.rifts.find(r=>r.id===run.rift.id&&r.generation===run.rift.generation);
 if(!r||r.closedUntil)return null;
 const next=structuredClone(world),target=next.rifts.find(r=>r.id===run.rift.id);
 target.closedUntil=now+COOLDOWN_MS;
 target.from={x:target.x,y:target.y};target.to={...target.from};target.movedAt=now;
 return next;
}
function renew(previous,fresh,now){
 if(!previous)return fresh;
 for(const r of fresh.rifts){const old=previous.rifts.find(p=>p.difficulty===r.difficulty);if(old?.closedUntil>now){r.closedUntil=old.closedUntil;r.bossSpecies=old.bossSpecies;r.generation=old.generation||1;}}
 return fresh;
}
function reopen(world,now,pick=randomInt){
 let changed=false;
 for(const r of world.rifts)if(r.closedUntil&&r.closedUntil<=now){const previous=r.bossSpecies;populate(r,world.day,previous,pick);r.generation++;r.nextMove=now+120;changed=true;}
 return changed;
}
module.exports={renew,COOLDOWN_MS,pool,populate,upgrade,bossSet,closedWorld,reopen};

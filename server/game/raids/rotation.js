const {createHash,randomInt}=require('node:crypto');
const habitats=require('../world/darkHabitats');
const COOLDOWN_MS=20*60*1000,FINAL_COOLDOWN_MS=60*60*1000;
const {isFinal}=require('../world/darkContinent2');
const legendary=require('../drift/pokemonFactory').legendary;
function pool(map,day){
 const safari=require('../world/safari'),dc2=require('../world/darkContinent2');
 const entries=safari.isMap(map)?safariPool(day):dc2.isMap(map)?[...habitats.LAND[2],...habitats.WATER[2]]:[...habitats.landPool(map),...(habitats.WATER[(Number(map.slice(6))-1)%3]||[])];
 return [...new Set(entries)].filter(id=>id<=649&&!legendary.has(id)&&!evolving.has(id)).sort((a,b)=>key(day+':'+map+':'+a).localeCompare(key(day+':'+map+':'+b)));
}
const LEGENDARY_POOL=[...legendary].filter(id=>id<=649);
const evolving=new Set([...require('../../../data/game/evolutions.json').rules,...require('../../../data/game/stone_evolutions.json').rules].map(r=>r.from));
function safariPool(day){
 const safari=require('../world/safari'),now=Date.parse(day+'T12:00:00Z');
 return [...new Set(Array.from({length:15},(_,i)=>['grass','fishing','rare'].flatMap(method=>safari.pool('safari'+(i+1),method,now).map(([id])=>id))).flat())].filter(id=>id<=649&&!evolving.has(id)).sort((a,b)=>key(day+':safari:'+a).localeCompare(key(day+':safari:'+b)));
}
function anchor(r){return r.anchor||(/^safari/.test(r.map)?'safari:'+r.difficulty:'dark:'+r.map);}
function key(s){return createHash('sha256').update(String(s)).digest('hex');}
function populate(r,day,previous=null,pick=randomInt){
 const recent=[...new Set([...(r.recentBosses||[]),...(previous?[previous]:[])])].slice(-6);
 let selected=isFinal(r)||pick(100)<5?LEGENDARY_POOL:pool(r.map,day);
 if(isFinal(r))r.finalRotationVersion=1;
 if(!selected.length)selected=require('./content').SETS.map(s=>s.id);
 const fresh=selected.filter(id=>!recent.includes(id));
 if(fresh.length)selected=fresh;else if(selected.some(id=>id!==previous))selected=selected.filter(id=>id!==previous);
 r.bossSpecies=selected[pick(selected.length)];r.recentBosses=[...recent,r.bossSpecies].slice(-6);r.closedUntil=null;return r;
}

function upgrade(world,now=Date.now()){
 let changed=false;
 for(const r of world.rifts){
   if(!r.anchor){r.anchor=anchor(r);r.region=/^safari/.test(r.map)?'safari':'dark';r.color=r.region==='safari'?'orange':'violet';changed=true;}
   if(isFinal(r)&&r.finalRotationVersion!==1){
     if(r.closedUntil)r.closedUntil+=FINAL_COOLDOWN_MS-COOLDOWN_MS;
     r.finalRotationVersion=1;changed=true;
   }
   if(isFinal(r)&&r.bossSpecies&&!legendary.has(r.bossSpecies)){
     const deadline=r.closedUntil;populate(r,world.day,r.bossSpecies);r.closedUntil=deadline;
     r.generation=(r.generation||1)+1;changed=true;
   }
   if(!r.bossSpecies){r.generation||=1;populate(r,world.day);changed=true;}
   if(!Array.isArray(r.recentBosses)){r.recentBosses=[r.bossSpecies];changed=true;}
 }
 const content=require('./content'),existing=new Set(world.rifts.map(anchor));
 for(const a of content.anchors())if(!existing.has(a.anchor)){world.rifts.push(content.createRift(a,world.day,now));changed=true;}
 if(world.layoutVersion!==4){world.layoutVersion=4;changed=true;}
 return changed;
}
function bossSet(id,seed){
 return require('./safariBossSets').plan(id,seed);
}
function closedWorld(world,run,now){
 if(!['won','lost'].includes(run.phase))return null;
 const r=world.rifts.find(r=>r.id===run.rift.id&&r.generation===run.rift.generation);
 if(!r||r.closedUntil)return null;
 const next=structuredClone(world),target=next.rifts.find(r=>r.id===run.rift.id);
 target.closedUntil=now+(isFinal(target)?FINAL_COOLDOWN_MS:COOLDOWN_MS);
 target.from={x:target.x,y:target.y};target.to={...target.from};target.movedAt=now;
 return next;
}
function renew(previous,fresh,now){
 if(!previous)return fresh;
 for(const r of fresh.rifts){const old=previous.rifts.find(p=>anchor(p)===anchor(r));if(old?.closedUntil>now){r.finalRotationVersion=old.finalRotationVersion;r.closedUntil=old.closedUntil;r.bossSpecies=old.bossSpecies;r.seed=old.seed;r.recentBosses=old.recentBosses;r.generation=old.generation||1;r.map=old.map;r.x=old.x;r.y=old.y;r.from={x:old.x,y:old.y};r.to={...r.from};r.movedAt=now;}}
 return fresh;
}
function reopen(world,now,pick=randomInt){
 let changed=false;
 for(const r of world.rifts)if(r.closedUntil&&r.closedUntil<=now){const previous=r.bossSpecies;populate(r,world.day,previous,pick);r.generation++;r.nextMove=now+120;changed=true;}
 return changed;
}
module.exports={anchor,safariPool,renew,COOLDOWN_MS,FINAL_COOLDOWN_MS,pool,populate,upgrade,bossSet,closedWorld,reopen};

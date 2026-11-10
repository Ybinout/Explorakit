const {createHash,randomInt}=require('node:crypto');
const habitats=require('../world/darkHabitats');
const COOLDOWN_MS=20*60*1000;
function pool(map,day){
 if(map===require('../world/darkContinent2').config.final.map)return [...require('../drift/pokemonFactory').legendary].filter(id=>id<=649);
 const safari=require('../world/safari');
 const entries=safari.isMap(map)?safariPool(day):require('../world/darkContinent2').isMap(map)?[...habitats.LAND[2],...habitats.WATER[2]]:[...habitats.landPool(map),...(habitats.WATER[(Number(map.slice(6))-1)%3]||[])];
 return [...new Set(entries)].sort((a,b)=>key(day+':'+map+':'+a).localeCompare(key(day+':'+map+':'+b))).slice(0,12);
}
const evolving=new Set([...require('../../../data/game/evolutions.json').rules,...require('../../../data/game/stone_evolutions.json').rules].map(r=>r.from));
function safariPool(day){
 const safari=require('../world/safari'),now=Date.parse(day+'T12:00:00Z');
 return [...new Set(Array.from({length:15},(_,i)=>['grass','fishing','rare'].flatMap(method=>safari.pool('safari'+(i+1),method,now).map(([id])=>id))).flat())].filter(id=>id<=649&&!evolving.has(id));
}
function anchor(r){return r.anchor||(/^safari/.test(r.map)?'safari:'+r.difficulty:'dark:'+r.map);}
function key(s){return createHash('sha256').update(String(s)).digest('hex');}
function populate(r,day,previous=null,pick=randomInt){
 const candidates=pool(r.map,day).filter(id=>id!==previous);
 if(!candidates.length)throw Error('Aucun boss différent disponible dans cette zone.');
 r.bossSpecies=candidates[pick(candidates.length)];r.closedUntil=null;return r;
}
function upgrade(world,now=Date.now()){
 let changed=false;
 for(const r of world.rifts){
   if(!r.anchor){r.anchor=anchor(r);r.region=/^safari/.test(r.map)?'safari':'dark';r.color=r.region==='safari'?'orange':'violet';changed=true;}
   if(!r.bossSpecies){r.generation||=1;populate(r,world.day);changed=true;}
   if(require('../world/darkContinent2').isFinal(r)&&!r.closedUntil&&!require('../drift/pokemonFactory').legendary.has(r.bossSpecies)){
     populate(r,world.day,r.bossSpecies);r.generation=(r.generation||1)+1;changed=true;
   }
 }
 const content=require('./content'),existing=new Set(world.rifts.map(anchor));
 for(const a of content.anchors())if(!existing.has(a.anchor)){world.rifts.push(content.createRift(a,world.day,now));changed=true;}
 if(world.layoutVersion!==3){world.layoutVersion=3;changed=true;}
 return changed;
}
function bossSet(id,seed){
 if(id>493)return require('./safariBossSets').plan(id,seed);
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
 for(const r of fresh.rifts){const old=previous.rifts.find(p=>anchor(p)===anchor(r));if(old?.closedUntil>now){r.closedUntil=old.closedUntil;r.bossSpecies=old.bossSpecies;r.seed=old.seed;r.generation=old.generation||1;r.map=old.map;r.x=old.x;r.y=old.y;r.from={x:old.x,y:old.y};r.to={...r.from};r.movedAt=now;}}
 return fresh;
}
function reopen(world,now,pick=randomInt){
 let changed=false;
 for(const r of world.rifts)if(r.closedUntil&&r.closedUntil<=now){const previous=r.bossSpecies;populate(r,world.day,previous,pick);r.generation++;r.nextMove=now+120;changed=true;}
 return changed;
}
module.exports={anchor,safariPool,renew,COOLDOWN_MS,pool,populate,upgrade,bossSet,closedWorld,reopen};

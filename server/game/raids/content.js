const {
  randomInt,
  createHash
} = require('node:crypto');
const dc2=require('../world/darkContinent2');
const DIFFICULTIES = Object.freeze([{
  id: 'easy',
  name: 'Facile',
  level: 100,
  maps: ['jungle1'],
  scale: 1,
  reward: 100000,
  pearl: 0,
  plateChance: .5,
  hp: 6
}, {
  id: 'medium',
  name: 'Moyenne',
  level: 125,
  maps: ['jungle2', 'jungle4'],
  scale: 1.25,
  reward: 200000,
  pearl: .01,
  plateChance: .6,
  hp: 7
}, {
  id: 'hard',
  name: 'Difficile',
  level: 175,
  maps: ['jungle5', 'jungle7'],
  scale: 1.5,
  reward: 300000,
  pearl: .02,
  plateChance: .7,
  hp: 8
}, {
  id: 'veryhard',
  name: 'Très difficile',
  level: 200,
  maps: ['jungle3', 'jungle6', 'jungle8'],
  scale: 1.8,
  reward: 400000,
  pearl: .03,
  plateChance: .8,
  hp: 9
}, {
  id: 'extreme',
  name: 'Extrême',
  level: 300,
  maps: ['jungle9'],
  scale: 2.2,
  reward: 1000000,
  pearl: .05,
  plateChance: 1,
  hp: 10
},...([...new Set(dc2.config.maps.map(m=>m.raidLevel))].sort((a,b)=>a-b).map(level=>dc2.difficulty(level))),dc2.difficulty(1000,true)]);
const SETS = [{
  id: 34,
  moves: ['Earth Power', 'Sludge Wave', 'Thunderbolt', 'Surf'],
  ability: 'Sheer Force',
  nature: 'Modest',
  special: true
}, {
  id: 248,
  moves: ['Crunch', 'Rock Slide', 'Earthquake', 'Stone Edge'],
  ability: 'Sand Stream',
  nature: 'Adamant'
}, {
  id: 609,
  moves: ['Shadow Ball', 'Heat Wave', 'Flamethrower', 'Energy Ball'],
  ability: 'Flash Fire',
  nature: 'Modest',
  special: true
}, {
  id: 473,
  moves: ['Icicle Crash', 'Rock Slide', 'Earthquake', 'Ice Shard'],
  ability: 'Thick Fat',
  nature: 'Adamant'
}, {
  id: 635,
  moves: ['Dragon Pulse', 'Dark Pulse', 'Surf', 'Heat Wave'],
  ability: 'Levitate',
  nature: 'Modest',
  special: true
}];
function dayKey(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}
function midnight(now = Date.now()) {
  const key = dayKey(now);
  let lo = now,
    hi = now + 26 * 3600000;
  while (hi - lo > 1000) {
    const m = Math.floor((hi + lo) / 2);
    if (dayKey(m) === key) lo = m;else hi = m;
  }
  return Math.ceil(hi / 1000) * 1000;
}
function bossFor(rift) {
  const cfg = require('./training').config(rift) || DIFFICULTIES.find(d => d.id === rift.difficulty),
    set = rift.bossSpecies ? require('./rotation').bossSet(rift.bossSpecies,rift.seed) : SETS[rift.bossIndex],
    p = require('../drift/pokemonFactory').create(set.id, cfg.level, true);
  p.k = 4;
  p.iv = {
    hp: 31,
    attack: 31,
    defense: 31,
    specialAttack: 31,
    specialDefense: 31,
    speed: 31
  };
  p.ev = {
    hp: 252,
    attack: set.special ? 0 : 252,
    defense: 0,
    specialAttack: set.special ? 252 : 0,
    specialDefense: 6,
    speed: 0
  };
  p.nature = set.nature;
  p.passiveAbility = set.ability;
  p.abilities = [];
  p.movePp = [];
  for (const m of set.moves) p.addAbility(m);
  p.heldItem = null;
  p.corruption = {
    version: 1,
    revision: 1,
    permanent: true,
    modules: {}
  };
  p.recalculateStats();
  p.currentHp = p.maxHp;
  return p;
}
let sharedNpcStore;
function blockedByNpc(map,x,y){
 sharedNpcStore ||= require('../world/safari').scopedStore(require('../world/darkContinent').scopedStore(require('../world/pnjStore'),()=>({owned:true})));
 return sharedNpcStore.isPnjBlockingTile(map,x,y);
}
function tiles(map) {
  const terrain = require('../world/mapRepository'),
    grid = terrain.loadCollisionData(map),
    change = terrain.changeMapData(map);
  const out = [];
  for (let y = 3; y < grid.length - 3; y++) for (let x = 3; x < grid[y].length - 3; x++) if (grid[y][x] === 0 && !change[y]?.[x] && !blockedByNpc(map, x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => grid[y + dy]?.[x + dx] === 0 && !change[y + dy]?.[x + dx]).length >= 3) out.push({
    x: x * 32 + 16,
    y: y * 32 + 16
  });
  return out;
}
// Nine permanent jungle anchors and five daily Safari circuits. Anchor identity
// is independent from difficulty so cooldowns never bleed into another rift.
function anchors() {
  const dark=DIFFICULTIES.filter(d=>!d.id.startsWith('dc2-')).flatMap(d=>d.maps.map(map=>({anchor:'dark:'+map,region:'dark',color:'violet',difficulty:d.id,maps:[map]})));
  const safari=DIFFICULTIES.filter(d=>!d.id.startsWith('dc2-')).map((d,i)=>({anchor:'safari:'+d.id,region:'safari',color:'orange',difficulty:d.id,maps:Array.from({length:3},(_,j)=>'safari'+(i*3+j+1))}));
  const newLand=dc2.config.maps.filter(m=>m.mapName!==dc2.config.final.map).map(m=>({anchor:'dark2:'+m.mapName,region:'dark2',color:'violet',difficulty:'dc2-'+m.raidLevel,maps:[m.mapName]}));
  return [...dark,...safari,...newLand,{anchor:'dark2:final',region:'dark2',color:'violet',difficulty:'dc2-final',maps:[dc2.config.final.map],fixed:true}];
}
function createRift(a,day,now) {
  const map=a.maps[randomInt(a.maps.length)],positions=a.fixed?[{x:dc2.config.final.x,y:dc2.config.final.y}]:tiles(map).filter(p=>!dc2.isMap(map)||require('../world/darkContinent2Topology').reachable(map,p.x,p.y));
  if(!positions.length)throw Error('Aucune position sûre pour la faille '+a.anchor);
  const p=positions[randomInt(positions.length)];
  return require('./rotation').populate({
    id:day+':'+a.anchor,anchor:a.anchor,region:a.region,color:a.color,
    difficulty:a.difficulty,...(a.fixed?{fixed:true}:{}),map,...p,from:{...p},to:{...p},movedAt:now,
    nextMove:now+120,moveDurationMs:450,bossIndex:randomInt(SETS.length),generation:1,
    seed:createHash('sha256').update(day+':'+a.anchor+':'+randomInt(1e9)).digest('hex').slice(0,12)
  },day);
}
function createDay(now=Date.now()) {
  const day=dayKey(now);
  return {day,layoutVersion:3,renewsAt:midnight(now),rifts:anchors().map(a=>createRift(a,day,now))};
}
const secureRandom=()=>randomInt(0x100000000)/0x100000000;
function rewards(rift, random = secureRandom) {
  const difficulty=typeof rift==='string'?rift:rift.difficulty;
  const d = DIFFICULTIES.find(d => d.id === difficulty);
  if (!d) throw Error('Difficulté inconnue.');
  const items = require('../../../data/game/items.json').items.filter(i => i.plateType).filter(() => random() < d.plateChance).map(i => ({
    key: i.key,
    name: i.name,
    quantity: Math.floor(d.quantityScale||1)+((d.quantityScale||1)%1>0&&random()<(d.quantityScale%1)?1:0)
  }));
  if (random() < d.pearl) items.push({
    key: 'potential_pearl',
    name: 'Perle de Potentiel',
    quantity: 1
  });
  const catalog = require('../../../data/game/items.json').items;
  for (const [key,quantity] of [['crystal_shard',100],['clear_crystal',30],['aurora_prism',6]]) items.push({key,name:catalog.find(i=>i.key===key).name,quantity:Math.round(quantity*(d.quantityScale||1))});
  if(dc2.isFinal(rift)){const pearl=items.find(i=>i.key==='potential_pearl');if(pearl)pearl.quantity+=2;else items.push({key:'potential_pearl',name:'Perle de Potentiel',quantity:2});}
  return { money: d.reward, items };
}
module.exports = {
  secureRandom,
  blockedByNpc,
  DIFFICULTIES,
  SETS,
  dayKey,
  midnight,
  bossFor,
  tiles,
  createDay,
  anchors,
  createRift,
  rewards
};

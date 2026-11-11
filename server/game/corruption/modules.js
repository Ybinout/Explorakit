const recipes = require('../../../data/game/corruption_recipes.json');
const moves = require('../../../data/game/moves.json');
const dex = require('../../../data/game/pokedex.json');
const {getSpeciesAbilitySlots} = require('../abilities/abilityDex');
const coverage = require('../abilities/abilityCoverage');
const {isCorruptionPillAbilityAllowed} = require('../abilities/pillAbilityPolicy');
const {TYPES} = require('../world/darkContinent');
const moveNames = require('../../../data/game/corruption_labels.fr.json').moves;
const abilityNames = require('../../../data/game/corruption_labels.fr.json').abilities;
const FAMILIES = Object.freeze({move:'CS corrompue',ability:'Pilule Talent corrompue',type:'Module Type',combat:'Module de combat'});
const registry = new Map(), pools = {};
const speciesBound = new Set(['Forecast','Flower Gift','Multitype','RKS System','Zen Mode','Stance Change','Schooling','Shields Down','Power Construct','Battle Bond','Disguise']);
function add(key,module,name,description){registry.set(key,Object.freeze({key,name,description,category:'corruption',sell_price:0,buy_price:0,corruptionModule:Object.freeze(module)}));return key;}
// Permanent move-copying would bypass the single corrupted-CS slot. Normal Sketch remains unchanged.
for(const move of moves)if(move.ename!=='Struggle'&&!move.combat?.effects?.some(e=>e.kind==='copy_move_permanent'))add('cmod_move_'+move.id,{family:'move',move:move.ename,type:move.type},'CS corrompue · '+(moveNames[move.ename] || move.ename),'Une attaque universelle. Son apprentissage corrompt définitivement le Pokémon et occupe une de ses quatre capacités.');
const abilities = [...new Set(dex.filter(p=>p.id<=649).flatMap(p=>getSpeciesAbilitySlots(p.id).filter(a=>!a.special).map(a=>a.name)))].filter(a=>coverage.status(a)==='single_battle'&&!speciesBound.has(a)).sort();
for(const ability of abilities)add('cmod_ability_'+ability.toLowerCase().replace(/[^a-z0-9]/g,''),{family:'ability',ability},'Pilule corrompue · '+(abilityNames[ability] || ability),'Remplace le talent, quelle que soit l’espèce. La corruption est définitive.');
for(const[type,label]of Object.entries(TYPES)){
 add('cmod_type_'+type.toLowerCase(),{family:'type',type},'Module Type · '+label,'Ajoute ce type à un Pokémon monotype, remplace un type au hasard s’il en a deux, ou retire ce type s’il est déjà présent. Ne peut pas supprimer son seul type.');
 for(const direction of ['offense','defense'])add(`cmod_${direction}_${type.toLowerCase()}`,{family:'combat',type,direction},`Module ${direction==='offense'?'Offensif':'Défensif'} · ${label}`,direction==='offense'?`Dégâts des attaques ${label} +20 %.`:`Dégâts reçus des attaques ${label} −30 %.`);
 const names=new Set(dex.filter(p=>p.id<=649&&p.type.includes(type)).flatMap(p=>getSpeciesAbilitySlots(p.id).map(a=>a.name)));
 pools[type]={move:[...registry.values()].filter(i=>i.corruptionModule.family==='move'&&i.corruptionModule.type===type).map(i=>i.key),ability:[...registry.values()].filter(i=>i.corruptionModule.family==='ability'&&names.has(i.corruptionModule.ability)&&isCorruptionPillAbilityAllowed(i.corruptionModule.ability)).map(i=>i.key)};
}
function get(key){return typeof key==='string'?registry.get(key)||null:null;}
function recipe(family,type){if(!Object.hasOwn(FAMILIES,family)||!Object.hasOwn(TYPES,type))throw Error('Choisis une station et une plaque de type.');const {crystalMultiplier:n,plates}=recipes.families[family];return[{key:'crystal_shard',quantity:40*n},{key:'clear_crystal',quantity:20*n},{key:'aurora_prism',quantity:10*n},{key:'dark_plate_'+type.toLowerCase(),quantity:plates}];}
function roll(random){const value=random();if(!Number.isFinite(value)||value<0||value>=1)throw Error('Tirage invalide.');return value;}
function craft(family,type,random=Math.random){recipe(family,type);if(family==='combat')return roll(random)<.5?{created:false,itemKey:null}:{created:true,itemKey:`cmod_${roll(random)<.5?'offense':'defense'}_${type.toLowerCase()}`};if(family==='type')return{created:true,itemKey:'cmod_type_'+type.toLowerCase()};const pool=pools[type][family];if(!pool.length)throw Error('Aucun module disponible pour ce type.');return{created:true,itemKey:pool[Math.floor(roll(random)*pool.length)]};}
module.exports={RECIPE_VERSION:recipes.version,FAMILIES,TYPES,registry,pools,get,recipe,craft,roll};

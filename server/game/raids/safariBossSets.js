// Safari species share the imported Gen VII learnability catalogue used by CS.
// Do not feed them to the older Colosseum planner's Gen I-IV TM-only pool.
const reference=require('../../../data/vendor/pokeapi/learnsets.gen7.json');
const moves=require('../../../data/game/moves.json');
const dex=new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
const {chooseSpeciesAbility,createDeterministicRandom}=require('../abilities/abilityDex');
const conditional=new Set(['Focus Punch','Last Resort','Dream Eater','Belch','Snore','Fake Out','First Impression','Sucker Punch','Burn Up','Synchronoise','Future Sight','Doom Desire']);
function plan(id,seed){
 const species=dex.get(id),learn=reference.species[id];
 if(!species||!learn)throw Error('Catalogue Safari absent pour '+id);
 const legal=new Set([...learn.level.map(([level,move])=>move),...learn.egg,...learn.machine,...learn.tutor]);
 const native=require('./ruleset').dex;
 const available=moves.filter(m=>legal.has(m.id)).map(m=>native.moves.get(m.ename)).filter(m=>m.exists&&m.basePower>0&&m.basePower<=120&&!m.flags.charge&&!m.flags.recharge&&!m.selfdestruct&&!conditional.has(m.name));
 const special=species.base['Sp. Attack']>species.base.Attack,selected=[];
 const score=m=>m.basePower*(m.accuracy===true?1:m.accuracy/100)*(species.type.includes(m.type)?1.5:1)*(m.category===(special?'Special':'Physical')?1:.65)*(selected.some(n=>n.type===m.type)?.35:1);
 while(selected.length<4){const next=available.filter(m=>!selected.includes(m)).sort((a,b)=>score(b)-score(a)||a.num-b.num)[0];if(!next)break;selected.push(next);}
 if(selected.length!==4)throw Error('Quatre attaques légales requises pour le boss Safari '+id);
 let ability=chooseSpeciesAbility(id,createDeterministicRandom('raid:'+seed),0);
 // These two abilities can leave a lone boss unable to act for an entire raid.
 if(['Klutz','Truant'].includes(ability))ability=Object.values(native.species.get(species.name.english).abilities).find(a=>!['Klutz','Truant'].includes(a))||ability;
 return {id,moves:selected.map(m=>m.name),ability,nature:special?'Modest':'Adamant',special};
}
module.exports={plan};

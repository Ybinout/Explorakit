const factory=require('../drift/pokemonFactory');
const {assignNaturalMoves}=require('../models/moveLearning');
const {chooseSpeciesAbility}=require('../abilities/abilityDex');
const CHANCE=.30,SHINY_CHANCE=.01;
function roll(rift,boss,random=require('./content').secureRandom){
 if(rift.training||random()>=CHANCE)return null;
 boss ||= require('./content').bossFor(rift);
 const shiny=random()<SHINY_CHANCE,id=Number(boss?.data?.id||rift.bossSpecies),level=Number(boss?.level||rift.level);
 if(!Number.isInteger(id)||!Number.isInteger(level)||level<1||level>1000)throw Error('Récompense de Pokémon invalide.');
 const p=assignNaturalMoves(factory.create(id,level,false,random));
 p.k=4;p.ev={hp:0,attack:0,defense:0,specialAttack:0,specialDefense:0,speed:0};
 p.passiveAbility=chooseSpeciesAbility(id,random);p.corruption=null;p.heldItem=null;p.shiny=shiny;
 p.recalculateStats();p.currentHp=p.maxHp;
 return p;
}
function view(p,position){return{uuid:p.uuid,pokemonId:p.data.id,name:p.truename||p.data.name.french,level:p.level,k:4,shiny:!!p.shiny,corrupted:false,destination:'pc',...position};}
module.exports={CHANCE,SHINY_CHANCE,roll,view};

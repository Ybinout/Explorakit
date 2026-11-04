const codec=require('../drift/checkpointCodec');
const {healTeam}=require('../world/playerRecovery');
const {getTotalExperienceForLevel}=require('../models/progression');
const layout=require('../../../data/game/whitepeak_layout.json');
const CASINO='ville5_maison2',HALL='ville5_maison1';
const PODIUMS=layout.podiums.map(p=>({x:p.tileX,y:p.tileY}));
const PLACEMENT_TIMEOUT=50000;
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
function fail(message){throw Object.assign(Error(message),{statusCode:409});}
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))fail('Identifiant invalide.');return value;}
function amount(value,max=1000000,min=0){if(!Number.isSafeInteger(value)||value<min||value>max)fail(`Choisis un montant entre ${min} et ${max} ₽.`);return value;}
function settings(data={}){
 if(data.mode!==undefined&&!['1v1','pve','2v1','2v2'].includes(data.mode))fail('Format de combat inconnu.');
 if(data.mode==='2v2'&&data.format!==undefined&&![6,12].includes(data.format))fail('Choisis le format 6v6 ou 12v12.');
 if(![null,25,50,75,100].includes(data.level??null))fail('Choisis un niveau libre, 25, 50, 75 ou 100.');
 if(data.uniqueItems!==undefined&&typeof data.uniqueItems!=='boolean'||data.pokemonStake!==undefined&&typeof data.pokemonStake!=='boolean')fail('Règles invalides.');
 const config={level:data.level??null,uniqueItems:!!data.uniqueItems,money:amount(data.money??0),pokemonStake:!!data.pokemonStake};
 if(data.mode){config.mode=data.mode;if(data.mode==='2v2')config.format=data.format||6;}
 if(data.mode==='pve'){if(typeof data.trainerKey!=='string'||data.trainerKey.length>80)fail('Choisis un dresseur.');config.trainerKey=data.trainerKey;if(config.money||config.pokemonStake)fail('L’entraînement PvE se joue sans mise.');}
 if(['2v1','2v2'].includes(data.mode)&&config.pokemonStake)fail('Les mises de Pokémon sont réservées au duel 1v1.');
 return config;
}
function validateTeam(team,config,{maxSize=6}={}){
 if(!Array.isArray(team)||!team.length||team.length>maxSize||team.some(p=>p.isEgg))fail(`Présente une équipe de un à ${maxSize} Pokémon, sans Œuf.`);
 if(!team.some(p=>p.currentHp>0))fail('Soigne ton équipe avant de rejoindre le socle.');
 if(config.uniqueItems){const held=team.map(p=>p.heldItem).filter(Boolean);if(new Set(held).size!==held.length)fail('Objets uniques : deux de tes Pokémon portent le même objet.');}
}
function battleCopy(player,team,config,options){
 validateTeam(team,config,options);const equipe=codec.decode(codec.encode({pokemons:team}));
 for(const p of equipe.pokemons)if(config.level){
  p.experience=getTotalExperienceForLevel(config.level,p.experienceRate);
  p.level=p.calculateLevelFromExperience(p.experience);p.recalculateStats();
 }
 healTeam(equipe);
 return {id:player.id,userId:null,username:player.username,name:player.name,currentmap:HALL,equipe,items:{},inbattle:true};
}
function choice(value){
 if(!value||!['number','red','black','even','odd','low','high'].includes(value.kind))fail('Choisis une case de la roulette.');
 if(value.kind==='number'&&(!Number.isInteger(value.number)||value.number<0||value.number>36))fail('Choisis un numéro entre 0 et 36.');
 return value.kind==='number'?{kind:'number',number:value.number}:{kind:value.kind};
}
function payout(bet,result){
 if(!Number.isInteger(result)||result<0||result>36)fail('Résultat invalide.');
 const c=choice(bet.choice),n=amount(bet.amount,1000000,100);
 const win=c.kind==='number'?c.number===result:result!==0&&({red:RED.has(result),black:!RED.has(result),even:result%2===0,odd:result%2===1,low:result<=18,high:result>=19}[c.kind]);
 return win?n*(c.kind==='number'?36:2):0;
}
function near(player,x,y,distance=2){return !!player&&Math.abs(Math.floor(player.x/32)-x)+Math.abs(Math.floor(player.y/32)-y)<=distance;}
function besideCasinoFurniture(player,left,top,right,bottom){
 if(player?.currentmap!==CASINO)return false;
 const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
 return Math.max(left-x,0,x-right)+Math.max(top-y,0,y-bottom)===1;
}
function atCasinoCounter(player){return besideCasinoFurniture(player,2,3,5,5);}
function atRouletteTable(player){return besideCasinoFurniture(player,9,6,18,10);}
function podium(player){
 if(player?.currentmap!==HALL)return -1;
 return layout.podiums.findIndex(p=>Math.pow((player.x-p.x)/p.rx,2)+Math.pow((player.y+layout.feetOffsetY-p.y)/p.ry,2)<=1);
}
module.exports={CASINO,HALL,PODIUMS,PLACEMENT_TIMEOUT,RED,WHEEL,fail,uuid,amount,settings,validateTeam,battleCopy,choice,payout,near,podium,atCasinoCounter,atRouletteTable};

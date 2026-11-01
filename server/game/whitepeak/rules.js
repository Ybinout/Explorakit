const codec=require('../drift/checkpointCodec');
const {healTeam}=require('../world/playerRecovery');
const CASINO='ville5_maison2',HALL='ville5_maison1';
const PODIUMS=[{x:8,y:8},{x:19,y:8}];
const PLACEMENT_TIMEOUT=50000;
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
function fail(message){throw Object.assign(Error(message),{statusCode:409});}
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))fail('Identifiant invalide.');return value;}
function amount(value,max=1000000,min=0){if(!Number.isSafeInteger(value)||value<min||value>max)fail(`Choisis un montant entre ${min} et ${max} ₽.`);return value;}
function settings(data={}){
 if(![null,25,50,75,100].includes(data.level??null))fail('Choisis un niveau libre, 25, 50, 75 ou 100.');
 if(data.uniqueItems!==undefined&&typeof data.uniqueItems!=='boolean'||data.pokemonStake!==undefined&&typeof data.pokemonStake!=='boolean')fail('Règles invalides.');
 return {level:data.level??null,uniqueItems:!!data.uniqueItems,money:amount(data.money??0),pokemonStake:!!data.pokemonStake};
}
function validateTeam(team,config){
 if(!Array.isArray(team)||!team.length||team.length>6||team.some(p=>p.isEgg))fail('Présente une équipe de un à six Pokémon, sans Œuf.');
 if(!team.some(p=>p.currentHp>0))fail('Soigne ton équipe avant de rejoindre le socle.');
 if(config.uniqueItems){const held=team.map(p=>p.heldItem).filter(Boolean);if(new Set(held).size!==held.length)fail('Objets uniques : deux de tes Pokémon portent le même objet.');}
}
function battleCopy(player,team,config){
 validateTeam(team,config);const equipe=codec.decode(codec.encode({pokemons:team}));
 for(const p of equipe.pokemons)if(config.level){p.level=config.level;p.recalculateStats();}
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
function podium(player){return player?.currentmap===HALL?PODIUMS.findIndex(p=>near(player,p.x,p.y,0)):-1;}
module.exports={CASINO,HALL,PODIUMS,PLACEMENT_TIMEOUT,RED,WHEEL,fail,uuid,amount,settings,validateTeam,battleCopy,choice,payout,near,podium};

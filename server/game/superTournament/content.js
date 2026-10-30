const Pokemon=require('../models/Pokemon');
const {getTotalExperienceForLevel,getExperienceRate}=require('../models/progression');
const {pnjTeams}=require('../world/pnjTeamFactory');
const {healTeam}=require('../world/playerRecovery');
const {gender:pokemonGender}=require('../items/stoneEvolution');
const MAPS={lobby:'super_tournament_lobby',sas:'super_tournament_sas',room:'super_tournament_room'};
const PASS='super_tournament_pass',POINTS_PER_KO=100;
const roster=[
 ['Wayne','dia1','timmy',[19,19,20],'perso1.png','wayne-eyepatch-v2.png','trainer'],
 ['Aspha','aspha_route2','aspha_route2',[475,373,448],'aspha-pixel-v4.png','aspha-v1.png','trainer'],
 ['Maria','town_lina','town_lina',[18,174,131],'perso2.png','maria-v2.png','trainer'],
 ['Clément','town_bastien','town_bastien',[55,474,398],'clement-pixel-v2.png','clement-v2.png','trainer'],
 ['NOZ','nrv_noz','nrv_noz',[430,472,461],'nrv-noz.png','nrv-noz-v1.png','trainer'],
 ['TOM','nrv_tom','nrv_tom',[462,405,474],'nrv-tom.png','nrv-tom-v1.png','trainer'],
 ['CRY','nrv_cry','nrv_cry',[184,121,365],'nrv-cry.png','nrv-cry-v1.png','trainer'],
 ['Mounir','moonpunch','moonpunch',[271,208,351],'moonpunch.png','moonpunch.png','mounir'],
 ['Hoze','champion_hoze','hoze',[253,448,445],'hoze.png','hoze.png','hoze'],
 ['Matthieu','gwenn_route8','gwenn_route8',[121,130,157],'matthieu-pixel-v3.png','matthieu-v2.png','trainer'],
 ['Raphael','champion_raphael','raphael',[55,330,212],'raph.png','raph.png','raph'],
 ['Ana','champion_ana','ana',[154,407,282],'ana.png','ana.png','ana'],
 ['Wanda','champion_wanda','wanda',[121,373,376],'wanda.png','wanda.png','wanda'],
 ['Gwenn','gwenn_rochebrume','gwenn_rochebrume',[227,248,94],'gwenn-pixel-v3.png','gwenn-v1.png','gwenn'],
 ['7p','champion_7p','sevenp',[51,257,130],'7ps.png','7ps.png','7p'],
 ['Lucie','lucie_corrupted','lucie_corrupted',[395,65,350],'lucie-pixel-v2.png','lucie-v1.png','lucie']
].map(([name,key,source,species,sprite,portrait,music])=>({name,key,source,species,sprite,portrait,music}));
// High-level replacements for the early adventure teams. Explicit sets avoid
// carrying their deliberately weak early-game moves into a level 100 challenge.
const sets={
19:['Return','Quick Attack','U-turn','Super Fang'],20:['Facade','Crunch','Sucker Punch','Swords Dance'],
475:['Close Combat','Psycho Cut','Shadow Sneak','Swords Dance'],373:['Dragon Dance','Dragon Claw','Earthquake','Fire Blast'],448:['Aura Sphere','Flash Cannon','Dark Pulse','Nasty Plot'],
18:['Brave Bird','Return','U-turn','Roost'],174:['Reflect','Light Screen','Thunder Wave','Seismic Toss'],131:['Surf','Ice Beam','Thunderbolt','Perish Song'],
55:['Scald','Ice Beam','Psychic','Calm Mind'],474:['Tri Attack','Ice Beam','Thunderbolt','Dark Pulse'],398:['Brave Bird','Return','Close Combat','U-turn'],
430:['Brave Bird','Sucker Punch','Superpower','Roost'],472:['Earthquake','Roost','Knock Off','Swords Dance'],461:['Icicle Crash','Knock Off','Ice Shard','Low Kick'],
462:['Thunderbolt','Flash Cannon','Volt Switch','Hidden Power'],405:['Wild Charge','Crunch','Ice Fang','Superpower'],184:['Waterfall','Play Rough','Aqua Jet','Superpower'],121:['Surf','Ice Beam','Thunderbolt','Recover'],365:['Surf','Ice Beam','Toxic','Protect'],66:['Dynamic Punch','Knock Off','Ice Punch','Bullet Punch']};
function entryFor(index){if(!Number.isSafeInteger(index)||index<0)throw Error('Salle inconnue.');return roster[index%roster.length];}
function createTeam(index){
 const entry=entryFor(index);
 const source=pnjTeams.get(entry.source)?.team||[];
 const pokemons=entry.species.map((id,slot)=>{
  const original=source.find(p=>p.pokemonId===id)||{};
  const data=require('../../../data/game/pokedex.json').find(p=>p.id===id);
  const physical=['Fighting','Normal','Flying','Dark','Ground','Steel'].includes(data.type[0]);
  const pokemon=new Pokemon(id,null,null,getTotalExperienceForLevel([85,95,100][slot],getExperienceRate(data.exp)),Object.fromEntries(['hp','attack','defense','specialAttack','specialDefense','speed'].map(k=>[k,31])),original.nature||(physical?'Jolly':'Timid'),4,original.ev||{[physical?'attack':'specialAttack']:252,speed:252,hp:4});
  for(const move of sets[id]||original.abilities||[])pokemon.addAbility(move);
  pokemon.passiveAbility=original.passiveAbility||pokemon.passiveAbility;
  pokemon.heldItem=original.heldItem||(['leftovers','life_orb','focus_sash'][slot]);
  return pokemon;
 });
 const team={pokemons};healTeam(team);
 // No ace is artificially withheld; the shared human AI evaluates all reserves.
 return team;
}
function eligible(progress){return require('../world/mirrorRift').state(progress).stage==='complete';}
function invitation(progress){return eligible(progress)&&progress.flags?.super_tournament_invited!=='true';}
const invitationLines=[
 'Lucie : Hé, doucement ! On t’a retrouvé inconscient… Tu as dormi deux jours entiers. J’ai bien cru que tu allais encore nous faire une frayeur.',
 'Lucie : Pendant ce temps, les champions ont organisé le Super Tournoi, sur l’île au large. Et cette fois, je participe aussi !',
 'Lucie : Après tous ceux que tu as battus, ils te réservent une place. Tiens, ton PASS Super Tournoi. Tu peux l’utiliser depuis ton sac pour rejoindre l’accueil.',
 'Lucie : Repose-toi encore si tu en as besoin. Moi, je compte bien être prête quand on se retrouvera là-bas !'
].map(text=>({text,imageName:'lucie-v1.png',typewriterMs:40}));
function state(run){return run?{active:true,endless:true,phase:run.phase,room:run.room+1,cycle:Math.floor(run.room/roster.length)+1,cycleRoom:run.room%roster.length+1,total:roster.length,score:run.score,opponent:entryFor(run.room).name,team:run.player.equipe.pokemons.map(p=>({...p,gender:p.data?.id&&p.uuid?pokemonGender(p):p.gender||null})),reward:require('./rewards').viewOffer(run.reward,run.player.equipe.pokemons)}: {active:false};}
module.exports={MAPS,PASS,roster,entryFor,createTeam,POINTS_PER_KO,eligible,invitation,invitationLines,state};

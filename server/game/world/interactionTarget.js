const computer=require('./pokemonComputer'),workstations=require('../corruption/workstations');
const lab=require('./labStory'),voidEnding=require('./voidEnding'),mirror=require('./mirrorRift'),obstacles=require('./roomObstacles');
const dialogue=require('./interactionRepository');
function adjacentTarget(player,matrix,actorAt){
 const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
 for(const position of [{x,y:y-1},{x,y:y+1},{x:x-1,y},{x:x+1,y}]){
  const pnj=actorAt(player.currentmap,position.x,position.y);
  if(pnj)return{position,pnj};
  if(matrix?.[position.y]?.[position.x])return{position,pnj:null};
 }
 return null;
}
// Read-only preview: the action handlers still authorize and execute every action.
// All inputs are session/world caches; this path performs no persistence or RNG.
function available({player,progress={},blocked=false,matrix,actorAt=()=>null,clubTarget,darkTarget,tournamentTarget,fishingTarget,fishingActive=false,nearbyPlayer,mirrorSupported=true}){
 if(!player||blocked||player.inbattle||player.inventoryBusy||player.darkRulesRequired||player.darkScoutBusy)return false;
 if(require('../experienceExchange/laboratory').nearby(player))return true;
 if(workstations.stationAt(player)||clubTarget?.()||darkTarget?.()||tournamentTarget?.()||fishingTarget?.())return true;
 if(fishingActive)return false;
 if(mirrorSupported&&mirror.interaction(player,progress))return true;
 const ending=voidEnding.state(progress);
 if(ending.available){
  if(player.currentmap==='professor_lab'&&voidEnding.adjacent(player,voidEnding.config.pickup)&&!ending.found)return true;
  if(ending.found&&ending.charge===5&&(voidEnding.journalAt(player)||voidEnding.adjacent(player,voidEnding.config.professor)))return true;
 }
 if(lab.interaction(player,progress)||obstacles.nearby(player,lab.view(progress))||computer.isNearComputer(player)||nearbyPlayer?.())return true;
 const target=adjacentTarget(player,matrix,actorAt);
 if(!target)return false;
 return target.pnj?dialogue.hasDialogueForName(target.pnj.interactionName||target.pnj.name,progress):dialogue.hasDialogueForMapAndPosition(player.currentmap,target.position.x,target.position.y,progress);
}
module.exports={adjacentTarget,available};

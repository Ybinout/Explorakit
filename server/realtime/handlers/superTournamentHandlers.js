const content=require('../../game/superTournament/content');
const repository=require('../../persistence/superTournamentRepository');
const {TournamentController}=require('../../game/superTournament/controller');
const pnjStore=require('../../game/world/pnjStore');
const npcMaps=['start','route2','ville1','route3_maison_nrv','ville1_arene','ville_safe1_arene','gen_route8','gen_arene5','ville3_arene','ville4_arene','route4_maison','ville5_arene','route2_maison'];
const npcs=npcMaps.flatMap(m=>pnjStore.getPnjsForMap(m));
function actor(run){const e=content.entryFor(run?.room||0);const source=npcs.find(n=>[e.source,e.key,...(e.source==='lucie_corrupted'?['lucie_route2']:[])].includes(n.name));return {...source,name:source?.name||e.source,interactionName:'super_tournament_challenger',sprite:source?.sprite||'sprite.png',spriteFrame:source?.spriteFrame||null,map:content.MAPS.room,x:13,y:9,block:true,roamRadius:0};}
function actors(map,run){if(map===content.MAPS.lobby)return [{name:'super_tournament_host',interactionName:'super_tournament_host',sprite:'townspeople.png',spriteFrame:{columns:8,rows:4,index:19},map,x:13,y:5,block:true,roamRadius:0}];if(map===content.MAPS.room&&run)return [actor(run)];return [];}
function scopedStore(base,getRun){return {...base,getPnjsForMap:map=>[...base.getPnjsForMap(map),...actors(map,getRun())],getPnjAtTile:(map,x,y)=>actors(map,getRun()).find(n=>n.x===x&&n.y===y)||base.getPnjAtTile(map,x,y),isPnjBlockingTile:(map,x,y)=>actors(map,getRun()).some(n=>n.x===x&&n.y===y)||base.isPnjBlockingTile(map,x,y)};}
function createHandlers({socket,account,userId,getPlayer,canUse,travel,refreshActors}){
 const controller=new TournamentController({userId,getPlayer,emit:(e,d)=>{if(socket.connected)socket.emit(e,d);},travel});let timer=null,lastBoard=0,offer=null;
 const near=(x,y,d=2)=>{const p=getPlayer();return p&&Math.abs(Math.floor(p.x/32)-x)+Math.abs(Math.floor(p.y/32)-y)<=d;};
 const valid=()=>{const p=getPlayer();if(!p||p.inbattle||p.inventoryBusy||!canUse())throw Error('Termine ton action avant de continuer.');return p;};
 const command=(name,fn)=>account.on(name,(data,ack)=>controller.execute(async()=>{try{const r=await fn(data||{});if(typeof ack==='function')ack({success:true,...r});}catch(e){if(typeof ack==='function')ack({success:false,message:e.message});else socket.emit('progressionNotice',{message:e.message});}}));
 command('superTournament:travel',async()=>{valid();if(controller.active)throw Error('Ta tentative est déjà en cours.');if(!await repository.ownsPass(userId))throw Error('Un PASS Super Tournoi est nécessaire.');await travel({map:content.MAPS.lobby,x:448,y:496});});
 command('superTournament:register',async data=>{const p=valid();if(p.currentmap!==content.MAPS.lobby||!near(13,8,3)||!offer||data.offerId!==offer.id||offer.until<Date.now())throw Error('Adresse-toi à l’hôtesse pour t’inscrire.');offer=null;if(!await repository.ownsPass(userId))throw Error('Présente ton PASS Super Tournoi.');
  p.inventoryBusy=true;try{const teams=require('../../persistence/teamRepository'),team=await teams.loadEquipe(userId);if(!team.pokemons.length||team.pokemons.some(p=>p.isEgg))throw Error('Présente une équipe sans Œuf.');require('../../game/world/playerRecovery').healTeam(team);await teams.editEquipe(userId,team);p.equipe=team;await controller.register(team);await travel({map:content.MAPS.sas,x:448,y:496});refreshActors();}finally{p.inventoryBusy=false;}
 });
 command('superTournament:abandon',async()=>{if(!controller.active)throw Error('Aucune tentative en cours.');await controller.abandon();refreshActors();});
 command('superTournament:reward',async data=>{const p=valid();if(p.currentmap!==content.MAPS.room)throw Error('Rejoins la salle du tournoi.');await controller.claimReward(data);});
 command('superTournament:board',async()=>{const p=getPlayer();if(!p||p.currentmap!==content.MAPS.lobby||Date.now()-lastBoard<1000)return;lastBoard=Date.now();return {leaderboard:await repository.leaderboard(userId)};});
 account.on('actionResponse',payload=>{if(!controller.run?.battle)return;account.track(controller.execute(()=>controller.action(payload)).catch(e=>socket.emit('progressionNotice',{message:e.message})));});
 const blockedEvents=new Set(['flyToTown','void:travel','pc:open','pc:action','useMedicine','useItem','useEvolutionItem','useRepel','setTeamOrder','equipHeldItem','setHeldItem','useTrainingItem','evolvePokemon','learnMove','experienceModule:set','admin:resetArenas','useMachine','useEvolutionStone','admin:rearmArenas','reorderTeam','requestShop','buyShopItem','sellShopItem']);
 // Challenge combatants are sealed copies. These guards also keep ordinary
 // inventory/travel panels from silently mutating the adventure while enrolled.
 socket.use((packet,next)=>{if(controller.active&&(blockedEvents.has(packet[0])||/^(?:trade:|shop:|medicine:|evolution:|team:|training:|repel:)/.test(packet[0]))){const ack=packet[packet.length-1];if(typeof ack==='function')ack({success:false,message:'Le sac et les modifications d’équipe sont fermés pendant le Super Tournoi.'});return;}next();});
 return {controller,scopedStore,
  async initialize(){await controller.load();if(controller.active){const map=controller.run.phase==='sas'?content.MAPS.sas:content.MAPS.room;if(getPlayer().currentmap!==map)await travel({map,x:448,y:496});await controller.resume();}else if([content.MAPS.room,content.MAPS.sas].includes(getPlayer().currentmap))await travel({map:content.MAPS.lobby,x:448,y:496});
   timer=setInterval(()=>{if(controller.closed||!controller.run?.battle)return;account.track(controller.execute(()=>controller.tick()).catch(e=>socket.emit('progressionNotice',{message:e.message})));},250);timer.unref?.();refreshActors();},
  async stop(){clearInterval(timer);await controller.close();},
  async interact(){const p=getPlayer();if(!p)return false;
   if(p.currentmap===content.MAPS.lobby&&near(13,8,3)){if(!await repository.ownsPass(userId)){socket.emit('progressionNotice',{message:'Hôtesse : Puis-je voir votre PASS Super Tournoi ?'});return true;}offer={id:require('node:crypto').randomUUID(),until:Date.now()+120000};socket.emit('superTournamentPanel',{tab:'entry',offerId:offer.id,leaderboard:await repository.leaderboard(userId)});return true;}
   if(p.currentmap===content.MAPS.lobby&&near(23,5,5)){socket.emit('superTournamentPanel',{tab:'ranking',leaderboard:await repository.leaderboard(userId)});return true;}
   if(p.currentmap===content.MAPS.room&&controller.run&&near(13,9)){await controller.execute(()=>controller.atomic(()=>controller.startBattle()));return true;}
   return Object.values(content.MAPS).includes(p.currentmap);
  },
  async step(){const p=getPlayer();if(!p)return false;const x=Math.floor(p.x/32),y=Math.floor(p.y/32);if(!Object.values(content.MAPS).includes(p.currentmap))return false;
   if(p.currentmap===content.MAPS.lobby&&y>=18&&x>=12&&x<=15){await travel({map:'start',x:176,y:304});return true;}
   if(controller.active&&[content.MAPS.room,content.MAPS.sas].includes(p.currentmap)&&y<=4&&x>=12&&x<=15){
    if(!['sas','cleared'].includes(controller.run.phase)){socket.emit('progressionNotice',{message:controller.run.phase==='reward'?'Choisis ta carte de récupération avant de continuer.':'Remporte ce duel pour ouvrir la salle suivante.'});return true;}
    await controller.execute(()=>controller.next());await travel({map:content.MAPS.room,x:448,y:528});refreshActors();return true;
   }return false;
  }
 };
}
module.exports={createHandlers,scopedStore,actors};

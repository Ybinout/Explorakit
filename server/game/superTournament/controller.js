const {randomUUID}=require('node:crypto');
const {DriftBattle}=require('../drift/driftBattle');
const codec=require('../drift/checkpointCodec');
const content=require('./content');
const {healTeam}=require('../world/playerRecovery');
const repository=require('../../persistence/superTournamentRepository');
const rewards=require('./rewards');
class TournamentController {
 constructor({userId,emit,travel,getPlayer,persist=repository,now=Date.now,random=Math.random}){Object.assign(this,{userId,emit,travel,getPlayer,persist,now,random});this.run=null;this.version=0;this.queue=Promise.resolve();this.closed=false;this.events=[];}
 get active(){return Boolean(this.run);}
 async load(){const r=await this.persist.load(this.userId);this.run=r.run;this.version=r.version;this.bind();
  if(this.run&&!this.run.rewardVersion)await this.atomic(()=>{this.run.rewardVersion=1;if(this.run.phase==='cleared'){this.run.reward=rewards.createOffer(this.run.player.equipe.pokemons,this.run.room+1,this.random);this.run.phase='reward';}return true;});
  this.publish();return this.run;}
 bind(){const b=this.run?.battle;if(!b)return;b.now=this.now;b.random=this.random;b.emit=(_p,event,data)=>this.buffer(event,data);b.onUpdate=null;b.onFinish=null;this.run.player.socketId=this.getPlayer()?.id;}
 buffer(event,data){this.events.push([event,JSON.parse(JSON.stringify(data))]);}
 publish(){const p=this.getPlayer();if(p){p.superTournamentActive=this.active;p.inbattle=Boolean(this.run?.battle&&!this.run.battle.finished);}this.emit('superTournamentState',content.state(this.run));}
 async atomic(change){
  const previous=this.run?codec.encode(this.run):null;let committed=false;this.events=[];
  try{const result=await change();if(result===false){this.events=[];return false;}
   const final=this.run?.outcome?{score:this.run.score,rooms:this.run.cleared}:null;
   const next=final?null:this.run;
   this.version=await this.persist.save(this.userId,next,this.version,final||{});committed=true;
   if(final){this.run=null;this.buffer('superTournamentFinished',final);}
   const events=this.events;this.events=[];this.publish();for(const[e,d]of events)this.emit(e,d);
   if(final)await this.travel({map:content.MAPS.lobby,x:448,y:496});return true;
  }catch(error){if(committed){this.publish();throw error;}this.run=previous?codec.decode(previous):null;this.events=[];this.bind();this.publish();if(this.run?.battle){this.run.battle.resume(this.run.player);const restored=this.events;this.events=[];for(const[e,d]of restored)this.emit(e,d);}throw error;}
 }
 execute(fn){const task=this.queue.then(()=>{if(this.closed)return false;return fn();});this.queue=task.catch(()=>{});return task;}
 async register(team){if(this.active)throw Error('Une tentative est déjà en cours.');if(!team?.pokemons?.length||team.pokemons.length>6||team.pokemons.some(p=>p.isEgg))throw Error('Inscris une équipe de un à six Pokémon, sans Œuf.');
  return this.atomic(()=>{const cloned=codec.decode(codec.encode(team));healTeam(cloned);this.run={id:randomUUID(),rewardVersion:1,room:0,cleared:0,phase:'sas',score:0,credited:new Set(),player:{userId:this.userId,username:this.getPlayer().username,socketId:this.getPlayer().id,currentmap:content.MAPS.room,equipe:cloned,items:{},money:0,defeated:new Set(),drifts:[],equipped:[]}};});
 }
 startBattle(){
  const r=this.run;if(!r||r.phase!=='ready')return false;
  const entry=content.entryFor(r.room);r.phase='battle';
  const enemy={npc:true,equipe:content.createTeam(r.room),items:{},drifts:[],equipped:[]};
  const battle=new DriftBattle(r.player,enemy,{type:'arena',npcKey:entry.key,now:this.now,random:this.random,emit:(_p,e,d)=>this.buffer(e,d),rules:{permanentDeaths:false,rewards:false,report:false,bagAllowed:false,fleeAllowed:false,musicKind:entry.music,entrance:{name:entry.name,portrait:entry.portrait},...(entry.key==='moonpunch'?{weather:{kind:'rain',turns:0,persistent:true}}:{})}});
  r.battle=battle;r.enemySlots=new Map(enemy.equipe.pokemons.map((p,i)=>[p.uuid,i]));this.reconcile();return true;
 }
 reconcile(){const r=this.run,b=r?.battle;if(!b)return;
  for(const uuid of b.rewarded){const slot=r.enemySlots.get(uuid);if(slot===undefined)continue;const key=`${r.room}:${slot}`;if(!r.credited.has(key)){r.credited.add(key);r.score+=content.POINTS_PER_KO;}}
  if(!b.finished)return;
  const won=b.a.equipe.pokemons.some(p=>p.currentHp>0)&&!b.b.equipe.pokemons.some(p=>p.currentHp>0);
  r.battle=null;
  if(won){r.cleared=r.room+1;r.phase='reward';r.reward=rewards.createOffer(r.player.equipe.pokemons,r.cleared,this.random);}
  else r.outcome='defeat';
 }
 async action(payload){if(!this.run?.battle)return false;return this.atomic(()=>{const accepted=this.run.battle.action(this.run.player,payload);if(!accepted)return false;this.reconcile();return true;});}
 async tick(){const b=this.run?.battle;if(!b||b.finished||b.awaiting&&this.now()<b.deadline||!b.awaiting&&this.now()<b.nextRoundAt)return false;return this.atomic(()=>{b.tick();this.reconcile();});}
 async claimReward(data){if(this.run?.phase!=='reward')throw Error('Aucune récompense à choisir.');return this.atomic(()=>{const r=this.run,result=rewards.applyChoice(r.reward,r.player.equipe.pokemons,data);r.reward=null;r.phase='cleared';this.buffer('superTournamentRewardApplied',result);return true;});}
 async reorderMoves(data){
  if(!this.run || this.run.battle || !['sas','ready','reward','cleared'].includes(this.run.phase))throw Error('Attends la fin du combat.');
  return this.atomic(()=>{
   const pokemon=this.run.player.equipe.pokemons.find(p=>p.uuid===data?.pokemonUuid);
   if(!pokemon)throw Error('Ce Pokémon ne participe pas au tournoi.');
   Object.assign(pokemon,require('../models/moveOrder').reorderMoves(pokemon,data));return true;
  });
 }
 async reorderTeam(data){
  if(!this.run || this.run.battle || !['sas','ready','reward','cleared'].includes(this.run.phase))throw Error('Attends la fin du combat pour réorganiser ton équipe.');
  return this.atomic(()=>{
   const team=this.run.player.equipe,ids=data?.orderedUuids;
   if(!Array.isArray(ids) || !ids.length || ids.length>6 || ids.length!==team.pokemons.length || new Set(ids).size!==ids.length ||
      ids.some(id=>typeof id!=='string' || !team.pokemons.some(p=>p.uuid===id)))throw Error('Ordre d’équipe invalide.');
   team.pokemons=ids.map(id=>team.pokemons.find(p=>p.uuid===id));return true;
  });
 }
 async next(){const r=this.run;if(!r||!['sas','cleared'].includes(r.phase))return false;return this.atomic(()=>{if(r.phase==='cleared')r.room++;r.credited=new Set();r.enemySlots=null;r.phase='ready';});}
 async abandon(){if(!this.run)return false;return this.atomic(()=>{this.run.battle?.finish(null,'fled');this.run.outcome='abandoned';});}
 async resume(){this.bind();const b=this.run?.battle;if(b){const entry=content.entryFor(this.run.room);this.emit('battletrigger',{battleType:'trainer',trainerKey:entry.key,musicKind:entry.music,tournamentEntrance:{name:entry.name,portrait:entry.portrait},bagAllowed:false,fleeAllowed:false,message:'Le duel du Super Tournoi reprend.'});b.deadline=this.now()+30000;if(!b.awaiting)b.nextRoundAt=this.now()+1000;b.resume(this.run.player);const events=this.events;this.events=[];for(const[e,d]of events)this.emit(e,d);}this.publish();}
 async close(){this.closed=true;await this.queue;this.events=[];}
}
module.exports={TournamentController};

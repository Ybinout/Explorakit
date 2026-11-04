const {randomUUID}=require('node:crypto');
const rules=require('./rules'),repository=require('../../persistence/whitepeakHouseRepository');
const locks=require('../social/tradeLocks'),trainers=require('./trainers');
const {DriftBattle}=require('../drift/driftBattle');
const PREPARATION_MS=120000,RECONNECT_MS=30000;
function capacities(config){return config.mode==='pve'?[1]:config.mode==='2v1'?[1,2]:[2,2];}
function createDuelHouse({contexts,getRoom,setRoom,emitRoom,now,emitSpectator,wallet,closed=()=>false,store=repository,Battle=DriftBattle,finishDuel=(...args)=>require('../../persistence/whitepeakRepository').finishDuel(...args)}){
 const ctx=id=>{const c=contexts.get(id);if(!c?.socket.connected||!c.account.active())rules.fail('Ce dresseur est déconnecté.');return c;};
 const participant=(r,id)=>r.ids.includes(id);
 const sideOf=(r,id)=>r.sides?.findIndex(s=>s.ids.includes(id))??-1;
 function match(id,data,phases){const r=getRoom();if(!r?.advanced||r.id!==data.id||!participant(r,id)||!phases.includes(r.phase))rules.fail('Ce combat a changé. Ouvre à nouveau son récapitulatif.');if(r.phase==='preparation'&&now()>=r.preparationDeadline){cancel('Le délai de préparation a expiré.');rules.fail('Le délai de préparation a expiré.');}return r;}
 function release(r){locks.release(r.ids.filter(Boolean),r.id);for(const id of r.ids){const p=contexts.get(id)?.getPlayer();if(p?.__whitepeakDuel===r.id){delete p.__whitepeakDuel;p.inventoryBusy=false;p.inbattle=false;}}}
 function cancel(message){const r=getRoom();if(!r?.advanced)return;release(r);setRoom(null);emitRoom();for(const id of new Set([r.hostId,...r.ids]))contexts.get(id)?.socket.emit('progressionNotice',{message});}
 function view(r,id){
  const own=sideOf(r,id),side=r.sides?.[own];
  return{id:r.id,advanced:true,phase:r.phase,hostId:r.hostId,config:r.config,maxCorrupted:rules.corruptionLimit(r.config),serverNow:now(),placementDeadline:r.placementDeadline,
   preparationDeadline:r.preparationDeadline||null,revision:r.revision,you:r.ids.indexOf(id),side:own,error:r.error||'',result:r.result||null,
   participants:r.ids.map((userId,i)=>userId?{userId,username:r.names[i],side:r.slotSides[i],confirmed:r.sides?.[r.slotSides[i]]?.confirmed.has(userId)||false}:null),
   sides:capacities(r.config).map((capacity,i)=>({capacity,count:r.ids.filter((id,n)=>id&&r.slotSides[n]===i).length,
    members:r.ids.flatMap((userId,n)=>userId&&r.slotSides[n]===i?[{userId,username:r.names[n],confirmed:r.sides?.[i]?.confirmed.has(userId)||false}]:[]),
    target:r.sides?.[i]?.target||((capacity===2&&r.config.format)||6),ready:!!r.sides?.[i]&&r.sides[i].confirmed.size===capacity})),
   preparation:side&&r.phase==='preparation'?{revision:side.revision,target:side.target,composition:side.composition.map(ref=>candidate(r,ref)),proposals:side.proposals.map(p=>({...p,composition:p.composition.map(ref=>candidate(r,ref))})),chat:side.chat,confirmed:[...side.confirmed]}:null,
   canWatch:r.phase==='battle'&&own<0&&contexts.get(id)?.supportsHouseModes!==false};
 }
 function candidate(r,{ownerId,uuid}){return r.rosterViews.get(ownerId)?.find(p=>p.uuid===uuid)||null;}
 function rosterFor(r,id){const side=r.sides[sideOf(r,id)];return {id:r.id,members:side.ids.map(ownerId=>({ownerId,username:r.names[r.ids.indexOf(ownerId)],pokemons:r.rosterViews.get(ownerId)}))};}
 function sendRoster(r,id){ctx(id).socket.emit('whitepeak:roster',rosterFor(r,id));}
 async function create(id,config){
  if(ctx(id).supportsHouseModes===false)rules.fail('Actualise le jeu pour utiliser les nouveaux formats de la Maison des Combats.');
  if(config.mode==='pve'&&!trainers.list().some(t=>t.key===config.trainerKey))rules.fail('Dresseur inconnu.');
  const caps=capacities(config),slotSides=caps.flatMap((n,i)=>Array(n).fill(i));
  const r={advanced:true,id:randomUUID(),hostId:id,config,slotSides,ids:slotSides.map(()=>null),names:slotSides.map(()=>''),phase:'waiting',revision:0,
   expiresAt:now()+300000,placementDeadline:now()+rules.PLACEMENT_TIMEOUT,disconnected:new Map(),log:[],eventSequence:0};
  setRoom(r);emitRoom();
  try{if(config.mode==='pve'){r.ids=[id];r.names=[ctx(id).username];await prepare(r);await start(r);}
  else await syncWaiting();}catch(error){if(getRoom()===r)cancel(error.statusCode?error.message:'La préparation est indisponible.');throw error;}
  return view(r,id);
 }
 async function syncWaiting(){
  const r=getRoom();if(!r?.advanced||r.phase!=='waiting')return;
  const old=r.ids.join(','),usable=c=>{const p=c.getPlayer();return c.supportsHouseModes!==false&&c.socket.connected&&c.account.active()&&p?.currentmap===rules.HALL&&c.canUse()&&!p.inbattle&&!p.inventoryBusy&&!locks.locked(c.id);};
  for(let n=0;n<r.ids.length;n++)if(r.ids[n]){const c=contexts.get(r.ids[n]);if(!c||!usable(c)||rules.podium(c.getPlayer())!==r.slotSides[n]){r.ids[n]=null;r.names[n]='';}}
  const host=contexts.get(r.hostId),hostPad=host&&usable(host)?rules.podium(host.getPlayer()):-1;
  if(hostPad>=0&&!r.ids.includes(r.hostId)&&!r.ids.some((id,n)=>!id&&r.slotSides[n]===hostPad)){const slot=r.slotSides.findLastIndex(side=>side===hostPad);r.ids[slot]=null;r.names[slot]='';}
  for(const c of [...contexts.values()].filter(usable).sort((a,b)=>Number(b.id===r.hostId)-Number(a.id===r.hostId)||a.id-b.id)){
   const pad=rules.podium(c.getPlayer()),slot=r.ids.findIndex((id,n)=>!id&&r.slotSides[n]===pad);
   if(pad<0||slot<0||r.ids.includes(c.id))continue;r.ids[slot]=c.id;r.names[slot]=c.username;
  }
  if(r.ids.includes(r.hostId))r.placementDeadline=null;else if(!r.placementDeadline)r.placementDeadline=now()+rules.PLACEMENT_TIMEOUT;
  if(r.ids.every(Boolean)&&r.ids.includes(r.hostId)){try{await prepare(r);}catch(error){cancel(error.statusCode?error.message:'La préparation est indisponible.');throw error;}}
  else if(old!==r.ids.join(',')){r.revision++;emitRoom();}
 }
 async function prepare(r){
  locks.acquire(r.ids,r.id);
  for(const id of r.ids){const p=ctx(id).getPlayer();p.__whitepeakDuel=r.id;p.inventoryBusy=true;}
  const sides=capacities(r.config).map((_n,i)=>r.ids.filter((_id,n)=>r.slotSides[n]===i));
  const inspected=await store.inspect(r.ids,sides,r.config);r.digest=inspected.digest;r.snapshots=inspected.snapshots;
  r.rosters=new Map(r.snapshots.map(s=>[s.userId,store.roster(s)]));
  r.rosterViews=new Map(r.snapshots.map(s=>[s.userId,store.roster(s).map(p=>store.summary(p,s.userId,s.user.username,s.team.some(own=>own.uuid===p.uuid)?'team':'pc'))]));
  r.sides=sides.map(ids=>{
   const target=ids.length===1?Math.min(6,r.config.mode==='pve'?r.snapshots.find(s=>s.userId===ids[0]).team.length:r.rosters.get(ids[0]).length):r.config.mode==='2v2'?r.config.format:6;
   if(ids.reduce((n,id)=>n+Math.min(6,r.rosters.get(id).length),0)<target)rules.fail(`Ce camp ne dispose pas des ${target} Pokémon nécessaires.`);
   const composition=[],counts=new Map(ids.map(id=>[id,0]));
   while(composition.length<target){let added=false;for(const ownerId of ids){const n=counts.get(ownerId),p=r.rosters.get(ownerId)[n];if(p&&n<6&&composition.length<target){composition.push({ownerId,uuid:p.uuid});counts.set(ownerId,n+1);added=true;}}if(!added)break;}
   return {ids,target,composition,confirmed:new Set(),revision:0,proposals:[],chat:[],controller:null};
  });
  r.phase=r.config.mode==='pve'?'starting':'preparation';r.preparationDeadline=r.config.mode==='pve'?null:now()+PREPARATION_MS;r.revision++;r.error='';
  if(r.config.mode!=='pve')for(const id of r.ids)sendRoster(r,id);emitRoom();
 }
 function compose(id,data){
  const r=match(id,data,['preparation']),side=r.sides[sideOf(r,id)];
  if(data.sideRevision!==side.revision)rules.fail('Ton allié vient de modifier l’équipe. Relis la nouvelle composition.');
  const refs=data.composition;if(!Array.isArray(refs)||refs.length>side.target)rules.fail('Composition invalide.');
  const seen=new Set(),counts=new Map();
  for(const ref of refs){if(!ref||!side.ids.includes(ref.ownerId)||!candidate(r,ref)||seen.has(ref.uuid))rules.fail('Ce Pokémon n’est pas disponible pour votre camp.');seen.add(ref.uuid);counts.set(ref.ownerId,(counts.get(ref.ownerId)||0)+1);if(counts.get(ref.ownerId)>6)rules.fail('Six Pokémon au maximum par allié.');}
  if(JSON.stringify(refs.map(({ownerId,uuid})=>({ownerId,uuid})))===JSON.stringify(side.composition))return view(r,id);
  side.composition=refs.map(({ownerId,uuid})=>({ownerId,uuid}));side.revision++;side.confirmed.clear();
  side.proposals=[...side.proposals.filter(p=>p.ownerId!==id),{ownerId:id,username:ctx(id).username,composition:side.composition.map(p=>({...p})),revision:side.revision}].slice(-2);
  r.error='';r.revision++;emitRoom();return view(r,id);
 }
 function chat(id,data){const r=match(id,data,['preparation']),side=r.sides[sideOf(r,id)],message=typeof data.message==='string'?data.message.trim():'';
  if(!message||message.length>240)rules.fail('Écris un message de 1 à 240 caractères.');
  const last=side.chat.findLast(m=>m.ownerId===id);if(last&&now()-last.sentAt<700)rules.fail('Patiente un instant entre deux messages.');
  side.chat.push({id:randomUUID(),ownerId:id,username:ctx(id).username,message,sentAt:now()});side.chat=side.chat.slice(-40);emitRoom();return view(r,id);
 }
 function inspect(id,data){const r=match(id,data,['preparation']),side=r.sides[sideOf(r,id)];
  if(!side.ids.includes(data.ownerId))rules.fail('Ce Pokémon n’appartient pas à votre camp.');const p=r.rosters.get(data.ownerId)?.find(p=>p.uuid===data.pokemonUuid);if(!p)rules.fail('Pokémon indisponible.');return {detail:store.detail(p)};
 }
 async function confirm(id,data){const r=match(id,data,['preparation']),side=r.sides[sideOf(r,id)];
  if(data.sideRevision!==side.revision)rules.fail('La composition a changé. Vérifie-la avant de confirmer.');
  store.select(r.snapshots,[side.ids],[side.composition],r.config);
  side.confirmed.add(id);emitRoom();if(r.sides.every(s=>s.ids.every(id=>s.confirmed.has(id))))await start(r);return view(r,id);
 }
 async function start(r){
  r.phase='starting';emitRoom();
  try{
   const escrow=await store.start({id:r.id,ids:r.ids,sides:r.sides.map(s=>s.ids),selections:r.sides.map(s=>s.composition),config:r.config,digest:r.digest});
   for(const p of escrow.balances)wallet(p.userId,p.balance);
   if(r.ids.some(id=>!contexts.get(id)?.socket.connected)){await finishDuel(r.id,null,'interrupted');cancel('Un dresseur s’est déconnecté. Les mises sont rendues.');return;}
   r.copies=escrow.teams.map((team,i)=>{
    const p=rules.battleCopy({id:`${r.id}:${i}`,username:r.sides[i].ids.map(id=>ctx(id).username).join(' & ')},team,r.config,{maxSize:r.sides[i].target});
    p.socketId=p.id;p.defeated=new Set();p.drifts=[];p.equipped=[];return p;
   });
   if(r.config.mode==='pve')r.copies.push({id:r.id+':npc',npc:true,drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0,username:trainers.list().find(t=>t.key===r.config.trainerKey)?.name,currentmap:rules.HALL,equipe:trainers.create(r.config.trainerKey,r.copies[0].equipe.pokemons,r.config.level,r.config)});
   r.phase='battle';r.startedAt=now();r.requests=new Map();r.owners=new Map(r.sides.flatMap(s=>s.composition.map(p=>[p.uuid,p.ownerId])));r.controlRevision=0;
   for(const id of r.ids)ctx(id).getPlayer().inbattle=true;emitRoom();
   r.engine=new Battle(r.copies[0],r.copies[1],{type:r.config.mode==='pve'?'trainer':'pvp',now,paceMs:1800,npcKey:r.config.trainerKey||null,
    rules:{rewards:false,report:false,permanentDeaths:false,bagAllowed:false,partyLimit:r.config.format===12?12:6,musicKind:r.config.mode==='pve'?trainers.music(r.config.trainerKey):'pvp'},
    emit:(p,event,payload)=>emit(r,p,event,payload),onUpdate:()=>{if(r.engine)syncControl(r);},onFinish:(_b,winner,reason)=>{r.outcome={winnerId:winner?.npc?null:winner?r.sides[r.copies.indexOf(winner)].ids[0]:null,reason,lossToNpc:!!winner?.npc};r.phase='settling';}});
   syncControl(r);
  }catch(error){await finishDuel(r.id,null,'error').catch(()=>{});cancel('Le combat n’a pas pu commencer. Aucune mise n’est perdue.');throw error;}
 }
 function syncControl(r){
  for(const [index,side]of r.sides.entries()){
   const active=r.copies[index].equipe.pokemons[0],ownerId=r.owners.get(active?.uuid),token=r.engine?.token||r.requests.get(index)?.turnId;
   if(!side.control||side.control.uuid!==active?.uuid||side.control.token!==token){side.control={uuid:active?.uuid,ownerId,controllerId:ownerId,token,revision:++r.controlRevision};}
   for(const id of side.ids){const c=contexts.get(id),packet=control(r,side,id),signature=JSON.stringify(packet);if(c?.socket.connected&&c.lastHouseControl!==signature){c.lastHouseControl=signature;c.socket.emit('whitepeak:control',packet);}}
  }
 }
 function control(r,side,id){
  const c=side.control,paused=r.disconnected.size>0,copy=r.copies[r.sides.indexOf(side)],battle=r.engine;
  const available=!!battle?.awaiting&&!battle.finished&&!battle.pending.has(copy)&&(!battle.replacementPhase||battle.replacementPlayers?.has(copy));
  return{id:r.id,mode:r.config.mode,teamSize:side.target,cooperative:side.ids.length===2,paused,
   reconnectSeconds:paused?Math.max(0,Math.ceil((RECONNECT_MS-(now()-Math.min(...r.disconnected.values())))/1000)):null,
   ownerId:c?.ownerId,ownerName:r.names[r.ids.indexOf(c?.ownerId)],controllerId:c?.controllerId,controllerName:r.names[r.ids.indexOf(c?.controllerId)],
   delegated:c?.controllerId!==c?.ownerId,canControl:!paused&&available&&c?.controllerId===id,
   canPass:!paused&&available&&side.ids.length===2&&c?.controllerId===id,revision:c?.revision,turnId:c?.token};
 }
 function emit(r,p,event,payload){
  const index=r.copies.indexOf(p),side=r.sides[index];if(!side)return;
  if(event==='teamStateChanged'||event==='bagUpdated')return;
  if(event==='requestAction')r.requests.set(index,payload);
  if(event==='introAnimation'||event==='requestAction')syncControl(r);
  const data=event==='battletrigger'?{...payload,environment:'whitepeak-club',battleType:r.config.mode==='pve'?'trainer':'pvp',message:'Le combat de Blanchecime commence !'}:payload;
  for(const id of side.ids){const c=contexts.get(id);if(c?.socket.connected)c.socket.emit(event,event==='requestAction'?prompt(r,side,id,data):data);}
  if(index===0)emitSpectator(r,event,data);
 }
 function prompt(r,side,id,data){return side.control?.controllerId===id?data:{...data,message:`${r.names[r.ids.indexOf(side.control?.controllerId)]} choisit ${data.replacement?'le prochain Pokémon':'votre action'}.`};}
 function action(id,data){const r=match(id,data,['battle']),index=sideOf(r,id),side=r.sides[index],c=side.control;
  if(r.disconnected.size)rules.fail('Le combat attend la reconnexion d’un participant.');
  if(!c||!control(r,side,id).canControl||data.controlRevision!==c.revision||data.turnId!==r.engine.token)rules.fail('La main ou le tour a changé.');
  if(!r.engine.action(r.copies[index],data))rules.fail('Cette action n’est plus disponible.');syncControl(r);return view(r,id);
 }
 function pass(id,data){const r=match(id,data,['battle']),index=sideOf(r,id),side=r.sides[index],c=side.control;
  if(r.disconnected.size)rules.fail('Le combat attend la reconnexion d’un participant.');
  if(!control(r,side,id).canPass||data.controlRevision!==c.revision||data.turnId!==r.engine.token)rules.fail('La main ne peut plus être transférée pour cette action.');
  const partner=side.ids.find(n=>n!==id);ctx(partner);c.controllerId=partner;c.revision=++r.controlRevision;syncControl(r);
  for(const owner of side.ids)ctx(owner).socket.emit('requestAction',prompt(r,side,owner,r.requests.get(index)||{turnId:r.engine.token,message:'Ton partenaire te passe la main.'}));return view(r,id);
 }
 async function settle(r){
  try{
   const outcome=r.outcome;r.result=await finishDuel(r.id,outcome.winnerId,outcome.reason);
   if(outcome.lossToNpc)r.result={...r.result,pveLost:true};
   for(const payment of r.result.payments)wallet(payment.userId,payment.balance);
   for(const id of r.ids)await contexts.get(id)?.reload();release(r);r.phase='finished';delete r.snapshots;delete r.rosters;delete r.rosterViews;emitRoom();
   for(const c of contexts.values())c.socket.emit('whitepeak:watchEnd',{id:r.id,result:r.result});
  }catch(error){r.error='Le résultat est en cours de sauvegarde. Les mises restent protégées.';r.retryAt=now()+3000;emitRoom();}
 }
 async function tick(){const r=getRoom();if(!r?.advanced)return;
  if(['waiting','preparation'].includes(r.phase)){
   if(!contexts.get(r.hostId)?.socket.connected||contexts.get(r.hostId)?.getPlayer()?.currentmap!==rules.HALL){cancel('L’organisateur a quitté la salle.');return;}
   if(r.phase==='preparation'&&now()>=r.preparationDeadline){cancel('Préparation terminée : toutes les compositions n’ont pas été confirmées. Aucune mise n’a été prélevée.');return;}
   if(r.phase==='waiting'){if(r.placementDeadline&&now()>=r.placementDeadline||now()>=r.expiresAt){cancel('Le placement a expiré. Aucune mise n’a été prélevée.');return;}await syncWaiting();}
  }
  if(r.phase==='battle'){
   const overdue=r.sides.map(s=>s.ids.some(id=>r.disconnected.has(id)&&now()-r.disconnected.get(id)>=RECONNECT_MS));
   if(overdue.some(Boolean)||now()-r.startedAt>=(r.config.format===12?60:30)*60*1000){const winner=overdue[0]&&!overdue[1]?r.copies[1]:overdue[1]&&!overdue[0]?r.copies[0]:null;r.engine.finish(winner,overdue.some(Boolean)?'disconnected':'timer');}
   else if(r.disconnected.size)syncControl(r);else r.engine.tick();
  }
  if(r.phase==='settling'&&(!r.retryAt||now()>=r.retryAt)&&!closed())await settle(r);
 }
 async function step(id){const r=getRoom();if(!r?.advanced)return;
  const c=contexts.get(id);if(c?.getPlayer()?.currentmap!==rules.HALL){if(['waiting','preparation'].includes(r.phase)&&(r.hostId===id||participant(r,id)))cancel('Un participant a quitté la salle.');return;}
  if(r.phase==='waiting')await syncWaiting();
  else if(['preparation','battle'].includes(r.phase)&&participant(r,id)&&c.restoredHouse!==r.id){c.restoredHouse=r.id;c.lastHouseControl=null;r.disconnected.delete(id);if(!r.disconnected.size&&r.pausedAt!==undefined){const delay=now()-r.pausedAt;if(r.engine){r.engine.deadline+=delay;if(r.engine.nextRoundAt)r.engine.nextRoundAt+=delay;}delete r.pausedAt;}const p=c.getPlayer();p.__whitepeakDuel=r.id;p.inventoryBusy=true;p.inbattle=r.phase==='battle';
   if(r.phase==='preparation')sendRoster(r,id);
   if(r.phase==='battle'){c.socket.emit('battletrigger',{battleType:r.config.mode==='pve'?'trainer':'pvp',environment:'whitepeak-club',trainerKey:r.config.trainerKey,message:'Le combat reprend.'});r.engine.resume(r.copies[sideOf(r,id)]);syncControl(r);}
  }
 }
 function disconnect(id,c){const r=getRoom();if(!r?.advanced||contexts.get(id)!==c)return;
  if(['waiting','preparation'].includes(r.phase)&&(r.hostId===id||participant(r,id)))cancel('Un dresseur s’est déconnecté avant le combat.');
  else if(r.phase==='battle'&&participant(r,id)){if(!r.disconnected.size)r.pausedAt=now();r.disconnected.set(id,now());syncControl(r);for(const owner of r.ids)contexts.get(owner)?.socket.emit('progressionNotice',{message:`${c.username} est déconnecté : 30 secondes pour revenir.`});}
 }
 const commands={compose,chat,inspect,confirm,action,pass};
 return{create,view,syncWaiting,step,tick,disconnect,cancel,command:(name,id,data)=>{if(!commands[name])rules.fail('Commande inconnue.');return commands[name](id,data);},trainers:trainers.list};
}
module.exports={createDuelHouse,capacities,PREPARATION_MS,RECONNECT_MS};

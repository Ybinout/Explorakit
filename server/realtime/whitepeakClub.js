const {randomUUID,randomInt}=require('node:crypto');
const {EventEmitter}=require('node:events');
const rules=require('../game/whitepeak/rules'),store=require('../persistence/whitepeakRepository');
const locks=require('../game/social/tradeLocks');
const {worldRoom}=require('./worldRooms');
const servers=new WeakMap();
const PUBLIC_EVENTS=new Set(['introAnimation','battleText','battleMoveAnimation','battleMoveResult','battleFieldState','battleDriftEffects','whitepeak:doubleFrame']);
function createClub(io,{repository=store,tournamentRepository=null,now=Date.now,randomNumber=()=>randomInt(37),tickMs=250,battle=require('../game/battle/pvpBattle').startPvpBattle}={}){
 const contexts=new Map(),spectators=new Set(),privatePve=new Map();let room=null,round=null,honorRevision=-1,sequence=Promise.resolve(),ticking=false,closed=false;
 const ready=(async()=>{
  await repository.initializeRankings?.();
  await repository.recoverDuels();await tour.ready;round=await repository.rouletteState();
  if(round?.phase==='betting'&&round.closesAt<=now())round=await repository.spin(round.id,randomNumber(),now());
  if(round?.phase==='spinning'&&round.resultAt<=now()){await repository.settleRoulette(round.id,now());round=await repository.rouletteState();}
  if(round?.phase==='result'&&round.nextAt<=now()){await repository.closeRound(round.id,now());round=null;}
 })();
 function execute(fn){const task=sequence.then(()=>ready).then(fn);sequence=task.catch(()=>{});return task;}
 function context(id){const c=contexts.get(id);if(!c?.socket.connected||!c.account.active())rules.fail('Ce dresseur est déconnecté.');return c;}
 function player(id){return context(id).getPlayer();}
 function requireMap(id,map){const p=player(id);if(p?.currentmap!==map)rules.fail('Rejoins ce bâtiment à Blanchecime.');return p;}
 function available(id){const c=context(id),p=c.getPlayer();if(!p||!c.canUse()||p.inbattle||p.inventoryBusy||locks.locked(id))rules.fail('Termine ton action avant de continuer.');return p;}
 function session(id){return privatePve.get(id)?.room||(room?.tournament&&tour.duelRoom?.ids.includes(id)?tour.duelRoom:room);}
 function house(id){return privatePve.get(id)?.house||(room?.tournament?tour.child:advanced);}
 function ownerIndex(id){return room?.ids.indexOf(id)??-1;}
 function view(id){
  const own=privatePve.get(id);if(own?.room)return own.house.view(own.room,id);
  if(!room)return null;if(room.tournament)return tour.duelView(id)||{id:room.id,phase:room.phase,hostId:room.hostId,config:room.config,participants:room.ids.map((userId,i)=>({userId,username:room.names[i]})),you:room.ids.indexOf(id),serverNow:now()};const index=ownerIndex(id);
  if(room.advanced)return advanced.view(room,id);
  return {id:room.id,phase:room.phase,hostId:room.hostId,config:room.config,serverNow:now(),placementDeadline:room.placementDeadline||null,
   participants:room.ids.map((userId,i)=>userId?{userId,username:room.names[i],confirmed:room.confirmed[i],pokemon:room.selected?.[i]||null}:null),
   revision:room.revision,you:index,error:room.error||'',result:room.result||null,
   ...(index>=0&&room.phase==='review'?{inventory:room.inventories?.[index]||null}:{}),
   canWatch:room.phase==='battle'&&index<0};
 }
 function emitRoom(){for(const c of contexts.values())if(c.socket.connected&&c.getPlayer()?.currentmap===rules.HALL){c.socket.emit('whitepeak:duel',view(c.id));c.socket.emit('whitepeak:tournament',room?.tournament?tour.publicState(c.id):null);}}
 async function publishTrainers(id){
  const c=contexts.get(id);if(!c?.socket.connected||!c.account.active()||c.getPlayer()?.currentmap!==rules.HALL)return;
  const revision=(c.trainerCatalogueRevision||0)+1;c.trainerCatalogueRevision=revision;
  const won=new Set(await repository.pveVictories?.(id)||[]);
  if(contexts.get(id)!==c||!c.socket.connected||!c.account.active()||c.getPlayer()?.currentmap!==rules.HALL||c.trainerCatalogueRevision!==revision)return;
  c.socket.emit('whitepeak:trainers',{trainers:advanced.trainers().map(t=>({...t,completed:won.has(t.key)}))});
 }
 async function publishHonor(force=false){if(!repository.honorRoll)return;const version=repository.rankingRevision();if(!force&&version===honorRevision)return;const honor=await repository.honorRoll();honorRevision=honor.revision;for(const c of contexts.values())if(c.socket.connected&&c.getPlayer()?.currentmap===rules.HALL)c.socket.emit('whitepeak:honor',honor);}
 function emitRoulette(){if(round)io.to(worldRoom(rules.CASINO)).emit('whitepeak:roulette',{...round,serverNow:now()});}
 function wallet(id,balance){const c=contexts.get(id);if(c?.socket.connected)c.socket.emit('whitepeak:wallet',{balance});}
 function unlock(r){locks.release(r.ids.filter(Boolean),r.id);for(const id of r.ids){const p=contexts.get(id)?.getPlayer();if(p?.__whitepeakDuel===r.id){delete p.__whitepeakDuel;p.inventoryBusy=false;p.inbattle=false;}}}
 function cancel(reason){if(!room)return;if(['starting','battle','settling'].includes(room.phase))rules.fail('Le duel est déjà lancé. Abandonne depuis le combat.');const r=room;unlock(r);room=null;emitRoom();for(const id of new Set([...r.ids,r.hostId])){const c=contexts.get(id);if(c?.socket.connected)c.socket.emit('progressionNotice',{message:reason});}}
 function expireRoom(){
  if(!room||room.tournament||!['waiting','review'].includes(room.phase))return;
  if(contexts.get(room.hostId)?.getPlayer()?.currentmap!==rules.HALL){cancel('L’organisateur a quitté la salle.');return;}
  if(room.phase==='waiting'&&room.placementDeadline&&room.placementDeadline<=now()){cancel('Le duel a été annulé : l’organisateur n’a pas rejoint un socle dans les 50 secondes.');return;}
  if(room.expiresAt<=now())cancel('L’inscription au duel a expiré.');
 }
 async function refreshReview(){
  const r=room;if(!r||r.ids.some(n=>!n))return;
  r.phase='review';r.error='';r.confirmed=[false,false];r.revision++;r.expiresAt=now()+300000;
  try{const inspected=await repository.inspectDuel(r.ids,r.uuids,r.config);if(room!==r)return;r.digest=inspected.digest;r.selected=inspected.selected;r.inventories=inspected.inventories;}
  catch(e){r.error=e.statusCode?e.message:'L’inscription n’a pas pu être vérifiée.';r.digest=null;}
  emitRoom();
 }
 async function create(id,data){
  const p=available(id);requireMap(id,rules.HALL);if(!rules.near(p,13,5,3))rules.fail('Adresse-toi à l’hôtesse.');
  const config=rules.settings(data);
  if(config.mode==='pve'){
   if(room&&!['finished','cancelled'].includes(room.phase)&&(room.hostId===id||room.ids.includes(id))&&!(room.tournament&&room.left.has(id)))rules.fail('Annule ton inscription au duel avant de t’entraîner.');
   const entry={room:null};
   entry.house=require('../game/whitepeak/duelHouse').createDuelHouse({contexts,getRoom:()=>entry.room,setRoom:r=>{entry.room=r;},emitRoom,now,emitSpectator:()=>{},wallet,closed:()=>closed,
    onSettled:r=>{if(r.result?.winnerId===id&&r.result.reason==='finished')void publishTrainers(id).catch(error=>console.error('Victoires PvE :',error.message));}});
   privatePve.set(id,entry);
   try{return await entry.house.create(id,config);}catch(error){if(!entry.room||['finished','cancelled'].includes(entry.room.phase))privatePve.delete(id);throw error;}
  }
  privatePve.delete(id);
  if(room&&!['finished','cancelled'].includes(room.phase))rules.fail('Un duel est déjà organisé.');
  if(config.mode==='tournament')return tour.create(id,config);
  if(config.battleFormat==='double'||config.mode&&config.mode!=='1v1')return advanced.create(id,config);
  room={id:randomUUID(),hostId:id,config:rules.settings(data),ids:[null,null],names:['',''],uuids:[null,null],selected:[null,null],confirmed:[false,false],revision:0,phase:'waiting',expiresAt:now()+300000,placementDeadline:now()+rules.PLACEMENT_TIMEOUT};emitRoom();await syncWaitingPodiums();return view(id);
 }
 async function syncWaitingPodiums(){
  const r=room;if(!r||r.tournament||r.phase!=='waiting')return;
  if(r.advanced)return advanced.syncWaiting();
  const before=r.ids.join(',');
  const usable=c=>{const p=c.getPlayer();return c.socket.connected&&c.account.active()&&p?.currentmap===rules.HALL&&c.canUse()&&!p.inbattle&&!p.inventoryBusy&&!locks.locked(c.id);};
  for(let i=0;i<2;i++)if(r.ids[i]){
   const c=contexts.get(r.ids[i]);if(!c||!usable(c)||rules.podium(c.getPlayer())!==i){r.ids[i]=null;r.names[i]='';}
  }
  // Detect people already standing on a disc, including after entry/reconnect.
  const candidates=[...contexts.values()].filter(usable).sort((a,b)=>Number(b.id===r.hostId)-Number(a.id===r.hostId)||a.id-b.id);
  for(const c of candidates){const pad=rules.podium(c.getPlayer());
   if(pad<0||r.ids.includes(c.id)||r.ids[pad])continue;
   if(c.id!==r.hostId&&!r.ids.includes(r.hostId)&&r.ids.some(Boolean))continue;
   r.ids[pad]=c.id;r.names[pad]=c.username;
  }
  if(r.ids.includes(r.hostId))r.placementDeadline=null;
  else if(!r.placementDeadline)r.placementDeadline=now()+rules.PLACEMENT_TIMEOUT;
  if(r.ids.every(Boolean)){
   try{locks.acquire(r.ids,r.id);for(const owner of r.ids){const p=player(owner);p.__whitepeakDuel=r.id;p.inventoryBusy=true;}await refreshReview();}
   catch(e){unlock(r);r.ids=[null,null];r.names=['',''];r.phase='waiting';r.placementDeadline=now()+rules.PLACEMENT_TIMEOUT;contexts.get(r.hostId)?.socket.emit('progressionNotice',{message:e.message});emitRoom();}
  }else if(before!==r.ids.join(','))emitRoom();
 }
 async function step(id){
  const own=privatePve.get(id);if(own){await own.house.step(id);if(own.room?.phase!=='finished'||contexts.get(id)?.getPlayer()?.currentmap===rules.HALL)return;privatePve.delete(id);}
  if(room?.tournament)return tour.step(id);
  if(room?.advanced)return advanced.step(id);
  expireRoom();const p=contexts.get(id)?.getPlayer();if(!p)return;
  if(p.currentmap!==rules.HALL){spectators.delete(id);if(room&&['waiting','review'].includes(room.phase)&&(room.hostId===id||room.ids.includes(id)))cancel('Un participant a quitté la salle.');return;}
  await syncWaitingPodiums();
 }
 function match(id,data){requireMap(id,rules.HALL);if(!room||data.id!==room.id||ownerIndex(id)<0||room.phase!=='review'||data.revision!==room.revision)rules.fail('Ce récapitulatif a changé. Relis les mises.');return room;}
 async function offer(id,data){if(session(id)?.advanced)return house(id).command('offer',id,data);const r=match(id,data);if(!r.config.pokemonStake)rules.fail('Aucun Pokémon n’est demandé pour ce duel.');r.uuids[ownerIndex(id)]=rules.uuid(data.pokemonUuid);await refreshReview();return view(id);}
 async function confirm(id,data){
  if(session(id)?.advanced)return house(id).command('confirm',id,data);
  const r=match(id,data);if(!r.digest||r.error||r.config.pokemonStake&&r.uuids.some(n=>!n))rules.fail(r.error||'Les deux Pokémon doivent être proposés.');
  if(r.ids.some((owner,i)=>rules.podium(player(owner))!==i))rules.fail('Les deux dresseurs doivent être sur leur socle.');
  r.confirmed[ownerIndex(id)]=true;emitRoom();if(!r.confirmed.every(Boolean))return view(id);
  r.phase='starting';emitRoom();
  try{
   const escrow=await repository.startDuel({id:r.id,ids:r.ids,uuids:r.uuids,config:r.config,digest:r.digest});
   for(const[ i,owner ]of r.ids.entries())wallet(owner,escrow.balances[i]);
   if(r.ids.some(owner=>!contexts.get(owner)?.socket.connected)){await repository.finishDuel(r.id,null,'interrupted');unlock(r);room=null;emitRoom();return null;}
   r.copies=r.ids.map((owner,i)=>rules.battleCopy(player(owner),escrow.teams[i],r.config));
   for(const owner of r.ids)player(owner).inbattle=true;
   r.phase='battle';r.log=[];r.eventSequence=0;emitRoom();
   const task=runBattle(r);for(const owner of r.ids)context(owner).account.track(task);
  }catch(e){await repository.finishDuel(r.id,null,'error').catch(()=>{});unlock(r);room=null;emitRoom();throw e;}
  return view(id);
 }
 function spectatorEvent(r,event,payload){
  if(!PUBLIC_EVENTS.has(event))return;
  if(event==='whitepeak:doubleFrame'){const events=(payload.events||[]).map(e=>{if(!e.pokemon)return e;const {uuid,heldItem,ability,...pokemon}=e.pokemon;return {...e,pokemon};});payload=r.engine?.spectatorView();if(payload)payload={...payload,events};if(!payload)return;r.doubleSnapshot=payload;}
  if(event==='introAnimation'){
   payload={...payload,usableMoveIndexes:[],moveDisabledReasons:[],player:{id:payload.player.id,username:payload.player.username,equipe:{pokemons:[require('../game/battle/presentationState').opponentPokemon(payload.player.equipe.pokemons[0])]}},enemyPlayer:{id:payload.enemyPlayer?.id}};
   r.intro=payload;
  }
  if(event==='battleFieldState')r.field=payload;
  if(event==='battleText'){r.log.push(payload.message);if(r.log.length>30)r.log.shift();}
  const packet={id:r.id,seq:++r.eventSequence,event,payload};
  for(const id of spectators){const c=contexts.get(id);if(c?.socket.connected&&c.getPlayer()?.currentmap===rules.HALL)c.socket.emit('whitepeak:watchEvent',packet);}
 }
 async function runBattle(r){
  const wrappers=new Map(),disposers=[];
  for(const owner of r.ids){const actual=context(owner).socket,e=new EventEmitter();e.alive=true;
   e.emitToClient=(event,payload)=>actual.emit(event,payload);e.send=e.emit;e.emit=e.emitToClient;
   const action=data=>e.send.call(e,'actionResponse',data),gone=()=>{e.alive=false;e.send.call(e,'disconnect');};
   actual.on('actionResponse',action);actual.once('disconnect',gone);disposers.push(()=>{actual.off('actionResponse',action);actual.off('disconnect',gone);e.removeAllListeners();});wrappers.set(actual.id,e);
  }
  const proxy={sockets:{sockets:{get:id=>{const s=wrappers.get(id);return s?.alive?s:null;}}},to:id=>({emit:(event,payload)=>{
   io.to(id).emit(event,payload);if(id===r.copies[0].id)spectatorEvent(r,event,payload);
  }})};
  const timeout=setTimeout(()=>{for(const s of wrappers.values()){s.alive=false;s.send.call(s,'disconnect');}},20*60*1000);timeout.unref?.();
  let outcome;
  try{for(const p of r.copies)io.to(p.id).emit('battletrigger',{battleType:'pvp',message:'Le duel de Blanchecime commence !'});outcome=await battle(...r.copies,proxy,{restoreBerries:true});}
  catch(e){console.error('Duel de Blanchecime :',e.message);outcome={winnerId:null,reason:'error'};for(const p of r.copies)io.to(p.id).emit('endbattle',{interrupted:true,reason:'error',playerWon:false});}
  finally{clearTimeout(timeout);for(const dispose of disposers)dispose();}
  const index=r.copies.findIndex(p=>p.id===outcome.winnerId);r.phase='settling';emitRoom();
  // Keep both account leases until the durable result and inventory refresh.
  // If storage briefly fails, retry the same idempotent receipt, never a new bet.
  while(!closed){
   try{
    r.result=await repository.finishDuel(r.id,index>=0?r.ids[index]:null,outcome.reason);
    for(const payment of r.result.payments)wallet(payment.userId,payment.balance);
    for(const owner of r.ids){const c=contexts.get(owner);if(c)await c.reload();}
    r.phase='finished';unlock(r);emitRoom();for(const owner of r.ids)if(!contexts.get(owner)?.socket.connected)contexts.delete(owner);
    for(const id of spectators)contexts.get(id)?.socket.emit('whitepeak:watchEnd',{id:r.id,result:r.result});spectators.clear();
    return;
   }catch(e){console.error('Sauvegarde du duel :',e.message);for(const owner of r.ids)contexts.get(owner)?.socket.emit('progressionNotice',{message:'Le résultat du duel est en cours de sauvegarde…'});await new Promise(resolve=>setTimeout(resolve,3000));}
  }
 }
 async function watch(id,automatic=false){const r=room?.tournament?tour.duelRoom:room;if(r?.config?.battleFormat==='double'&&context(id).socket.handshake?.auth?.houseDoubles!==1)rules.fail('Actualise le jeu pour regarder ce format.');if(r?.advanced&&context(id).supportsHouseModes===false)rules.fail('Actualise le jeu pour regarder ce format.');const own=automatic&&room?.tournament&&room.ids.includes(id);const p=own?player(id):available(id);requireMap(id,rules.HALL);if(!own&&Math.floor(p.y/32)<13)rules.fail('Rejoins les tribunes pour observer.');if(r?.phase!=='battle'||r?.ids.includes(id))rules.fail('Aucun duel à regarder.');spectators.add(id);const payload={id:r.id,intro:r.intro||null,doubles:r.doubleSnapshot||null,field:r.field||null,seq:r.eventSequence,log:r.log||[],names:r.advanced?r.sides.map(s=>s.ids.map(id=>r.names[r.ids.indexOf(id)]).join(' & ')):r.names};context(id).socket.emit('whitepeak:watchStart',payload);return payload;}
 async function tick(){
  if(ticking||closed)return;ticking=true;
  try{await execute(async()=>{
   expireRoom();
   if(room?.tournament)await tour.tick();else await advanced.tick();
   for(const[id,entry]of privatePve){
    try{await entry.house.tick();}catch(e){console.error('Entraînement de Blanchecime :',e.message);}
    if((!entry.room||entry.room.phase==='finished')&&!contexts.get(id)?.socket.connected){privatePve.delete(id);if(!room?.ids.includes(id))contexts.delete(id);}
   }
   await syncWaitingPodiums();
   if(repository.honorRoll&&[...contexts.values()].some(c=>c.socket.connected&&c.getPlayer()?.currentmap===rules.HALL))await publishHonor();
   if(!round)return;
   if(round.phase==='betting'&&round.closesAt<=now()){round=await repository.spin(round.id,randomNumber(),now());emitRoulette();}
   if(round?.phase==='spinning'&&round.resultAt<=now()){const results=await repository.settleRoulette(round.id,now());for(const p of results){wallet(p.userId,p.balance);contexts.get(p.userId)?.socket.emit('whitepeak:rouletteResult',p);}round=await repository.rouletteState();emitRoulette();}
   if(round?.phase==='result'&&round.nextAt<=now()){
    await repository.closeRound(round.id,now());round=null;
    if([...contexts.values()].some(c=>c.socket.connected&&c.getPlayer()?.currentmap===rules.CASINO)){round=await repository.newRound(now());emitRoulette();}
   }
  });}catch(e){console.error('Blanchecime :',e.message);}finally{ticking=false;}
 }
 async function enter(id){
  await ready;const c=context(id),p=c.getPlayer();spectators.delete(id);
  if(p?.currentmap===rules.CASINO){round=await repository.newRound(now());c.socket.emit('whitepeak:roulette',{...round,serverNow:now()});}
  c.socket.emit('whitepeak:duel',p?.currentmap===rules.HALL?view(id):null);c.socket.emit('whitepeak:tournament',p?.currentmap===rules.HALL?tour.publicState(id):null);
  if(p?.currentmap===rules.HALL){await publishTrainers(id);if(repository.honorRoll)c.socket.emit('whitepeak:honor',await repository.honorRoll());}
  await step(id);
 }
 async function interact(id){
  const p=player(id),target=rules.interactionTarget(p,room?.tournament?tour.duelRoom||room:room);
  if(p.currentmap===rules.CASINO){
   if(!context(id).canUse())return true;
   if(target==='counter'){context(id).casinoDialogue?.();return true;}
   if(target!=='roulette')return false;
   await enter(id);context(id).socket.emit('whitepeak:open',{tab:'roulette'});return true;
  }
  if(p.currentmap!==rules.HALL)return false;
  if(target==='duel'&&rules.near(p,13,5,3)){context(id).socket.emit('whitepeak:open',{tab:'duel'});return true;}
  if(target==='board'){const ranking=repository.rankingPage?await repository.rankingPage({userId:id}):null;context(id).socket.emit('whitepeak:open',{tab:'board',ranking,rows:ranking?.rows||await repository.leaderboard()});return true;}
  if(target==='watch'){context(id).socket.emit('whitepeak:open',{tab:'watch'});return true;}
  if(rules.podium(p)>=0){await step(id);context(id).socket.emit('whitepeak:open',{tab:'duel'});return true;}
  return false;
 }
 const advanced=require('../game/whitepeak/duelHouse').createDuelHouse({contexts,getRoom:()=>room,setRoom:r=>{room=r;},emitRoom,now,emitSpectator:spectatorEvent,wallet,closed:()=>closed});
 const tour=require('../game/whitepeak/tournament').createTournament({contexts,getRoot:()=>room,setRoot:r=>{room=r;},emitRoom,emitSpectator:spectatorEvent,wallet,now,closed:()=>closed,
  archive:tournamentRepository||(repository===store?require('../persistence/whitepeakTournamentRepository'):require('../game/whitepeak/tournament').MEMORY),
  watch:id=>watch(id,true),clearWatch:id=>{spectators.delete(id);contexts.get(id)?.socket.emit('whitepeak:tournamentTurn');}});
 function attach(c){
  contexts.set(c.id,c);let requests=0,windowUntil=0;
  const ops={create,offer,confirm,tournamentStart:(id,data)=>tour.start(id,data),tournamentLeave:(id,data)=>tour.leave(id,data),leave:async id=>{requireMap(id,rules.HALL);const own=privatePve.get(id);if(own){if(['starting','battle','settling'].includes(own.room?.phase))rules.fail('Le combat est déjà engagé. Utilise le drapeau d’abandon.');own.house.cancel('L’entraînement a été annulé.');privatePve.delete(id);return null;}if(room?.tournament)return tour.leave(id,{id:room.id});if(room&&!['waiting','review','preparation'].includes(room.phase))rules.fail('Le combat est déjà engagé. Utilise le drapeau d’abandon.');if(room&&ownerIndex(id)<0&&room.hostId!==id)rules.fail('Tu ne participes pas à cette inscription.');cancel('Le duel a été annulé avant le départ.');return null;},
   ...Object.fromEntries(['compose','chat','inspect','action','pass','forfeit'].map(name=>[name,(id,data)=>house(id).command(name,id,data)])),
   board:async(id,data)=>{requireMap(id,rules.HALL);if(repository.rankingPage){const ranking=await repository.rankingPage({...data,userId:id});return{ranking,rows:ranking.rows};}return{rows:await repository.leaderboard()};},
   watch:id=>watch(id,false),unwatch:id=>{spectators.delete(id);return null;},
   bet:async(id,data)=>{available(id);const p=requireMap(id,rules.CASINO);if(!rules.atRouletteTable(p))rules.fail('Approche-toi de la table de roulette pour miser.');const result=await repository.placeBet(id,data,now());wallet(id,result.balance);round=await repository.rouletteState();emitRoulette();return result;},
   open:async(id)=>{available(id);await interact(id);return view(id);},refresh:async id=>{const restored=context(id).restoredHouse;await enter(id);if(restored===session(id)?.id)house(id).resync(id);return view(id);}};
  for(const[name,fn]of Object.entries(ops))c.account.on('whitepeak:'+name,(data={},ack)=>{
   if(typeof data==='function'){ack=data;data={};}const reply=typeof ack==='function'?ack:()=>{};
   // Refuse before queueing: a slow transaction must not grow an unbounded
   // global queue of retries from one client.
   if(now()>=windowUntil){windowUntil=now()+10000;requests=0;}
   if(++requests>35)return reply({success:false,message:'Patiente un instant entre deux actions.'});
   if(!data||typeof data!=='object'||Array.isArray(data))return reply({success:false,message:'Requête invalide.'});
   return execute(async()=>{
    try{context(c.id);expireRoom();reply({success:true,state:await fn(c.id,data)});}
    catch(e){if(!e.statusCode)console.error('Blanchecime :',e.message);reply({success:false,message:e.statusCode?e.message:'Cette action est temporairement indisponible.'});}
   });
  });
  const allowed=new Set(['actionResponse','whitepeak:leave','whitepeak:offer','whitepeak:confirm','whitepeak:refresh','whitepeak:compose','whitepeak:chat','whitepeak:inspect','whitepeak:action','whitepeak:pass','whitepeak:forfeit']);
  c.socket.use((packet,next)=>{const p=c.getPlayer();if((p?.__whitepeakDuel||p?.__whitepeakTournament)&&!allowed.has(packet[0])&&(/^(trade:|shop:|pc:|team:|training:|medicine:|evolution:|repel:)/.test(packet[0])||['Space','playerAction','requestShop','buyShopItem','sellShopItem','setTeamOrder','equipHeldItem','setHeldItem','useItem','useMedicine','useTrainingItem','useMachine','useEvolutionStone','evolvePokemon','learnMove','reorderMoves','flyToTown','void:travel','superTournament:travel','admin:rearmArenas','experienceModule:set'].includes(packet[0]))){const ack=packet.at(-1);if(typeof ack==='function')ack({success:false,message:'Termine ou annule le duel avant de modifier ton équipe.'});return;}next();});
  c.socket.once('disconnect',()=>{spectators.delete(c.id);house(c.id).disconnect(c.id,c);tour.disconnect(c.id);if(room&&!room.tournament&&['waiting','review'].includes(room.phase)&&(room.ids.includes(c.id)||room.hostId===c.id))cancel('Un dresseur s’est déconnecté avant le duel.');if(contexts.get(c.id)===c&&!['battle','settling'].includes(session(c.id)?.phase))contexts.delete(c.id);});
  return {
   enter:()=>{const map=c.getPlayer()?.currentmap,previous=c.clubMap;c.clubMap=map;
    return [rules.HALL,rules.CASINO].includes(map)||[rules.HALL,rules.CASINO].includes(previous)||room?.hostId===c.id?execute(()=>enter(c.id)):Promise.resolve();},
   step:()=>execute(()=>step(c.id)),
   interact:()=>[rules.HALL,rules.CASINO].includes(c.getPlayer()?.currentmap)?execute(()=>interact(c.id)):Promise.resolve(false)
  };
 }
 ready.then(()=>tick()).catch(e=>console.error('Initialisation de Blanchecime :',e.message));
 const timer=tickMs?setInterval(()=>void tick(),tickMs):null;timer?.unref?.();
 return {ready,attach,execute,tick,view,roomFor:session,close(){closed=true;clearInterval(timer);},get room(){return room?.tournament?tour.duelRoom||room:room;},get tournament(){return room?.tournament?tour.publicState(null):null;}};
}
function getClub(io){if(!servers.has(io))servers.set(io,createClub(io));return servers.get(io);}
module.exports={getClub,createClub};

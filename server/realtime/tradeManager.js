const {randomUUID}=require('node:crypto');
const repository=require('../persistence/tradeRepository');
const rules=require('../game/social/tradeRules');
const locks=require('../game/social/tradeLocks');
const {trackAccountTask}=require('./accountConnection');
const managers=new WeakMap();
const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
const terminal=phase=>['completed','cancelled'].includes(phase);
function createTradeManager({store=repository,now=Date.now,tickMs=1000,relationship=require('../persistence/trainerRepository').relationship}={}){
 const contexts=new Map(),trades=new Map(),active=new Map();
 const actor=(id,t)=>t.ids.indexOf(id);
 function emit(t){for(const id of t.ids){const c=contexts.get(id);if(c?.socket.connected&&active.get(id)===t.id)c.socket.emit('trade:state',view(id,t));}}
 function view(id,t=trades.get(active.get(id))){
  if(!t||actor(id,t)<0)return null;
  return{id:t.id,phase:t.phase,participants:t.ids.map((id,i)=>({id,username:t.names[i]})),revision:t.revision,requestedBy:t.ids[0],expiresAt:t.expiresAt,ready:[...t.ready],confirmed:[...t.confirmed],offers:t.review?.summaries||[null,null],digest:t.review?.digest||null,error:t.review?.error||'',reason:t.reason||'',receipt:t.receipt||null};
 }
 function requireTrade(id,data){const t=trades.get(active.get(id));if(!t||data?.id!==t.id||actor(id,t)<0)fail('Cet échange n’est plus disponible.');return t;}
 function available(c,t){return c?.socket.connected&&c.mode==='adventure'&&c.available(t?.id);}
 function freeze(t,ids){const players=ids.map(id=>contexts.get(id)?.getPlayer());if(players.some(p=>!p))fail('Ce dresseur n’est plus disponible.');locks.acquire(ids,t.id);for(const p of players){p.__tradeId=t.id;p.inventoryBusy=true;}}
 function release(t){locks.release(t.ids,t.id);for(const id of t.ids){const p=contexts.get(id)?.getPlayer();if(p?.__tradeId===t.id){delete p.__tradeId;p.inventoryBusy=false;}}}
 function cancelTrade(t,reason){if(terminal(t.phase))return;if(['committing','recovering'].includes(t.phase))fail('Le transfert est en cours de vérification.');t.phase='cancelled';t.reason=reason;t.expiresAt=now()+300000;release(t);emit(t);}
 async function inspect(t){const r=await store.inspect(t.ids,t.offers);return r;}
 function reset(t,result){t.review=result.review;t.inventories=result.inventories;t.ready=[false,false];t.confirmed=[false,false];t.phase='open';t.revision++;t.expiresAt=now()+300000;}
 async function request(id,target){
  if(!Number.isInteger(target)||target<1||target===id)fail('Choisis un ami.');
  const sender=contexts.get(id),recipient=contexts.get(target);
  if(sender?.mode!=='adventure'||recipient?.mode!=='adventure')fail('Les échanges sont disponibles entre deux amis en Aventure.');
  if(!available(sender)||!available(recipient))fail('Les deux dresseurs doivent être connectés et libres en Aventure.');
  for(const owner of[id,target]){const previous=trades.get(active.get(owner));if(previous&&!terminal(previous.phase))fail('Un échange ou une invitation est déjà en cours.');}
  if(await relationship(id,target)!=='friends')fail('Vous devez d’abord être amis.');
  // Recheck after the SQL relationship read: simultaneous requests cannot overlap.
  for(const owner of[id,target]){const previous=trades.get(active.get(owner));if(previous&&!terminal(previous.phase))fail('Un échange est déjà en cours.');}
  if(!available(sender)||!available(recipient))fail('Ce dresseur n’est plus disponible.');
  const t={id:randomUUID(),ids:[id,target],names:[sender.username,recipient.username],phase:'invited',revision:0,ready:[false,false],confirmed:[false,false],offers:[rules.normalizeOffer(),rules.normalizeOffer()],expiresAt:now()+90000};
  freeze(t,[id]);trades.set(t.id,t);for(const owner of t.ids)active.set(owner,t.id);emit(t);return view(id,t);
 }
 async function answer(id,data){
  const t=requireTrade(id,data);if(t.phase!=='invited'||id!==t.ids[1]||typeof data.accept!=='boolean')fail('Invitation invalide.');
  if(data.accept===false){cancelTrade(t,'Invitation refusée.');return view(id,t);}
  if(t.expiresAt<=now()){cancelTrade(t,'Invitation expirée.');return view(id,t);}
  if(!t.ids.every(owner=>available(contexts.get(owner),t))){cancelTrade(t,'Un des dresseurs n’est plus disponible.');return view(id,t);}
  freeze(t,t.ids);
  try{const result=await inspect(t);if(t.phase!=='invited')return view(id,t);reset(t,result);emit(t);return view(id,t);}catch(e){if(!terminal(t.phase))cancelTrade(t,e.statusCode?e.message:'L’échange n’a pas pu être ouvert.');throw e;}
 }
 async function inventory(id,data){const t=requireTrade(id,data);if(!['open','review'].includes(t.phase))fail('Ouvre d’abord l’échange.');return t.inventories[actor(id,t)];}
 function version(t,data){if(data.revision!==t.revision||data.digest!==t.review?.digest)fail('L’offre a changé. Vérifie le récapitulatif actualisé.');}
 async function offer(id,data){
  const t=requireTrade(id,data);if(t.phase!=='open'||t.updating)fail('Attends la mise à jour de l’offre.');version(t,data);const index=actor(id,t),next=rules.normalizeOffer(data.offer);
  if(JSON.stringify(next)===JSON.stringify(t.offers[index]))return view(id,t);
  t.updating=true;const proposed=t.offers.map((o,i)=>i===index?next:o);
  try{const result=await store.inspect(t.ids,proposed);if(t.phase!=='open')return view(id,t);t.offers=proposed;reset(t,result);emit(t);return view(id,t);}finally{t.updating=false;}
 }
 async function ready(id,data){
  const t=requireTrade(id,data);if(t.phase!=='open'||t.updating)fail('Attends la mise à jour de l’offre.');version(t,data);if(t.review.error)fail(t.review.error);
  t.ready[actor(id,t)]=true;
  if(t.ready.every(Boolean)){
   t.updating=true;
   try{const result=await inspect(t);if(t.phase!=='open')return view(id,t);if(result.review.digest!==t.review.digest||result.review.error){reset(t,result);}else{t.inventories=result.inventories;t.phase='review';t.confirmed=[false,false];}}finally{t.updating=false;}
  }
  t.expiresAt=now()+300000;emit(t);return view(id,t);
 }
 function edit(id,data){const t=requireTrade(id,data);if(!['open','review'].includes(t.phase)||t.updating)fail('L’échange ne peut plus être modifié.');version(t,data);t.phase='open';t.ready=[false,false];t.confirmed=[false,false];t.revision++;emit(t);return view(id,t);}
 async function recover(t){
  if(t.recoveryPromise)return t.recoveryPromise;
  const task=(async()=>{try{const receipt=await store.loadReceipt(t.ids[0],t.id);for(const id of t.ids){const c=contexts.get(id);if(c?.socket.connected&&c.mode==='adventure')await c.reload();}t.receipt=receipt;t.phase=receipt?'completed':'cancelled';t.reason=receipt?'':'Aucun transfert enregistré.';t.expiresAt=now()+300000;release(t);emit(t);}catch{t.nextRecovery=now()+3000;}})();
  t.recoveryPromise=task;try{await task;}finally{t.recoveryPromise=null;}
 }
 async function confirm(id,data){
  const t=requireTrade(id,data);if(t.phase==='completed')return view(id,t);if(t.phase!=='review'||t.updating)fail('Vérifiez d’abord les deux offres.');version(t,data);
  t.confirmed[actor(id,t)]=true;if(!t.confirmed.every(Boolean)){emit(t);return view(id,t);}
  if(!t.ids.every(owner=>available(contexts.get(owner),t))){cancelTrade(t,'Un des dresseurs n’est plus disponible.');return view(id,t);}
  t.phase='committing';emit(t);const participants=t.ids.map(owner=>contexts.get(owner));
  const work=(async()=>{
   try{
    const result=await store.commit({id:t.id,ids:t.ids,offers:t.offers,digest:t.review.digest});
    // Update both live parties before either retiring connection can save again.
    if(result.plans)for(let i=0;i<2;i++)participants[i].apply(result.plans[i]);
    else for(const c of participants)await c.reload();
    t.receipt=result.receipt;t.phase='completed';t.expiresAt=now()+300000;
    for(const c of participants)try{await c.synchronize();}catch(e){console.error('Actualisation après échange :',e.message);c.socket.emit('progressionNotice',{message:'Échange enregistré. Rouvre ton sac ou le PC pour actualiser son contenu.'});}
   }catch(error){
    // A receipt is the authority if the connection was interrupted after COMMIT.
    t.phase='recovering';t.reason='Vérification de la sauvegarde en cours…';
    await recover(t);
    if(t.phase==='cancelled'&&error.statusCode)t.reason=error.message;
   }finally{if(terminal(t.phase))release(t);emit(t);for(const c of participants)if(!c.socket.connected&&contexts.get(c.id)===c)contexts.delete(c.id);}
  })();
  for(const c of participants)trackAccountTask(c.socket,work);
  await work;return view(id,t);
 }
 function cancel(id,data){const t=requireTrade(id,data);cancelTrade(t,'Échange annulé. Aucun transfert effectué.');return view(id,t);}
 function close(id,data){if(!active.has(id)){contexts.get(id)?.socket.emit('trade:state',null);return null;}const t=requireTrade(id,data);if(!terminal(t.phase))fail('Annule d’abord l’échange.');if(active.get(id)===t.id)active.delete(id);contexts.get(id)?.socket.emit('trade:state',null);return null;}
 async function refresh(id,data={}){const current=view(id);if(current){const t=trades.get(current.id);if(t.phase==='recovering')await recover(t);return view(id,t);}if(!data.id)return null;const receipt=await store.loadReceipt(id,data.id);if(!receipt)return null;return{id:receipt.id,phase:'completed',receipt,participants:receipt.participants.map(id=>({id})),offers:receipt.offers,ready:[true,true],confirmed:[true,true]};}
 function attach(context){
  const id=context.id;contexts.set(id,context);const current=trades.get(active.get(id));if(current&&!terminal(current.phase)&&context.mode==='adventure'&&(current.phase!=='invited'||current.ids[0]===id))freeze(current,[id]);context.socket.emit('trade:state',view(id));
  context.socket.once('disconnect',()=>{if(contexts.get(id)!==context)return;const t=trades.get(active.get(id));if(t&&!terminal(t.phase)&&!['committing','recovering'].includes(t.phase))cancelTrade(t,'Un dresseur s’est déconnecté. Aucun transfert effectué.');if(t?.phase!=='committing')contexts.delete(id);});
 }
 function friendshipChanged(a,b){const t=trades.get(active.get(a));if(t?.ids.includes(b)&&!terminal(t.phase)&&!['committing','recovering'].includes(t.phase))cancelTrade(t,'L’amitié a été interrompue. Aucun transfert effectué.');}
 function tick(){for(const t of trades.values())if(t.phase==='recovering'){if(!t.nextRecovery||t.nextRecovery<=now())void recover(t);}else if(t.expiresAt<=now()&&t.phase!=='committing'){if(!terminal(t.phase))cancelTrade(t,'L’échange a expiré. Aucun transfert effectué.');else{for(const id of t.ids)if(active.get(id)===t.id)active.delete(id);trades.delete(t.id);}}}
 const timer=tickMs?setInterval(tick,tickMs):null;timer?.unref();
 return{attach,view,request,answer,inventory,offer,ready,edit,confirm,cancel,close,refresh,friendshipChanged,tick,stop(){if(timer)clearInterval(timer);for(const t of trades.values())if(t.phase!=='committing')release(t);contexts.clear();}};
}
function getTradeManager(io){const server=io.server||io;if(!managers.has(server)){const manager=createTradeManager();managers.set(server,manager);server.httpServer?.once('close',()=>{manager.stop();managers.delete(server);});}return managers.get(server);}
module.exports={createTradeManager,getTradeManager};

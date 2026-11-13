const {InputObservation,desktopAgent}=require('../../game/social/inputObservation');
const repository=require('../../persistence/inputObservationRepository');
const observers=new WeakMap();
function commandKind(event,data){
 if(event==='Space')return 'world:action';
 if(['fishing:start','fishing:reel'].includes(event))return event;
 if(['actionResponse','whitepeak:action','draft:action'].includes(event)&&['attack','change','bag','flee'].includes(data?.action))return 'battle:'+data.action+(data.action==='attack'&&Number.isInteger(data.number)&&data.number>=0&&data.number<4?':'+data.number:'');
 return null;
}
async function register({socket,account,userId,hub,now=Date.now,persist=repository}){
 if(!desktopAgent(socket.handshake?.headers?.['user-agent']))return null;
 let model;try{model=new InputObservation(await persist.load(userId),now);}catch(error){console.error('Observations des entrées : initialisation indisponible.');return null;}
 let closed=false,lastEval=0,lastSave=now(),queue=Promise.resolve(),revision=0,savedRevision=0,suppressedUntil=0;
 function work(force=false){
  const task=queue.then(async()=>{
   const assessment=model.evaluate();
   if(assessment.highConfidence&&now()>=suppressedUntil){const result=await persist.notifyFriends(userId,{...model.snapshot(),confirmedAt:model.candidateAt},now());if(result.qualified||result.duplicate)suppressedUntil=result.nextAlertAt||now()+repository.ALERT_COOLDOWN;for(const message of result.messages){try{await hub.deliverStoredMessage(message);}catch{console.error('Notification persistée : actualisation différée.');}}}
   if(revision!==savedRevision&&(force||now()-lastSave>=60000)){const currentRevision=revision;await persist.save(userId,model.snapshot());savedRevision=currentRevision;lastSave=now();}
  });queue=task.catch(()=>{console.error('Observations des entrées : enregistrement indisponible.');});account.track(queue);return queue;
 }
 function evaluate(){if(closed||now()-lastEval<10000)return;lastEval=now();work();}
 const observe=(event,data)=>{const kind=commandKind(event,data);if(!kind||closed)return;model.command(kind);revision++;evaluate();};
 socket.onAny(observe);
 account.on('input:rhythm',data=>{if(!closed&&model.telemetry(data)){revision++;evaluate();}});
 const handle={fishing(data){if(closed)return;model.fishing(data);revision++;evaluate();}};observers.set(socket,handle);
 account.onClose(async()=>{closed=true;socket.offAny(observe);observers.delete(socket);await work(true);});
 return handle;
}
function fishing(socket,data){observers.get(socket)?.fishing(data);}
module.exports={register,fishing,commandKind};

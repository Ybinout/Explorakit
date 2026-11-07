const content=require('../../game/tutorial/earlyGame'),repo=require('../../persistence/earlyTutorialRepository');
function createHandlers({socket,account,userId,getPlayer,getProgress,updateProgress}){
 let session=null,queue=Promise.resolve(),savedState=content.state(getProgress());
 const publish=s=>{if(s){savedState=s;updateProgress(content.KEY,JSON.stringify(s));socket.emit('earlyTutorialState',content.view(s));}return s;};
 function state(){return savedState;}
 const supported=()=>socket.handshake?.auth?.earlyTutorial===1;
 // An older general progression response must not rewind a just-committed lesson.
 function refresh(){savedState ||= content.state(getProgress());if(savedState)updateProgress(content.KEY,JSON.stringify(savedState));socket.emit('earlyTutorialState',content.view(savedState));}
 account.on('earlyTutorial:advance',(data,ack)=>{
  const task=queue.then(async()=>{try{const p=getPlayer(),s=state();if(!s||!supported()||!p)throw Error('L’initiation est indisponible.');if(['care','menu','team'].includes(data?.phase)){if(p.inbattle||session)throw Error('Termine ton combat avant de continuer.');}else if(!session||!p.inbattle||session.uuid!==data?.encounter)throw Error('Cette étape n’appartient pas au combat actuel.');const saved=publish(await repo.advance(userId,data.phase,data.encounter));session?.release();ack?.({success:true,state:content.view(saved)});}catch(e){ack?.({success:false,message:e.message});}});queue=task.catch(()=>{});return task;
 });
 async function prepare(wild){
  const p=getPlayer();if(!supported()||p?.currentmap!=='start'||!content.active(state()))return null;
  // The first wild encounter uses a common local species, never a rare catch.
  const specimen=await require('../../game/world/wildPokemonFactory').createAtLevel(10,3,{mapName:'start'});Object.assign(wild,specimen);
  const capturedMoves={abilities:[...wild.abilities],movePp:[...wild.movePp]};
  wild.abilities=['String Shot'];wild.movePp=[40];wild.passiveAbility='Shield Dust';publish(await repo.begin(userId,wild.uuid));
  let resolveReady=null,closed=false;
  const current={uuid:wild.uuid,
   wait(){if(closed||!socket.connected)return Promise.resolve(false);if(['attack','capture'].includes(state()?.phase))return Promise.resolve(true);return new Promise(resolve=>{resolveReady=resolve;});},
   release(){if(resolveReady&&['attack','capture'].includes(state()?.phase)){const r=resolveReady;resolveReady=null;r(true);}},
   allows(data){return state()?.phase==='attack'?data.action==='attack':state()?.phase==='capture'&&data.action==='bag'&&data.itemKey==='pokeball';},
   async afterAttack(){publish(await repo.attacked(userId,wild.uuid));},
   async capture(itemKey){require('../../game/battle/battleOutcome').clearBattleTransientState([wild]);Object.assign(wild,capturedMoves);let r;try{r=await repo.capture(userId,wild.uuid,p,wild,itemKey);}catch(error){wild.abilities=['String Shot'];wild.movePp=[40];throw error;}if(r.duplicate)throw Error('Cette capture est déjà enregistrée. Reconnecte-toi pour retrouver ton compagnon.');if(!r.stored)p.equipe.pokemons.push(wild);publish(r.state);return r;},
   close(){closed=true;resolveReady?.(false);resolveReady=null;if(session===current)session=null;}
  };session=current;return current;
 }
 account.onClose(()=>session?.close());
 return {refresh,prepare,close:()=>session?.close(),async wayne(){publish(await repo.noteWayne(userId));},canTrain(){return supported();}};
}
module.exports={createHandlers};

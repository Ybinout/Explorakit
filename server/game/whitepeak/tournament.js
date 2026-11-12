const {randomUUID,randomInt}=require('node:crypto');
const rules=require('./rules'),brackets=require('./tournamentBracket'),locks=require('../social/tradeLocks');
const MEMORY={recover:async()=>{},inspect:async()=>true,save:async()=>{}};
function createTournament({contexts,getRoot,setRoot,emitRoom,emitSpectator,wallet,watch,clearWatch,now=Date.now,closed=()=>false,archive=MEMORY,houseFactory=require('./duelHouse').createDuelHouse,houseOptions={},pick=randomInt}){
 let duelRoom=null,lastDuel=null,watched=new Set();
 const root=()=>getRoot()?.tournament?getRoot():null;
 const connected=id=>{const c=contexts.get(id);return !!c?.socket.connected&&c.account.active()&&c.getPlayer()?.currentmap===rules.HALL;};
 const ready=archive.recover();ready.catch(error=>console.error("Reprise des tournois :",error.message));
 const child=houseFactory({...houseOptions,contexts,getRoom:()=>duelRoom,setRoom:r=>{duelRoom=r;if(r)lastDuel=r;},emitRoom,now,emitSpectator,wallet,closed,onSettled:settled});
 function hold(ids){const t=root();if(!t)return;const list=ids.filter(id=>!t.left.has(id));if(list.length)locks.acquire(list,t.id);for(const id of list){const p=contexts.get(id)?.getPlayer();if(p){p.__whitepeakTournament=t.id;p.inventoryBusy=true;}}}
 function release(ids){const t=root();if(!t)return;locks.release(ids,t.id);for(const id of ids){const p=contexts.get(id)?.getPlayer();if(p?.__whitepeakTournament===t.id){delete p.__whitepeakTournament;if(!p.__whitepeakDuel)p.inventoryBusy=false;}}}
 function publicState(id){const t=root();if(!t)return null;return{id:t.id,hostId:t.hostId,phase:t.phase,config:t.config,participants:t.ids.map((uid,i)=>({userId:uid,username:t.names[i],left:t.left.has(uid),eliminated:t.rounds.some(r=>r.matches.some(m=>m.players.includes(uid)&&m.phase==='finished'&&m.winnerId!==uid))})),rounds:t.rounds,winnerId:t.winnerId||null,you:t.ids.indexOf(id),serverNow:now(),deadline:t.placementDeadline,error:t.error||'',currentMatchId:t.current?.id||null};}
 async function persist(){const t=root();if(!t)return;await archive.save(t);t.dirty=false;}
 function requireRoot(id,data){const t=root();if(!t||data?.id!==t.id)rules.fail('Ce tournoi a changé. Ouvre à nouveau son tableau.');if(!connected(id))rules.fail('Rejoins la Maison des Combats.');return t;}
 async function create(id,config){
 await ready;const t={tournament:true,id:randomUUID(),hostId:id,config,phase:'waiting',ids:[],names:[],rounds:[],left:new Set(),disconnected:new Map(),createdAt:now(),placementDeadline:now()+rules.PLACEMENT_TIMEOUT,expiresAt:now()+300000,dirty:false};setRoot(t);try{await sync();await persist();}catch(e){setRoot(null);emitRoom();throw e;}emitRoom();return publicState(id);
 }
 async function sync(){
 const t=root();if(!t||t.phase!=='waiting')return;
 for(const id of t.left)if(connected(id)&&rules.podium(contexts.get(id).getPlayer())<0)t.left.delete(id);
 const candidates=[...contexts.values()].filter(c=>connected(c.id)&&c.canUse()&&!c.getPlayer().inbattle&&!c.getPlayer().inventoryBusy&&!locks.locked(c.id)&&rules.podium(c.getPlayer())>=0).sort((a,b)=>Number(b.id===t.hostId)-Number(a.id===t.hostId)||a.id-b.id);
 const ids=candidates.filter(c=>!t.left.has(c.id)).slice(0,16).map(c=>c.id);if(JSON.stringify(ids)!==JSON.stringify(t.ids)){t.ids=ids;t.names=ids.map(id=>contexts.get(id).username);t.dirty=true;emitRoom();}
 if(t.ids.includes(t.hostId))t.placementDeadline=null;else if(!t.placementDeadline)t.placementDeadline=now()+rules.PLACEMENT_TIMEOUT;
 }
 async function start(id,data){
 const t=requireRoot(id,data);if(id!==t.hostId)rules.fail('Seul l’organisateur lance le tournoi.');if(t.phase!=='waiting')rules.fail('Le tournoi est déjà lancé.');await sync();if(!t.ids.includes(id)||t.ids.length<3)rules.fail('Au moins trois dresseurs, dont l’organisateur, doivent rejoindre les socles.');
 hold(t.ids);try{await archive.inspect(t.ids,{...t.config,mode:'1v1'});if(t.ids.some(id=>!connected(id)))rules.fail('Un participant vient de quitter la salle.');t.rounds=[brackets.firstRound(t.ids,pick)];t.phase='running';t.dirty=true;await persist();emitRoom();await advance();return publicState(id);}catch(e){if(!t.rounds.length||t.phase==='waiting'){release(t.ids);t.phase='waiting';}throw e;}
 }
 function settled(r){const t=root();if(!t||!t.current||t.current.duelId!==r.id||t.current.phase==='finished')return;
 const m=t.current;let winner=r.result?.winnerId||null;
 if(!winner){const eligible=m.players.filter(id=>!t.left.has(id));if(eligible.length===1)winner=eligible[0];else if(eligible.length===2){const strength=r.copies.map(p=>[p.equipe.pokemons.filter(p=>p.currentHp>0).length,p.equipe.pokemons.reduce((sum,p)=>sum+Math.max(0,p.currentHp)/Math.max(1,p.maxHp),0)]);winner=strength[0][0]!==strength[1][0]?m.players[strength[0][0]>strength[1][0]?0:1]:strength[0][1]!==strength[1][1]?m.players[strength[0][1]>strength[1][1]?0:1]:eligible[pick(2)];m.tiebreak=true;}}
 m.winnerId=winner;m.phase='finished';m.reason=r.result?.reason||'finished';t.dirty=true;t.nextAt=now()+1600;hold(r.ids);emitRoom();
 }
 function walkover(m){const t=root(),eligible=m.players.filter(id=>connected(id)&&!t.left.has(id));m.phase='finished';m.winnerId=eligible.length===1?eligible[0]:null;m.reason='forfeit';t.dirty=true;t.nextAt=now()+750;}
 async function advance(){
 const t=root();if(!t||t.phase!=='running')return;
 if(duelRoom&&['starting','preparation','battle','settling'].includes(duelRoom.phase))return;
 let round=t.rounds.at(-1),m=round.matches.find(m=>m.phase==='waiting');
 if(!m){const next=brackets.nextRound(round);if(next.finished){t.phase=next.winnerId?'finished':'cancelled';t.winnerId=next.winnerId;t.finishedAt=now();t.current=null;t.dirty=true;await persist();release(t.ids);emitRoom();return;}t.rounds.push(next.round);round=next.round;m=round.matches.find(m=>m.phase==='waiting');if(!m){t.dirty=true;return;}}
 const absent=m.players.filter(id=>!connected(id)||t.left.has(id));
 if(absent.length){if(absent.some(id=>!t.left.has(id)&&(!t.disconnected.has(id)||now()-t.disconnected.get(id)<30000))){for(const id of absent)if(!t.disconnected.has(id))t.disconnected.set(id,now());return;}walkover(m);await persist();emitRoom();return;}
 t.current=m;watched=new Set();for(const id of m.players)clearWatch(id);
 locks.release(m.players,t.id);
 try{await child.createAssigned(m.players,{...t.config,mode:'1v1'});m.duelId=duelRoom.id;m.phase='preparation';t.dirty=true;await persist();emitRoom();}
 catch(e){hold(m.players);m.phase='finished';m.winnerId=null;m.reason='unavailable';t.error=e.statusCode?e.message:'Ce duel n’a pas pu être préparé. Aucune mise n’est prélevée.';t.dirty=true;await persist();emitRoom();}
 }
 async function tick(){
 const t=root();if(!t)return;
 if(t.phase==='waiting'){if(!connected(t.hostId)||t.placementDeadline&&now()>=t.placementDeadline||now()>=t.expiresAt){t.phase='cancelled';t.error='Inscription annulée : l’organisateur a quitté la salle ou n’a pas rejoint un socle à temps.';t.dirty=true;}else await sync();if(t.dirty){await persist();emitRoom();}return;}
 if(t.phase!=='running'){if(t.dirty){await persist();release(t.ids);emitRoom();}return;}
 await child.tick();
 if(t.current&&['preparation','battle'].includes(t.current.phase)&&!duelRoom){walkover(t.current);hold(t.current.players);}
 if(duelRoom?.phase==='battle'){
 if(t.current.phase!=='battle'){t.current.phase='battle';t.dirty=true;emitRoom();}for(const id of t.ids)if(!duelRoom.ids.includes(id)&&connected(id)&&!t.left.has(id)&&!watched.has(id)){await watch(id);watched.add(id);}
 }
 if(t.dirty)await persist();if(!t.nextAt||now()>=t.nextAt)await advance();
 }
 async function leave(id,data){const t=requireRoot(id,data);if(!t.ids.includes(id))rules.fail('Tu ne participes pas à ce tournoi.');
 if(t.phase==='waiting'){if(id===t.hostId){t.phase='cancelled';t.dirty=true;await persist();emitRoom();return null;}t.left.add(id);await sync();await persist();emitRoom();return publicState(id);}
 if(t.phase!=='running')return publicState(id);t.left.add(id);release([id]);
 if(duelRoom?.ids.includes(id)&&duelRoom.phase==='battle')duelRoom.engine.finish(duelRoom.copies[1-duelRoom.ids.indexOf(id)],'forfeit');
 else if(duelRoom?.ids.includes(id)&&duelRoom.phase==='preparation'){child.cancel('Un dresseur a abandonné son duel. Aucune mise n’est prélevée.');walkover(t.current);hold(t.current.players);}
 t.dirty=true;await persist();emitRoom();return publicState(id);
 }
 async function step(id){const t=root();if(!t)return;if(t.phase==='waiting')return sync();if(t.phase==='running'&&t.ids.includes(id)){
 if(connected(id)){t.disconnected.delete(id);if(!duelRoom?.ids.includes(id))hold([id]);await child.step(id);if(!duelRoom?.ids.includes(id)&&duelRoom?.phase==='battle'&&!t.left.has(id)&&!watched.has(id)){await watch(id);watched.add(id);}}
 else if(!t.disconnected.has(id))t.disconnected.set(id,now());
 }}
 function disconnect(id){const t=root();if(t?.ids.includes(id)&&!t.disconnected.has(id))t.disconnected.set(id,now());}
 return{ready,create,start,leave,step,tick,disconnect,sync,publicState,child,get duelRoom(){return duelRoom;},get lastDuel(){return lastDuel;},isMember:id=>!!root()?.ids.includes(id),duelView:id=>duelRoom?child.view(duelRoom,id):null};
}
module.exports={createTournament,MEMORY};

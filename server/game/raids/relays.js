const {active,config}=require('./cooperation');
const waits=b=>b.sim.queue.list.filter(a=>a.raidWait&&active(a.pokemon));
function ensure(b){
 const r=b.sim.raid;r.relayVersion=2;r.handRequests||={};r.requestTimes||={};
 for(const a of waits(b))a.raidToken||={id:b.sim.turn+':'+a.pokemon.position,visited:[a.pokemon.position]};
}
function targets(b){
 const current=waits(b)[0];if(!current||b.finished)return[];
 const visited=current.raidToken?.visited||[current.pokemon.position];
 if(visited.length-1>=config.relay.maximumTransfersPerToken)return[];
 return b.sim.p1.active.filter(active).filter(p=>!visited.includes(p.position)).map(p=>p.position);
}
function prune(b){
 const r=b.sim.raid,current=waits(b)[0]?.pokemon.position,eligible=targets(b),owner=b.models[current]?.ownerId;
 for(const [slot,request]of Object.entries(r.handRequests||{}))if(b.finished||request.turn!==b.sim.turn||!eligible.includes(Number(slot))||request.ownerId===owner)delete r.handRequests[slot];
}
function view(b,userId){
 const counts=Array(4).fill(0);for(const a of waits(b))counts[a.pokemon.position]++;
 return {relayVersion:2,remainingActions:counts,actionPool:counts.reduce((a,b)=>a+b,0),relayTargets:targets(b),multiplayer:!b.isSolo,handRequests:Object.values(b.sim.raid.handRequests||{}).map(r=>({slot:r.slot,ownerId:r.ownerId,turn:r.turn,mine:r.ownerId===userId}))};
}
function request(b,userId,data){
 ensure(b);prune(b);
 if(b.isSolo||b.flowVersion!==2||b.finished)throw Error('Les demandes de main sont réservées aux raids multijoueurs.');
 if(data.token!==b.token||b.now()>=b.deadline)throw Error('Cette demande n’est plus disponible.');
 const slot=data.slot,current=waits(b)[0]?.pokemon.position;
 if(!Number.isInteger(slot)||b.models[slot]?.ownerId!==userId)throw Error('Tu ne contrôles pas ce Pokémon.');
 const requests=b.sim.raid.handRequests;
 if(data.action==='cancelHandRequest'){if(requests[slot]){delete requests[slot];b.revision++;}return false;}
 if(!targets(b).includes(slot)||b.models[current]?.ownerId===userId)throw Error('Attends la main d’un autre dresseur pour la demander.');
 if(requests[slot])return false;
 const now=b.now(),last=b.sim.raid.requestTimes[slot];if(last!==undefined&&now-last<config.relay.requestCooldownMs)throw Error('Patiente un instant avant une nouvelle demande.');
 b.sim.raid.requestTimes[slot]=now;requests[slot]={slot,ownerId:userId,turn:b.sim.turn};b.revision++;return false;
}
function transfer(b,slot,target){
 ensure(b);if(!Number.isInteger(target)||!targets(b).includes(target))throw Error('Choisis un allié apte qui n’a pas déjà transmis cette action.');
 const a=waits(b)[0],token=a.raidToken;token.visited.push(target);
 a.pokemon=b.sim.p1.active[target];a.speed=a.pokemon.getActionSpeed();
 // Same queue entry, same token, same budget. The recipient's own queued
 // reserve stays in place; a spent reserve is never recreated.
 delete b.sim.raid.handRequests[target];
 b.sim.raid.events.push({kind:'pass',slot,target,tokenId:token.id,at:b.sim.log.length});
 prune(b);
}
module.exports={ensure,targets,prune,view,request,transfer,waits};

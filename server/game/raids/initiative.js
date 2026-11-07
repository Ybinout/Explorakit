// Raid-only decision boundaries inside ONE native turn. Residuals, move/ability/
// item hooks and PP remain native; no artificial turn is created by a relay.
const {Battle} = require('@pkmn/sim');
const {randomUUID} = require('node:crypto');
const labels = require('../../../data/game/corruption_labels.fr.json');
const alive = p => p?.hp > 0 && !p.m.retired;
const own = p => p?.side.n === 0;

function initialize(b) {
  b.flowVersion = 2;
  b.sim.raid.reactive = true;
  prepare(b);
  arm(b);
}
function prepare(b) {
  const sim = b.sim, raid = sim.raid;
  sim.queue.clear();
  sim.updateSpeed();
  // Only initiative is fixed before a decision. A future, unchosen priority
  // cannot be guessed. Locked moves retain their real native priority.
  for (const p of sim.p1.active) if(p.m.friendGuard && sim.turn > p.m.friendGuard) delete p.m.friendGuard;
  for (const p of sim.p1.active.filter(alive)) {
    const locked = p.getLockedMove();
    // Do not run item/ability priority hooks for a move not yet selected:
    // a placeholder must never eat a Custap Berry or trigger Prankster.
    sim.queue.list.push({choice:'move', pokemon:p, move:sim.dex.getActiveMove(locked || 'splash'), raidWait:true, targetLoc:1, order:200, priority:locked ? sim.dex.moves.get(locked).priority : 0, speed:p.getActionSpeed()});
  }
  sim.queue.sort(); // Native Speed, Trick Room, ties and priority modifiers.
  const count = sim.queue.list.length;
  raid.intents = b.bossPlan.map((move, index) => ({id:sim.turn+':'+index, move, remaining:index ? count : Math.min(2,count), done:false}));
  raid.intents.forEach((intent,index) => sim.queue.addChoice({choice:'move', pokemon:b.bossPokemon, move:sim.dex.moves.get(intent.move), targetLoc:1, raidBoss:index}));
  sim.queue.addChoice({choice:'residual'});
  cadence(sim);
  sim.midTurn = true;
  sim.runAction({choice:'beforeTurn'});
  sim.makeRequest('move');
  b.pending = {};
}
function cadence(sim) {
  const bosses = sim.queue.list.filter(a => a.raidBoss !== undefined);
  const actions = sim.queue.list.filter(a => a.raidBoss === undefined && (!a.raidWait || alive(a.pokemon)));
  const count = actions.filter(a => a.raidWait).length;
  const result = [];
  let passed = 0;
  const due = () => {
    for (let i=0;i<bosses.length;i++) {
      const a = bosses[i], intent = sim.raid.intents[a.raidBoss];
      if (intent && !intent.done && Math.min(count,intent.remaining) <= passed) {result.push(a);bosses.splice(i--,1);}
    }
  };
  due();
  for (const a of actions) {result.push(a);if(a.raidWait){passed++;due();}}
  sim.queue.list = result;
}
function turnLoop(sim) {
  sim.requestState = '';
  let action;
  while ((action = sim.queue.peek())) {
    if (action.raidWait && alive(action.pokemon)) {sim.makeRequest('move');return;}
    sim.queue.shift();
    if (action.raidBoss !== undefined) sim.raid.intents[action.raidBoss].done = true;
    const consumes = action.choice === 'move' && own(action.pokemon) && alive(action.pokemon) && !action.raidWait;
    sim.runAction(action);
    if (consumes) {
      for (const intent of sim.raid.intents) if(!intent.done) intent.remaining=Math.max(0,intent.remaining-1);
      const intent=sim.raid.intents.find(i=>!i.done);
      if(intent)sim.raid.events.push({kind:'intention',at:sim.log.length,remaining:intent.remaining,target:require('./ruleset').target(sim)-1});
    }
    if (sim.ended) return;
    cadence(sim);
    // There are no reserves in a raid. The native engine still handles faint,
    // pivot failure, abilities and the residual queue before this boundary.
    if (sim.requestState === 'switch') throw Error('Un remplacement non prévu a interrompu le raid.');
  }
  Battle.prototype.endTurn.call(sim);
  sim.midTurn = false;
  sim.queue.clear();
}
function slot(b) {return b.sim.queue.list.find(a=>a.raidWait&&alive(a.pokemon))?.pokemon.position ?? -1;}
function arm(b) {
  const selected=slot(b), start=Math.max(b.now(),b.playbackUntil);
  b.deadline=start+30000;
  b.soloClock=b.isSolo&&!b.finished ? {slot:selected, startedAt:start, budgets:[30000,30000,30000,30000].map((v,i)=>b.sim.raid.acted.includes(i)?0:v)} : null;
}
function view(b) {
  const intent=b.sim.raid.intents.find(i=>!i.done);
  let intention=null;
  if(intent&&!b.finished){
    const native=require('./ruleset'), move=native.dex.moves.get(intent.move), area=['allAdjacent','allAdjacentFoes','all'].includes(move.target);
    const waits=b.sim.queue.list.filter(a=>a.raidWait&&alive(a.pokemon)).length;
    intention={id:intent.id,move:labels.moves[move.name]||move.name,area,target:area?null:native.target(b.sim)-1,remaining:Math.min(waits,intent.remaining)};
  }
  return {flowVersion:2,currentSlot:b.finished?-1:slot(b),intention};
}
function action(b,userId,data,expiredByServer=false) {
  const current=slot(b), p=b.sim.p1.active[data.slot];
  if(b.finished||data.token!==b.token||!expiredByServer&&b.now()>=b.deadline)throw Error('Cette action n’est plus disponible.');
  if(data.slot!==current||!alive(p)||b.models[current]?.ownerId!==userId)throw Error('Ce Pokémon n’a pas la main.');
  if(data.action==='presented'){
    // Only the current owner can shorten presentation grace, never extend it.
    if(b.playbackUntil>b.now()) {b.deadline-=b.playbackUntil-b.now();b.playbackUntil=b.now();if(b.soloClock)b.soloClock.startedAt=b.now();b.revision++;}
    return false;
  }
  if(data.action==='focus')return false;
  const sim=b.sim, index=sim.queue.list.findIndex(a=>a.raidWait&&a.pokemon===p);
  let chosen;
  if(data.action==='retreat'){
    if(data.confirm!==true)throw Error('Confirme le retrait définitif du raid.');
    chosen={choice:'move',pokemon:p,move:sim.dex.moves.get('splash'),raidRetreat:true};
  }else if(data.action==='pass'){
    if(!sim.queue.list.some(a=>a.raidWait&&a.pokemon.position===data.target&&alive(a.pokemon))||data.target===current)throw Error('Choisis un allié qui n’a pas encore joué.');
    chosen={choice:'move',pokemon:p,move:sim.dex.moves.get('splash'),raidPass:data.target};
  }else if(data.action==='attack'){
    const m=b.moves(current).find(m=>m.index===data.moveIndex);
    if(!m||m.disabled||m.pp<=0&&m.id!=='struggle')throw Error('Cette capacité est indisponible.');
    const targeted=['normal','any','adjacentAlly','adjacentAllyOrSelf','adjacentFoe'].includes(m.targetKind);
    if(targeted&&!m.targets.some(t=>t.loc===data.targetLoc))throw Error('Cible invalide.');
    sim.makeRequest('move');
    const side=sim.p1;
    side.choice.actions=Array.from({length:current},()=>({choice:'pass'}));
    if(!side.chooseMove(String(m.index+1),targeted?data.targetLoc:0))throw Error('Capacité indisponible : '+side.choice.error);
    chosen=side.choice.actions.at(-1);
  }else throw Error('Action inconnue.');
  b.events=[];sim.raid.events=[];
  b.pending[current]={action:data.action,moveIndex:data.moveIndex,target:data.target,targetLoc:data.targetLoc};
  sim.queue.list.splice(index,1,...(data.action==='attack' ? sim.queue.resolveAction(chosen) : [chosen]));
  if(data.action==='retreat'){
    // Retirement still consumes one allied action; its real HP/PP are retained.
    sim.queue.list=sim.queue.list.filter(a=>a.pokemon!==p);
    sim.raid.acted.push(current);
    b.retreat(current,data.reason||'retreat');
    for(const intent of sim.raid.intents)if(!intent.done)intent.remaining=Math.max(0,intent.remaining-1);
    if(!require('./ruleset').living(sim).length)sim.win('p2');
    cadence(sim);
  }
  const turn=sim.turn;
  if(!b.finished)sim.turnLoop();
  b.collect();
  if(!b.finished&&sim.turn!==turn){b.planBoss();prepare(b);b.collect();}
  b.token=randomUUID();b.revision++;
  b.playbackUntil=b.now()+b.playbackDuration();
  arm(b);
  return true;
}
function tick(b){
  if(b.finished||b.now()<b.deadline)return false;
  const current=slot(b);
  // Internal timeout path; never create a one-millisecond deadline which could
  // expire again during an OS pause. No client field can enable this override.
  action(b,b.models[current].ownerId,{token:b.token,slot:current,action:'retreat',confirm:true,reason:'timeout'},true);
  return true;
}
module.exports={initialize,turnLoop,view,action,tick};

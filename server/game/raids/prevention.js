// Observe native final damage modifiers; never reroll a connected hit or alter
// its formula. A shadow modifier excludes only the protections which ran.
const {Battle}=require('@pkmn/sim');
const {config}=require('./cooperation');
const contexts=new WeakMap(), forecasts=new WeakMap();
const own=p=>p?.side.n===0;
function owner(sim) {
 const effect=sim.effect.id,state=sim.effectState;
 if(['reflect','lightscreen','auroraveil'].includes(effect))return state.source;
 if(effect==='friendguard')return state.target;
 return null;
}
function chainModify(numerator,denominator=1) {
 const c=contexts.get(this),factor=Array.isArray(numerator)?numerator[0]/numerator[1]:numerator/denominator;
 if(c&&this.event.id==='ModifyDamage'&&this.event.target===c.source&&this.event.source===c.target){
  const p=owner(this);
  if(own(p)&&factor>0&&factor<1)c.parts.push({slot:p.position,effect:this.effect.id,weight:factor});
  else c.shadow=this.chain(c.shadow,Array.isArray(numerator)?numerator:[numerator,denominator]);
 }
 return Battle.prototype.chainModify.call(this,numerator,denominator);
}
function modify(value,numerator,denominator=1) {
 const result=Battle.prototype.modify.call(this,value,numerator,denominator),c=contexts.get(this);
 if(c&&this.event.id==='ModifyDamage'&&this.event.target===c.source&&this.event.source===c.target){
  c.counter=Battle.prototype.modify.call(this,value,c.shadow);c.actual=result;
 }else if(c&&c.counter!==undefined&&value===c.actual){
  c.counter=Battle.prototype.modify.call(this,c.counter,numerator,denominator);c.actual=result;
 }
 return result;
}
function modifyDamage(base,source,target,move,...rest) {
 const sim=this.battle,old=contexts.get(sim),c={source,target,shadow:1,parts:[]};
 if(!sim.raid?.threatProjection&&source.side.n===1&&own(target))contexts.set(sim,c);
 try{
  const damage=Object.getPrototypeOf(this).modifyDamage.call(this,base,source,target,move,...rest);
  if(contexts.get(sim)===c&&c.parts.length&&typeof damage==='number'&&c.counter!==undefined){
   // Native gen7 terminal minimum and 16-bit truncation, after any bypass.
   const counter=sim.trunc(c.counter||1,16);
   target.getMoveHitData(move).raidPrevention={counter,damage,parts:c.parts};
  }
  return damage;
 }finally{if(old)contexts.set(sim,old);else contexts.delete(sim);}
}
function award(sim,move,target,avoided,parts,gain) {
 if(sim.raid.threatProjection||!(avoided>0)||!parts.length)return;
 const a=config.aggro,r=sim.raid;
 if(r.preventionTurn!==sim.turn){r.preventionTurn=sim.turn;r.preventionUsed=0;}
 const raw=avoided/Math.max(1,target.maxhp)*a.preventionScale*a.preventionRatio;
 const amount=Math.max(0,Math.min(raw,a.preventionPerMoveCap-(move.raidPreventionUsed||0),a.preventionPerTurnCap-(r.preventionUsed||0)));
 if(!amount)return;
 move.raidPreventionUsed=(move.raidPreventionUsed||0)+amount;r.preventionUsed=(r.preventionUsed||0)+amount;
 // Allocate one avoided-HP budget between the reductions, never one full
 // counterfactual per screen. Native order and rounding remain authoritative.
 let product=1;const weights=parts.map(p=>{const weight=product*(1-p.weight);product*=p.weight;return{...p,weight};}),total=weights.reduce((n,p)=>n+p.weight,0);
 for(const p of weights){const actor=sim.p1.active[p.slot];if(actor)gain(sim,actor,amount*p.weight/total,'prevented');}
}
function connected(sim,target,source,move,before,actual,gain) {
 if(!sim.raid||sim.raid.threatProjection||!own(target)||source?.side.n!==1||move?.effectType!=='Move')return;
 const hit=target.getMoveHitData(move),record=hit.raidPrevention;delete hit.raidPrevention;
 if(!record||!(actual>0))return;
 const avoided=Math.max(0,Math.min(before,record.counter)-Math.min(before,record.damage));
 award(sim,move,target,avoided,record.parts,gain);
}
const guardIds=['protect','wideguard','quickguard','matblock','craftyshield','kingsshield','spikyshield','banefulbunker'];
function blocked(sim,target,source,move,protector,gain){
 if(sim.raid?.threatProjection||!own(target)||!own(protector)||source?.side.n!==1||move.category==='Status')return;
 let cache=forecasts.get(sim);if(!cache){cache=new WeakMap();forecasts.set(sim,cache);}
 let hp=cache.get(move);
 if(!hp){
  // No real roll exists for a fully blocked hit. Project the native attack on
  // an isolated copy once per move (all AoE targets share it). No live PP,
  // item, RNG, damage or status is changed by this counterfactual.
  const state=sim.toJSON();state.log=[];
  const shadow=require('./ruleset').restore(JSON.stringify(state));shadow.raid.threatProjection=true;
  shadow.effect=shadow.dex.conditions.get('');shadow.effectState={};
  for(const side of shadow.sides){for(const id of guardIds)delete side.sideConditions[id];for(const p of side.active)for(const id of guardIds)delete p.volatiles[id];}
  const targets=shadow.p1.active,previous=targets.map(p=>p.hp),attacker=shadow.p2.active[0],defender=targets[target.position];
  const nativeMove=shadow.dex.getActiveMove(move.id);nativeMove.priority=move.priority;
  shadow.actions.useMove(nativeMove,attacker,{target:defender});
  hp=targets.map((p,i)=>Math.max(0,previous[i]-p.hp));cache.set(move,hp);
 }
 award(sim,move,target,hp[target.position],[{slot:protector.position,effect:sim.effect.id,weight:0}],gain);
}
function guards(dex,gain){
 return Object.fromEntries(guardIds.map(id=>{
  const base=dex.moves.get(id),condition={...base.condition},original=condition.onTryHit;
  if(original)condition.onTryHit=function(target,source,move){const result=original.call(this,target,source,move);if(result===this.NOT_FAIL)blocked(this,target,source,move,this.effectState.source||this.effectState.target,gain);return result;};
  return[id,{inherit:true,condition}];
 }));
}
module.exports={chainModify,modify,modifyDamage,connected,guards};

// Pure in-memory matches: no production accounts or persistence.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const ai=require('../server/game/battle/humanTrainerAI'),legacy=require('../server/game/drift/colosseumAI');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const {getMaxMovePp,getUsableMoveIndexes}=require('../server/game/battle/battleResources');
const {createDeterministicRandom}=require('../server/game/abilities/abilityDex');
const squads=[
 [[6,['Flamethrower','Air Slash','Roost','Dragon Pulse']],[9,['Surf','Ice Beam','Toxic','Protect']],[3,['Giga Drain','Sludge Bomb','Sleep Powder','Synthesis']]],
 [[25,['Thunderbolt','Grass Knot','Quick Attack','Thunder Wave']],[112,['Earthquake','Rock Slide','Megahorn','Stealth Rock']],[130,['Waterfall','Ice Fang','Dragon Dance','Crunch']]],
 [[65,['Psychic','Shadow Ball','Focus Blast','Recover']],[68,['Close Combat','Stone Edge','Knock Off','Bullet Punch']],[212,['Bullet Punch','X-Scissor','Swords Dance','Roost']]],
 [[94,['Shadow Ball','Sludge Bomb','Thunderbolt','Will-O-Wisp']],[143,['Body Slam','Earthquake','Curse','Rest']],[350,['Surf','Ice Beam','Recover','Toxic']]]
];
const savedRandom=Math.random,defaultAction=DriftBattle.prototype.defaultAction;
const stats={human:{wins:0,draws:0,turns:0,switches:0,support:0},legacy:{wins:0,draws:0,turns:0,switches:0,support:0},random:{wins:0,draws:0,turns:0,switches:0,support:0}};
let matches=0,choices=0,totalMs=0,maxMs=0;
function team(spec,label,seed){return {pokemons:spec.map(([id,names],i)=>{const p=factory.create(id,50,true);p.uuid=`${label}:${seed}:${i}`;p.passiveAbility=null;p.heldItem=i===1?'leftovers':null;p.abilities=names;p.movePp=names.map(getMaxMovePp);return p;})};}
try{
 for(let matchup=0;matchup<squads.length;matchup++)for(let seed=1;seed<=4;seed++)for(const policy of Object.keys(stats)) {
  Math.random=createDeterministicRandom(`match:${matchup}:${seed}`);
  const a={userId:1,currentmap:'route2',equipe:team(squads[matchup],'player',seed),drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};
  const b={npc:true,equipe:team(squads[(matchup+1)%squads.length],'trainer',seed),drifts:[],equipped:[]};
  const stat=stats[policy];let winner;
  DriftBattle.prototype.defaultAction=function(p){
   if(p!==this.b)return defaultAction.call(this,p);
   let action;const begin=performance.now();
   if(policy==='human')action=defaultAction.call(this,p);
   else if(policy==='legacy')action=legacy.chooseAction({team:p.equipe.pokemons,opponent:this.active(0),field:this.state,ownSide:this.sides[1],enemySide:this.sides[0],wave:16,version:5,memory:this.aiMemory,round:this.round});
   else {const usable=getUsableMoveIndexes(this.active(1),this.state);action={action:'attack',number:usable.length?usable[Math.floor(Math.random()*usable.length)]:-1};}
   if(policy==='human'){const ms=performance.now()-begin;choices++;totalMs+=ms;maxMs=Math.max(maxMs,ms);}
   if(action.action==='change')stat.switches++;
   else if(engine.getMoveByName(this.active(1).abilities[action.number])?.combat.damage_class==='status')stat.support++;
   return action;
  };
  const battle=new DriftBattle(a,b,{type:'trainer',emit(){},now:()=>0,random:Math.random,paceMs:0,onFinish:(_b,w)=>{winner=w;}});
  for(let t=0;t<300&&!battle.finished;t++){
   // A competent opponent uses its known move coverage and public field, not the NPC's pending choice.
   const chosen=legacy.chooseAction({team:a.equipe.pokemons,opponent:battle.active(1),field:battle.state,ownSide:battle.sides[0],enemySide:battle.sides[1],wave:16,version:5,memory:{seen:{}},round:battle.round});
   const accepted=battle.action(a,{...chosen,turnId:battle.token});
   if(!accepted)battle.action(a,{...defaultAction.call(battle,a),turnId:battle.token});
   battle.tick();
  }
  assert(battle.finished,`Stalled ${policy} matchup ${matchup} seed ${seed}`);
  if(winner===b)stat.wins++;if(!winner)stat.draws++;stat.turns+=battle.round;matches++;
  assert(battle.originals.every(p=>Number.isFinite(p.currentHp)&&p.currentHp<=p.maxHp));
 }
 assert(stats.human.wins>=stats.random.wins,'Human AI should outperform random choices on the fixed varied sample');
 assert(stats.human.support>0&&stats.human.switches>0,'Tactical variety must occur in actual battles');
 console.log(JSON.stringify({matches,perPolicy:16,stats,choices,averageDecisionMs:totalMs/choices,maxDecisionMs:maxMs}));
}finally{Math.random=savedRandom;DriftBattle.prototype.defaultAction=defaultAction;}

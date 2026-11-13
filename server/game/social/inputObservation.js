// Passive, account-local observations. Never affects combat, fishing or movement.
const WINDOW_MS=20*60*1000,MIN_SPAN=120000,CONFIRM_MS=20000;
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
function rhythm(values,min=12){
 if(values.length<min)return false;
 const m=median(values),mad=median(values.map(v=>Math.abs(v-m))),tolerance=Math.max(4,m*.012);
 return m>=1&&m<=5000&&mad<=Math.max(2.5,m*.006)&&values.filter(v=>Math.abs(v-m)<=tolerance).length/values.length>=.94;
}
class InputObservation {
 constructor(saved={},now=Date.now){this.now=now;this.commands=[];this.reactions=[];this.windows=[];this.candidateAt=null;this.lastSequence=0;this.lastPacketAt=0;this.firstCommandAt=Number.isFinite(saved.firstCommandAt)?Math.max(now()-WINDOW_MS,saved.firstCommandAt):null;
  const time=now();for(const [key,limit]of[['commands',160],['reactions',24],['windows',12]])if(Array.isArray(saved[key]))this[key]=saved[key].filter(v=>Number.isFinite(v.at)&&v.at<=time&&v.at>=time-WINDOW_MS).slice(-limit);
 }
 prune(){const min=this.now()-WINDOW_MS;for(const key of['commands','reactions','windows'])this[key]=this[key].filter(v=>v.at>=min);}
 command(kind){if(typeof kind!=='string'||kind.length>40)return;const time=this.now();if(!this.commands.length||this.firstCommandAt==null||time-this.commands.at(-1).at>120000)this.firstCommandAt=time;this.commands.push({at:time,kind});this.commands=this.commands.slice(-160);}
 fishing({reactionMs,outcome}){if(outcome!=='hooked'||!Number.isFinite(reactionMs)||reactionMs<0||reactionMs>2000)return;this.reactions.push({at:this.now(),ms:reactionMs});this.reactions=this.reactions.slice(-24);}
 telemetry(d){
  const time=this.now();
  if(!d||d.version!==1||!Number.isSafeInteger(d.sequence)||d.sequence<=this.lastSequence||d.sequence>1e9||time-this.lastPacketAt<1500||!Array.isArray(d.intervals)||d.intervals.length>64||d.intervals.some(v=>!Number.isFinite(v)||v<1||v>30000))return false;
  if(!Number.isInteger(d.count)||d.count<1||d.count>128||!Number.isInteger(d.untrusted)||d.untrusted<0||d.untrusted>d.count||typeof d.assisted!=='boolean'||typeof d.mobile!=='boolean')return false;
  this.lastSequence=d.sequence;this.lastPacketAt=time;
  // A native hold, controller-generated click or touch device is not automation evidence.
  if(d.mobile||d.assisted)return true;
  this.windows.push({at:time,count:d.count,samples:d.intervals.length,stable:rhythm(d.intervals),synthetic:d.untrusted/d.count>=.9});this.windows=this.windows.slice(-12);return true;
 }
 evaluate(){
  this.prune();const time=this.now(),commands=this.commands,intervals=[];
  for(let i=1;i<commands.length;i++){const delta=commands[i].at-commands[i-1].at;if(delta>=30&&delta<=5000)intervals.push(delta);}
  const stableInput=this.windows.length>=6&&this.windows.reduce((n,w)=>n+w.samples,0)>=160&&this.windows.filter(w=>w.stable).length/this.windows.length>=.85;
  const sustainedBurst=commands.length>=120&&(commands.at(-1).at-commands[0].at)/(commands.length-1)<30;
  const regularCommands=rhythm(intervals,48)||sustainedBurst,latest=this.reactions.slice(-12),fastFishing=latest.length===12&&latest.filter(r=>r.ms<100).length>=10&&median(latest.map(r=>Math.abs(r.ms-median(latest.map(x=>x.ms)))))<20;
  const counts=new Map();for(const c of commands)counts.set(c.kind,(counts.get(c.kind)||0)+1);
  const repeated=commands.length>=80&&(Math.max(...counts.values())/commands.length>=.85||counts.size<=3);
  const synthetic=this.windows.length>=6&&this.windows.filter(w=>w.synthetic).length/this.windows.length>=.9;
  const score=Math.min(100,35*Number(stableInput)+35*Number(regularCommands)+35*Number(fastFishing)+15*Number(repeated)+10*Number(synthetic));
  const enough=commands.length>=80&&this.firstCommandAt!=null&&time-this.firstCommandAt>=MIN_SPAN&&time-commands.at(-1).at<=10000;
  const signals={stableInput,regularCommands,fastFishing,repeated,synthetic};
  const qualifies=enough&&score>=85&&(regularCommands||fastFishing)&&Object.values(signals).filter(Boolean).length>=3;
  if(!qualifies)this.candidateAt=null;else this.candidateAt??=time;
  return {score,signals,qualifies,highConfidence:qualifies&&time-this.candidateAt>=CONFIRM_MS,observedAt:time};
 }
 snapshot(){this.prune();return{version:1,observedAt:this.now(),firstCommandAt:this.firstCommandAt,commands:this.commands.map(v=>({...v})),reactions:this.reactions.map(v=>({...v})),windows:this.windows.map(v=>({...v}))};}
}
function desktopAgent(agent){return typeof agent==='string'&&agent.length>0&&agent.length<1000&&!/Android|iPhone|iPad|iPod|Mobile/i.test(agent);}
module.exports={InputObservation,desktopAgent,rhythm,WINDOW_MS,MIN_SPAN,CONFIRM_MS};

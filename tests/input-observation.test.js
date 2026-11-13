const test=require('node:test'),assert=require('node:assert/strict');
const {InputObservation,desktopAgent}=require('../server/game/social/inputObservation');
function pattern({regular=true,client=true,synthetic=false,fish=false,seconds=160}={}){
 let time=10000,seed=7,sequence=0;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296),m=new InputObservation({},()=>time);
 for(let i=0;i<seconds*5;i++){time+=regular?200:70+Math.floor(random()*320);m.command(i%7?'battle:attack:0':'world:action');
  if(client&&i%10===9)m.telemetry({version:1,sequence:++sequence,intervals:Array.from({length:20},()=>regular?200:90+Math.floor(random()*300)),count:20,untrusted:synthetic?20:0,mobile:false,assisted:false});
  if(fish&&i%20===0)m.fishing({reactionMs:regular?40:180+random()*600,outcome:'hooked'});
  m.evaluate();
 }return{m,time,setTime:value=>{time=value;}};
}
test('desktop browser and Electron qualify as PC; phone UAs are excluded without using screen size',()=>{
 for(const a of['Mozilla/5.0 Windows NT 10 Chrome/145','Mozilla/5.0 MacIntel Electron/40','Mozilla/5.0 Linux Firefox/145'])assert(desktopAgent(a));
 for(const a of[undefined,'x'.repeat(1001),'Mozilla Android Mobile','Mozilla iPhone','Mozilla iPad'])assert(!desktopAgent(a));
});
test('sustained native-like automation requires multiple signals, two minutes and an extra confirmation interval',()=>{
 const short=pattern({seconds:100}).m.evaluate();assert(!short.highConfidence);
 const f=pattern();const r=f.m.evaluate();assert(r.highConfidence);assert(r.signals.stableInput&&r.signals.regularCommands&&r.signals.repeated);assert(!r.signals.synthetic);assert(r.score>=85);
 f.setTime(f.time+11000);assert(!f.m.evaluate().highConfidence,'stale activity cannot produce a fresh alert');
});
test('irregular manual play, synthetic events alone and fast fishing alone never establish high confidence',()=>{
 assert(!pattern({regular:false,synthetic:true,fish:true}).m.evaluate().highConfidence);
 assert(!pattern({regular:true,client:false}).m.evaluate().highConfidence);
 const m=new InputObservation({},()=>500000);for(let i=0;i<24;i++)m.fishing({reactionMs:10,outcome:'hooked'});assert(!m.evaluate().highConfidence);
});
test('server-only regular actions and repeated superhuman valid reels can corroborate each other',()=>{
 const r=pattern({client:false,fish:true,seconds:180}).m.evaluate();assert(r.highConfidence);assert(r.signals.fastFishing&&r.signals.regularCommands);assert(!r.signals.stableInput);
});
test('malformed, replayed, too-fast and score/target-injected telemetry cannot impose a verdict',()=>{
 let time=10000;const m=new InputObservation({},()=>time),valid={version:1,sequence:1,intervals:Array(20).fill(200),count:20,untrusted:20,mobile:false,assisted:false};
 for(const bad of[null,{}, {...valid,intervals:Array(65).fill(200)},{...valid,intervals:[NaN]},{...valid,intervals:[-1]},{...valid,count:0},{...valid,untrusted:21},{...valid,sequence:Infinity},{...valid,mobile:'false'}])assert(!m.telemetry(bad));
 assert(m.telemetry({...valid,score:1000,highConfidence:true,targetId:4}));assert(!m.telemetry(valid));assert(!m.telemetry({...valid,sequence:2}));time+=2000;assert(m.telemetry({...valid,sequence:2}));assert(!m.evaluate().highConfidence);
});
test('touch and controller summaries are not used as synthetic or regularity evidence',()=>{
 let time=10000;for(const flag of['mobile','assisted']){const m=new InputObservation({},()=>time);for(let i=1;i<20;i++){time+=2000;assert(m.telemetry({version:1,sequence:i,intervals:Array(20).fill(100),count:20,untrusted:20,mobile:false,assisted:false,[flag]:true}));}assert.equal(m.windows.length,0);}
});
test('reconnection retains bounded observations but requires a new confirmation; stale samples decay',()=>{
 const f=pattern(),snapshot=f.m.snapshot();assert(snapshot.commands.length<=160&&snapshot.windows.length<=12&&snapshot.reactions.length<=24);const re=new InputObservation(snapshot,()=>f.time);assert(re.evaluate().qualifies);assert(!re.evaluate().highConfidence);
 const stale=new InputObservation(snapshot,()=>f.time+21*60000);assert.equal(stale.commands.length,0);assert(!stale.evaluate().qualifies);
});
test('fishing observer sees one genuine server reaction and an observer failure cannot alter catching',async()=>{
 const {createFishingController}=require('../server/game/world/fishingController');let time=10000,id=0;const jobs=new Map(),seen=[],p={x:16,y:16,currentmap:'start'};
 const c=createFishingController({ownsRod:()=>true,available:()=>true,emit(){},onHook(){},nearWater:()=>({x:48,y:16,direction:'right'}),now:()=>time,random:()=>0,setTimer:(fn,ms)=>{jobs.set(++id,{fn,ms});return id;},clearTimer:n=>jobs.delete(n),observeReel:(_p,data)=>{seen.push(data);throw Error('observer unavailable');}});
 await c.offer(p);const cast=c.current(p).id;assert(!c.reel(p,'forged'));c.start(p,cast);
 for(let i=0;i<2;i++){const [key,job]=jobs.entries().next().value;jobs.delete(key);time+=job.ms;job.fn();}time+=45;assert(c.reel(p,cast));assert(!c.reel(p,cast));assert.deepEqual(seen,[{reactionMs:45,outcome:'hooked'}]);c.stop();
});
test('client batches only gameplay activations; native repeat, text entry, touch and controller clicks are excluded',async()=>{
 const {observeActionRhythm}=await import('../vue-explorakit/src/services/actionObservation.js');let time=0,flush;const listeners=new Map(),sent=[];
 const win={addEventListener:(e,fn)=>listeners.set(e,fn),removeEventListener:e=>listeners.delete(e)},doc={hidden:false,addEventListener:(e,fn)=>listeners.set(e,fn),removeEventListener:e=>listeners.delete(e)};
 const socket={connected:true,on(){},off(){},emit:(...a)=>sent.push(a)},nav={userAgent:'Windows Chrome',getGamepads:()=>[]},target={nodeType:1,closest:s=>s.includes('input,')?null:{}};
 const service=observeActionRhythm(socket,{root:{contains:()=>true},win,doc,nav,clock:()=>time,setTimer:fn=>{flush=fn;return 1;},clearTimer(){}});
 const key={type:'keydown',target,code:'Space',isTrusted:true};for(let i=0;i<20;i++){time+=200;listeners.get('keydown')(key);listeners.get('click')({type:'click',target,isTrusted:false});}flush();assert.equal(sent.length,1);assert.equal(sent[0][1].count,20);assert.equal(sent[0][1].untrusted,0);
 listeners.get('keydown')({...key,repeat:true});flush();assert.equal(sent.length,1);
 nav.userAgent='iPhone';listeners.get('click')({type:'click',target,isTrusted:true});flush();assert.equal(sent.length,1);
 nav.userAgent='Windows';nav.getGamepads=()=>[{connected:true}];time+=1000;listeners.get('click')({type:'click',target,isTrusted:false});flush();assert.equal(sent.length,1);service.stop();assert.equal(listeners.size,0);
});

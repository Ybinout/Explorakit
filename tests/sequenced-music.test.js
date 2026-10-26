const test=require('node:test'),assert=require('node:assert/strict');
const moduleMusic=()=>import('../vue-explorakit/src/services/sequencedMusic.js');
function context(){
 const sources=[],gains=[];const c={state:'suspended',currentTime:100,destination:{},sources,gains,
  resume(){this.state='running';return Promise.resolve();},close(){this.state='closed';return Promise.resolve();},
  createGain(){const events=[],gain={events,value:0,setValueAtTime(...a){events.push(['set',...a]);},linearRampToValueAtTime(...a){events.push(['ramp',...a]);}};const n={gain,connect(){},disconnect(){this.disconnected=true;}};gains.push(n);return n;},
  createBufferSource(){const n={connect(){},disconnect(){this.disconnected=true;},start(...a){this.startAt=a;},stop(){this.stopped=true;}};sources.push(n);return n;},
  decodeAudioData(bytes){return Promise.resolve({duration:bytes[0]===1?10:20});}
 };return c;
}
async function fixture(fetchAudio){const {SequencedMusic}=await moduleMusic(),c=context(),requests=[];
 const player=new SequencedMusic({intro:'intro',loop:'loop'},{createContext:()=>c,fetchAudio:fetchAudio||((url)=>{requests.push(url);return Promise.resolve({ok:true,arrayBuffer:async()=>[url==='intro'?1:2]});})});
 return{player,c,requests};
}
test('intro and looping source are scheduled together with an exact non-silent overlap',async()=>{
 const {player,c}=await fixture();await player.play();assert.equal(c.sources.length,2);
 const [intro,loop]=c.sources;assert.equal(intro.startAt[0],100.01);assert.equal(intro.startAt[1],0);assert.equal(intro.startAt[2],9.98);
 const end=intro.startAt[0]+intro.startAt[2];assert(Math.abs(end-loop.startAt[0]-.008)<1e-12);
 assert(loop.loop);assert.equal(loop.loopStart,.02);assert.equal(loop.loopEnd,20);assert.equal(loop.startAt[1],.02);
 const output=c.gains[0],fadeIn=c.gains[2];assert.deepEqual(fadeIn.gain.events.at(-1),['ramp',1,end]);assert(!output.disconnected);
 player.dispose();
});
test('turn updates never recreate the sequence or reload decoded music',async()=>{
 const {player,c,requests}=await fixture();await player.prepare();await player.play();const first=c.sources[0];
 for(let i=0;i<50;i++){player.volume=.14;await player.play();}
 assert.deepEqual(requests,['intro','loop']);assert.equal(c.sources.length,2);assert.equal(c.sources[0],first);assert(!player.paused);assert.equal(player.volume,.14);player.dispose();
});
test('pause during intro resumes its exact offset and remaining join schedule',async()=>{
 const {player,c}=await fixture();await player.play();c.currentTime=103.01;player.pause();assert(Math.abs(player.currentTime-3)<1e-10);assert(c.sources.every(s=>s.stopped&&s.disconnected));
 c.currentTime=130;await player.play();const intro=c.sources[2],loop=c.sources[3];assert(Math.abs(intro.startAt[1]-3)<1e-10);assert(Math.abs(intro.startAt[0]+intro.startAt[2]-loop.startAt[0]-.008)<1e-10);player.dispose();
});
test('resume after intro returns to the loop position without repeating the intro',async()=>{
 const {player,c}=await fixture();await player.play();c.currentTime=145.01;player.pause();const position=player.currentTime;c.currentTime=190;await player.play();assert.equal(c.sources.length,3);const loop=c.sources[2];assert(loop.loop);assert(Math.abs(loop.startAt[1]-(.02+(position-9.972)%19.98))<1e-9);assert.equal(loop.startAt[0],190.01);player.dispose();
});
test('a pause or disposal during a delayed download cannot start music later',async()=>{
 for(const dispose of [false,true]){const responses=[];const {player,c}=await fixture(url=>new Promise(resolve=>responses.push(()=>resolve({ok:true,arrayBuffer:async()=>[url==='intro'?1:2]}))));
  const pending=player.play();if(dispose)player.dispose();else player.pause();for(const respond of responses)respond();await pending.catch(()=>{});assert.equal(c.sources.length,0);assert(player.paused);if(dispose){assert.equal(player.buffers,null);assert.equal(c.state,'closed');assert(player.abort.signal.aborted);}else player.dispose();
 }
});
test('download and autoplay refusals are retryable and cannot leave a false playing state',async()=>{
 let blocked=true;const {player,c}=await fixture(async url=>({ok:!blocked,arrayBuffer:async()=>[url==='intro'?1:2]}));await assert.rejects(player.play());assert(player.paused);assert.equal(c.sources.length,0);blocked=false;await player.play();assert.equal(c.sources.length,2);player.pause();c.resume=()=>Promise.reject(new Error('Gesture required'));c.state='suspended';await assert.rejects(player.play());assert(player.paused);assert.equal(c.sources.length,2);c.resume=()=>{c.state='running';return Promise.resolve();};await player.play();assert.equal(c.sources.length,4);player.dispose();
});
test('mute pause and final stop preserve then reset the cursor; disposal releases buffers',async()=>{
 const {player,c}=await fixture();await player.play();c.currentTime=105.01;player.volume=0;player.pause();assert(Math.abs(player.currentTime-5)<1e-10);c.currentTime=120;player.volume=.4;await player.play();assert(Math.abs(c.sources[2].startAt[1]-5)<1e-10);player.pause();player.currentTime=0;await player.play();assert.equal(c.sources.at(-2).startAt[1],0);player.dispose();assert.equal(player.buffers,null);assert.equal(c.state,'closed');assert(c.gains.every(g=>g.disconnected));
});

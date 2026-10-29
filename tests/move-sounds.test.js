const test=require('node:test'),assert=require('node:assert/strict');

test('impact weight follows maximum HP fraction with exact light/medium/heavy boundaries',async()=>{
 const {damageImpactStrength:strength}=await import('../vue-explorakit/src/services/moveSounds.js');
 for(const scale of [1,10,100]){
  assert.equal(strength(1*scale,100*scale),'light');
  assert.equal(strength(19*scale,100*scale),'light');
  assert.equal(strength(20*scale,100*scale),'medium');
  assert.equal(strength(49*scale,100*scale),'medium');
  assert.equal(strength(50*scale,100*scale),'heavy');
  assert.equal(strength(100*scale,100*scale),'heavy');
 }
 for(const [damage,maxHp] of [[0,100],[-1,100],[1,0],[1,-1],[NaN,100],[Infinity,100],[1,Infinity],[undefined,100],['20',100]])assert.equal(strength(damage,maxHp),null);
});

test('only three short neutral impacts exist, independent of move family, type, critical and multihit labels',async()=>{
 const {damageImpactPlan:plan}=await import('../vue-explorakit/src/services/moveSounds.js');
 const profiles=[1,20,50].map(damage=>plan({damage,maxHp:100}));
 assert.equal(new Set(profiles.map(p=>JSON.stringify(p))).size,3);
 for(const damage of [1,20,50])for(const moveName of ['Crunch','Ice Beam','Earthquake','Protect'])assert.deepEqual(plan({damage,maxHp:100,moveName,moveType:'Fire',critical:true,hits:5}),plan({damage,maxHp:100}));
 for(const voices of profiles){assert.equal(voices.length,2);for(const v of voices){assert(v.duration>0&&v.duration<=.25);assert(v.volume>0&&v.volume<=.4);assert(v.frequency>0&&v.endFrequency>0);assert(!v.delay);}}
 assert.deepEqual(plan(),[]);assert.deepEqual(plan({damage:0,maxHp:100}),[]);
});

test('fast damage frames bound Web Audio voices and disconnect every source when stopped',async()=>{
 const {BattleAudio}=await import('../vue-explorakit/src/services/battleAudio.js');let disconnected=0;
 const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}),node=()=>({connect(){},disconnect(){disconnected++;},gain:param(),frequency:param(),Q:param()});
 const context={state:'running',currentTime:0,sampleRate:100,destination:{},createGain:node,createOscillator:()=>({...node(),start(){},stop(){}}),createBufferSource:()=>({...node(),start(){},stop(){}}),createBiquadFilter:node,createBuffer:()=>({getChannelData:()=>new Float32Array(100)}),close:async()=>{}};
 const audio=new BattleAudio(()=>context);audio.setVolume(1);await audio.unlock();
 for(let i=0;i<100;i++){audio.impact({damage:60,maxHp:100});assert(audio.voices.size<=48);}
 audio.stop();assert.equal(audio.voices.size,0);assert.equal(disconnected,500);audio.dispose();
});

test('world confirmations distinguish PC/healing and restoration ignores reloads/reorders/level gains',async()=>{
 const {GameFeedbackAudio,teamWasRestored}=await import('../vue-explorakit/src/services/gameFeedbackAudio.js');
 const audio=new GameFeedbackAudio(()=>null),notes=[];audio.ready=()=>true;audio.tone=(frequency,duration,options)=>notes.push({frequency,duration,...options});
 audio.play('pc');const pc=notes.splice(0);audio.play('heal');const heal=notes.splice(0);assert(pc.length>0&&heal.length>0);assert.notDeepEqual(pc,heal);
 const p={uuid:'one',currentHp:10,maxHp:100,status:null,abilities:['Tackle'],movePp:[10]};
 assert(!teamWasRestored([],[p]));assert(!teamWasRestored([p],[{...p}]));assert(!teamWasRestored([p],[{...p,uuid:'new'}]));
 assert(teamWasRestored([p],[{...p,currentHp:30}]));assert(teamWasRestored([{...p,status:'poison'}],[p]));assert(teamWasRestored([p],[{...p,movePp:[35]}]));
 assert(!teamWasRestored([p],[{...p,currentHp:15,maxHp:105}]));assert(!teamWasRestored([p],[{...p,abilities:['Surf'],movePp:[20]}]));
 audio.ready=()=>false;audio.play('pc');assert.equal(notes.length,0);
});

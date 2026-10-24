const test=require('node:test'),assert=require('node:assert/strict');
const service=()=>import('../vue-explorakit/src/services/worldMusic.js');
async function fixture(){const {WorldMusic}=await service(),audios=[];const music=new WorldMusic({village:'village.mp3',route:'start.mp3',cave:'cave.mp3',snow:'snow.mp3'},src=>{const a={src,paused:true,currentTime:0,plays:0,pauses:0,loads:0,play(){this.plays++;this.paused=false;return Promise.resolve();},pause(){this.paused=true;this.pauses++;},removeAttribute(){this.src='';},load(){this.loads++;}};audios.push(a);return a;});return{music,audios};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('exploration tracks cover every village, normal/generated routes and interiors, including caves and snowy Blanchecime',async()=>{const{worldMusicTrack}=await service();for(const m of ['start','ville1','ville_safe1','ville3','ville4','gen_ville5','centre','maison','etage2','ville_safe1_arene','gen_arene5','gen_maison2','route2_maison'])assert.equal(worldMusicTrack(m),'village',m);for(const m of ['route1','route14','gen_route6','gen_route7','gen_shop_route10','pk1'])assert.equal(worldMusicTrack(m),'route',m);for(const m of ['ville5','ville5_shop','ville5_arene'])assert.equal(worldMusicTrack(m),'snow',m);for(const m of ['cave1','cave2','cave_rochebrume3','cave_ice'])assert.equal(worldMusicTrack(m),'cave',m);for(const m of [null,undefined,'unknown'])assert.equal(worldMusicTrack(m),null);});
test('route-to-route and town-to-interior transitions preserve the same audio and advancing playhead',async()=>{const{music,audios}=await fixture();music.update({map:'route1',active:true,volume:.35});await tick();const a=audios[0];a.currentTime=31;for(const map of ['route2','route3','gen_route6','route13','route14'])music.update({map,active:true,volume:.35});assert.equal(audios.length,1);assert.equal(a.plays,1);assert.equal(a.currentTime,31);assert.equal(a.paused,false);assert.equal(a.loop,true);assert(Math.abs(a.volume-.077)<1e-8);music.update({map:'ville5',active:true,volume:.35});await tick();const b=audios[1];b.currentTime=12;music.update({map:'ville5_shop',active:true,volume:.35});assert.equal(b.plays,1);assert.equal(b.currentTime,12);assert(a.paused);music.update({map:'route14',active:true,volume:.35});await tick();assert.equal(audios.length,2);assert.equal(a.currentTime,31);assert(!a.paused);assert(b.paused);});
test('battle, results, offline, hidden and mute pause without resetting; changes of volume resume quietly',async()=>{const{music,audios}=await fixture();const state={map:'route1',active:true,volume:.35};music.update(state);await tick();const a=audios[0];a.currentTime=8;for(const patch of [{active:false},{volume:0},{map:'cave1'}]){music.update({...state,...patch});assert(a.paused);assert.equal(a.currentTime,8);music.update(state);await tick();assert(!a.paused);assert.equal(a.currentTime,8);}music.update({...state,volume:1});assert.equal(a.volume,.22);music.update({...state,volume:Infinity});assert.equal(a.volume,.22);music.update({...state,volume:NaN});assert(a.paused);});
test('refused autoplay retries on interaction, concurrent gestures do not stack plays, stale promises never restart old tracks',async()=>{const{music,audios}=await fixture();music.update({map:'route1',active:true,volume:.35});await tick();const a=audios[0];a.pause();a.play=function(){this.plays++;return Promise.reject(Error('NotAllowedError'));};music.sync();music.sync();await tick();assert.equal(a.plays,2);a.play=function(){this.plays++;this.paused=false;return Promise.resolve();};music.sync();await tick();assert(!a.paused);a.pause();let resolve;a.play=function(){this.plays++;return new Promise(r=>resolve=r);};music.sync();music.update({map:'ville1',active:true,volume:.35});a.paused=false;resolve();await tick();assert(a.paused);assert(!audios[1].paused);music.destroy();assert(audios.every(a=>a.paused&&a.src===''&&a.loads===1));music.sync();music.update({map:'route1',active:true,volume:1});assert.equal(music.tracks.size,0);});

test('cave rooms and snowy town interiors preserve their playhead across transitions and battle pauses',async()=>{
 const{music,audios}=await fixture();
 music.update({map:'cave1',active:true,volume:.35});await tick();const cave=audios[0];cave.currentTime=22;
 for(const map of ['cave2','cave_rochebrume1','cave_rochebrume3','cave_ice'])music.update({map,active:true,volume:.35});
 assert.equal(audios.length,1);assert.equal(cave.currentTime,22);assert.equal(cave.plays,1);
 music.update({map:'ville5',active:true,volume:.35});await tick();const snow=audios[1];snow.currentTime=13;
 music.update({map:'ville5_shop',active:true,volume:.35});assert.equal(snow.currentTime,13);assert.equal(snow.plays,1);assert(cave.paused);
 music.update({map:'ville5_arene',active:false,volume:.35});assert(snow.paused);
 music.update({map:'ville5',active:true,volume:.35});await tick();assert.equal(snow.currentTime,13);assert(!snow.paused);
 music.update({map:'cave2',active:true,volume:.35});await tick();assert.equal(cave.currentTime,22);assert(!cave.paused);assert(snow.paused);
 music.destroy();
});
test('dedicated champion battle tracks stay stable and cannot override wild, trainer, PvP or Colosseum music',async()=>{
 const{battleMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 for(const[map,track]of [['gen_arene5','raph'],['ville3_arene','ana'],['ville4_arene','wanda'],['ville5_arene','7p']]){
  assert.equal(battleMusicTrack('arena',map),track);
  for(const kind of ['wild','trainer','pvp','colosseum'])assert.equal(battleMusicTrack(kind,map),kind);
 }
 for(const map of ['ville1_arene','ville_safe1_arene','__proto__',null])assert.equal(battleMusicTrack('arena',map),'arena');
});

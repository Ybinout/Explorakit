const test=require('node:test'),assert=require('node:assert/strict');
const service=()=>import('../vue-explorakit/src/services/worldMusic.js');
async function fixture(){const {WorldMusic}=await service(),audios=[];const music=new WorldMusic({'gwenn-room':'gwenn-entrance.mp3','mounir-room':'mounir-arene.mp3','hoze-room':'hoze-arene.mp3',center:'center.mp3',village:'village.mp3',route:'start.mp3',cave:'cave.mp3',snow:'snow.mp3','wanda-room':'areneWanda.mp3','sevenp-room':'arene7p.mp3','raph-room':'areneraph.mp3','ana-room':'ana_arene.mp3','lucie-room':'lucie-maison.mp3'},src=>{const a={src,paused:true,currentTime:0,plays:0,pauses:0,loads:0,play(){this.plays++;this.paused=false;return Promise.resolve();},pause(){this.paused=true;this.pauses++;},removeAttribute(){this.src='';},load(){this.loads++;}};audios.push(a);return a;});return{music,audios};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('every Center has its own soft looping theme, paused on exit and restarted on return',async()=>{
 const {worldMusicTrack}=await service();assert.equal(worldMusicTrack('centre'),'center');
 const {music,audios}=await fixture();
 for(const outside of ['ville1','route4','gen_ville5','ville3','ville4','ville5','ville_commerciale']){
  music.update({map:outside,active:true,volume:.5});await tick();
  music.update({map:'centre',active:true,volume:.5});await tick();
  const center=music.tracks.get('center');assert(center&&!center.paused&&center.loop);
  assert.equal(center.currentTime,0);assert.equal(center.volume,.11);center.currentTime=18;
  music.update({map:'centre',active:false,volume:.5});assert(center.paused);
  music.update({map:'centre',active:true,volume:.5});await tick();assert.equal(center.currentTime,18);
  music.update({map:outside,active:true,volume:.5});await tick();assert(center.paused);
  assert.equal(audios.filter(a=>!a.paused).length,1);
 }
 music.destroy();
});
test('exploration tracks cover every village, normal/generated routes and interiors, including caves and snowy Blanchecime',async()=>{const{worldMusicTrack}=await service();for(const m of ['start','ville1','ville_safe1','ville3','ville4','gen_ville5','maison','etage2','gen_maison2'])assert.equal(worldMusicTrack(m),'village',m);for(const m of ['route1','gen_route6','gen_route7','gen_shop_route10','pk1'])assert.equal(worldMusicTrack(m),'route',m);for(const m of ['ville5','ville5_shop','route13','route14'])assert.equal(worldMusicTrack(m),'snow',m);for(const m of ['cave1','cave2','cave_rochebrume3','cave_ice'])assert.equal(worldMusicTrack(m),'cave',m);for(const m of [null,undefined,'unknown'])assert.equal(worldMusicTrack(m),null);});
test('route-to-route and town-to-interior transitions preserve the same audio and advancing playhead',async()=>{const{music,audios}=await fixture();music.update({map:'route1',active:true,volume:.35});await tick();const a=audios[0];a.currentTime=31;for(const map of ['route2','route3','gen_route6'])music.update({map,active:true,volume:.35});assert.equal(audios.length,1);assert.equal(a.plays,1);assert.equal(a.currentTime,31);assert.equal(a.paused,false);assert.equal(a.loop,true);assert(Math.abs(a.volume-.049)<1e-8);music.update({map:'ville5',active:true,volume:.35});await tick();const b=audios[1];b.currentTime=12;music.update({map:'ville5_shop',active:true,volume:.35});assert.equal(b.plays,1);assert.equal(b.currentTime,12);assert(a.paused);music.update({map:'route1',active:true,volume:.35});await tick();assert.equal(audios.length,2);assert.equal(a.currentTime,0);assert(!a.paused);assert(b.paused);});
test('battle, results, offline, hidden and mute pause without resetting; changes of volume resume quietly',async()=>{const{music,audios}=await fixture();const state={map:'route1',active:true,volume:.35};music.update(state);await tick();const a=audios[0];a.currentTime=8;for(const patch of [{active:false},{volume:0}]){music.update({...state,...patch});assert(a.paused);assert.equal(a.currentTime,8);music.update(state);await tick();assert(!a.paused);assert.equal(a.currentTime,8);}music.update({...state,volume:1});assert.equal(a.volume,.14);music.update({...state,volume:Infinity});assert.equal(a.volume,.14);music.update({...state,volume:NaN});assert(a.paused);});
test('refused autoplay retries on interaction, concurrent gestures do not stack plays, stale promises never restart old tracks',async()=>{const{music,audios}=await fixture();music.update({map:'route1',active:true,volume:.35});await tick();const a=audios[0];a.pause();a.play=function(){this.plays++;return Promise.reject(Error('NotAllowedError'));};music.sync();music.sync();await tick();assert.equal(a.plays,2);a.play=function(){this.plays++;this.paused=false;return Promise.resolve();};music.sync();await tick();assert(!a.paused);a.pause();let resolve;a.play=function(){this.plays++;return new Promise(r=>resolve=r);};music.sync();music.update({map:'ville1',active:true,volume:.35});a.paused=false;resolve();await tick();assert(a.paused);assert(!audios[1].paused);music.destroy();assert(audios.every(a=>a.paused&&a.src===''&&a.loads===1));music.sync();music.update({map:'route1',active:true,volume:1});assert.equal(music.tracks.size,0);});

test('cave rooms and snowy town interiors preserve their playhead across transitions and battle pauses',async()=>{
 const{music,audios}=await fixture();
 music.update({map:'cave1',active:true,volume:.35});await tick();const cave=audios[0];cave.currentTime=22;
 for(const map of ['cave2','cave_rochebrume1','cave_rochebrume3','cave_ice'])music.update({map,active:true,volume:.35});
 assert.equal(audios.length,1);assert.equal(cave.currentTime,22);assert.equal(cave.plays,1);
 music.update({map:'ville5',active:true,volume:.35});await tick();const snow=audios[1];snow.currentTime=13;
 for(const map of ['route13','route14','ville5','ville5_shop']) music.update({map,active:true,volume:.35});assert.equal(snow.currentTime,13);assert.equal(snow.plays,1);assert(cave.paused);
 music.update({map:'ville5_shop',active:false,volume:.35});assert(snow.paused);
 music.update({map:'ville5',active:true,volume:.35});await tick();assert.equal(snow.currentTime,13);assert(!snow.paused);
 music.update({map:'cave2',active:true,volume:.35});await tick();assert.equal(cave.currentTime,0);assert(!cave.paused);assert(snow.paused);
 music.destroy();
});
test('dedicated champion battle tracks stay stable and cannot override wild, trainer, PvP or Colosseum music',async()=>{
 const{battleMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 for(const[map,track]of [['ville1_arene','mounir'],['ville_safe1_arene','hoze'],['gen_arene5','raph'],['ville3_arene','ana'],['ville4_arene','wanda'],['ville5_arene','7p']]){
  assert.equal(battleMusicTrack('arena',map),track);
  for(const kind of ['wild','trainer','pvp','colosseum'])assert.equal(battleMusicTrack(kind,map),kind);
 }
 for(const map of ['unknown','__proto__',null])assert.equal(battleMusicTrack('arena',map),'arena');
});

test('dedicated arena room music pauses for combat and resumes its own playhead',async()=>{
 const {music,audios}=await fixture();
 for(const [map,key]of [['ville1_arene','mounir-room'],['ville_safe1_arene','hoze-room'],['route2_maison','lucie-room'],['professor_lab','lucie-room'],['ville3_arene','ana-room'],['ville4_arene','wanda-room'],['ville5_arene','sevenp-room'],['gen_arene5','raph-room']]){
  music.update({map,active:true,volume:.35});await tick();
  const a=music.tracks.get(key);assert(a&&!a.paused);a.currentTime=19;
  music.update({map,active:false,volume:.35});assert(a.paused);
  music.update({map,active:true,volume:.35});await tick();assert.equal(a.currentTime,19);assert(!a.paused);
  assert.equal(audios.filter(v=>!v.paused).length,1);
 }
 music.destroy();
});

test('returning from another theme restarts villages, routes and arenas, even after muted travel',async()=>{
 const {music,audios}=await fixture();
 for(const [map,key,elsewhere]of [['ville1_arene','mounir-room','ville1'],['ville_safe1_arene','hoze-room','ville_safe1'],['route2_maison','lucie-room','route2'],['ville3_arene','ana-room','ville3'],['ville1','village','route1'],['route1','route','ville1'],['gen_arene5','raph-room','gen_ville5'],['ville4_arene','wanda-room','ville4'],['ville5_arene','sevenp-room','ville5'],['route13','snow','cave1']]){
  music.update({map,active:true,volume:.35});await tick();const a=music.tracks.get(key);a.currentTime=27;
  music.update({map:elsewhere,active:true,volume:.35});await tick();assert(a.paused);
  music.update({map,active:true,volume:.35});await tick();assert.equal(a.currentTime,0);assert(!a.paused);assert.equal(music.tracks.get(key),a);
  a.currentTime=19;music.update({map:elsewhere,active:false,volume:0});music.update({map,active:false,volume:0});assert.equal(a.currentTime,0);assert(a.paused);
  music.update({map,active:true,volume:.35});await tick();assert.equal(a.currentTime,0);
  assert.equal(audios.filter(v=>!v.paused).length,1);
 }
 music.destroy();
});

test('Lucie and Professor share the battle theme only for their own trainer encounters',async()=>{
 const{battleMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 for(const map of ['route2_maison','professor_lab']){assert.equal(battleMusicTrack('trainer',map),'lucie');for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(battleMusicTrack(kind,map),kind);}
 for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(battleMusicTrack(kind,'route2_maison'),kind);
 assert.equal(battleMusicTrack('trainer','route2'),'trainer');
});


test('towns and routes are quieter; arenas and event houses are louder while honoring the master slider',async()=>{
 const {music}=await fixture();
 for(const [maps,gain] of [
  [['start','ville1','ville_safe1','ville3','ville4','ville5','route1','route8','route13','route14','ville_commerciale'],.14],
  [['ville1_arene','ville_safe1_arene','gen_arene5','ville3_arene','ville4_arene','ville5_arene','route4_maison'],.34],
  [['route2_maison','professor_lab'],.5],
  [['centre','cave1'],.22]
 ]) for(const map of maps) for(const volume of [0,.35,1]){
  music.update({map,active:true,volume});await tick();
  assert(Math.abs(music.volume-volume*gain)<1e-9,map);
  const a=music.tracks.get(music.track);
  if(a){assert.equal(a.volume,music.volume);assert.equal(a.paused,volume===0,map);}
 }
 music.destroy();
});
test('Gwenn house has its own event theme, reset on return without changing village music',async()=>{
 const {worldMusicTrack}=await service();assert.equal(worldMusicTrack('route4_maison'),'gwenn-room');assert.equal(worldMusicTrack('route3_maison_nrv'),'village');
 const {music,audios}=await fixture();
 music.update({map:'ville1',active:true,volume:1});await tick();const town=audios[0];town.currentTime=23;
 music.update({map:'route4_maison',active:true,volume:1});await tick();const room=music.tracks.get('gwenn-room');assert(town.paused);assert(!room.paused);assert.equal(room.volume,.34);room.currentTime=18;
 music.update({map:'route4_maison',active:false,volume:1});assert(room.paused);music.update({map:'route4_maison',active:true,volume:1});await tick();assert.equal(room.currentTime,18);
 music.update({map:'ville1',active:true,volume:1});await tick();assert(room.paused);assert.equal(town.currentTime,0);
 music.update({map:'route4_maison',active:true,volume:1});await tick();assert.equal(room.currentTime,0);assert.equal(audios.filter(a=>!a.paused).length,1);music.destroy();
});


test('only the authorized Wanda and Gwenn challenges start their own prelude',async()=>{
 const {trainerPreludeMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 assert.equal(trainerPreludeMusicTrack('champion_wanda','ville4_arene'),'wanda');
 for(const name of ['champion_wanda_locked','champion_wanda_after','arena_entry:champion_wanda','champion_ana','moon',null,undefined])assert.equal(trainerPreludeMusicTrack(name,'ville4_arene'),null);
 for(const map of ['ville3_arene','start',null,undefined])assert.equal(trainerPreludeMusicTrack('champion_wanda',map),null);
});

test('Gwenn sequence is isolated to his own trainer encounter and real challenge dialogue',async()=>{
 const {battleMusicTrack,trainerPreludeMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 assert.equal(battleMusicTrack('trainer','route4_maison'),'gwenn');assert.equal(trainerPreludeMusicTrack('gwenn_rochebrume','route4_maison'),'gwenn');
 for(const kind of ['wild','arena','pvp','colosseum'])assert.equal(battleMusicTrack(kind,'route4_maison'),kind);
 for(const name of ['gwenn_rochebrume_locked','gwenn_rochebrume_after','gwenn_father','gwenn_route8',null])assert.equal(trainerPreludeMusicTrack(name,'route4_maison'),null);
 assert.equal(trainerPreludeMusicTrack('gwenn_rochebrume','ville4'),null);assert.equal(battleMusicTrack('trainer','gen_route8'),'trainer');
});

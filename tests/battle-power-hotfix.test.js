const test=require('node:test'),assert=require('node:assert/strict');
test('PvP always selects the gapless Gwenn sequence while PvE retains its trainer theme',async()=>{
 const {battleMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');for(const map of ['route1','ville5_maison1','draft_house','ville1_arene'])assert.equal(battleMusicTrack('pvp',map),'gwenn');assert.equal(battleMusicTrack('arena','ville1_arene'),'mounir');assert.equal(battleMusicTrack('trainer','route2_maison'),'lucie');assert.equal(battleMusicTrack('wild','route1'),'wild');
});
test('impacts and statuses have an explicit post-mix boost and five different weather cues',async()=>{
 const {IMPACT_GAIN,STATUS_GAIN,combatCuePlan}=await import('../vue-explorakit/src/services/moveSounds.js');assert(IMPACT_GAIN>=2);assert(STATUS_GAIN>=2);const cues=['rain','hail','snow','sun','sandstorm'].map(weather=>combatCuePlan({kind:'weather',weather}));assert(cues.every(p=>p.length>=2));assert.equal(new Set(cues.map(JSON.stringify)).size,5);for(const weather of ['sandstorm','hail'])assert(combatCuePlan({kind:'weather-damage',weather}).length>=2);
});
test('weather aliases and damage sources distinguish snow from damaging hail and ignore other residual effects',async()=>{
 const {weatherAudioKind,weatherDamageKind}=await import('../vue-explorakit/src/services/battleWeatherAudio.js');for(const [raw,expected]of [['RainDance','rain'],['sunnyday','sun'],['hail','hail'],['Snowscape','snow'],['sandstorm','sandstorm'],['none',null]])assert.equal(weatherAudioKind(raw),expected);
 assert.equal(weatherDamageKind('[from] Sandstorm'),'sandstorm');assert.equal(weatherDamageKind('Tortank souffre de la grêle.'),'hail');for(const s of ['poison','burn','recoil','snow'])assert.equal(weatherDamageKind(s),null);
});
test('weather ambience allocates one bounded graph, is idempotent, and releases every node when stopped',async()=>{
 const {BattleWeatherAudio}=await import('../vue-explorakit/src/services/battleWeatherAudio.js');const all=[];const node=()=>{const n={connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},frequency:{},gain:{},Q:{}};all.push(n);return n;};const audio={ready:()=>true,output:{},context:{sampleRate:100,createBuffer:()=>({getChannelData:()=>new Float32Array(100)}),createBufferSource:node,createGain:node,createOscillator:node,createBiquadFilter:node}};
 const bed=new BattleWeatherAudio(audio);bed.set('rain');assert.equal(bed.nodes.length,5);const count=all.length;for(let i=0;i<30;i++)bed.set('RainDance');assert.equal(all.length,count);bed.set('hail');assert(all.slice(0,count).every(n=>n.disconnected));bed.stop();assert.equal(bed.nodes.length,0);assert(all.every(n=>n.disconnected));audio.ready=()=>false;bed.set('sun');assert.equal(bed.nodes.length,0);
});
test('the allied ground moves up without changing the sprite geometry or its horizontal centre',async()=>{
 const {groundStyle}=await import('../vue-explorakit/src/services/battleGround.js');for(const width of [30,100,250,800]){const g=Object.freeze({centerX:120,bottomY:500,width,height:200}),desktop=groundStyle(g),mobile=groundStyle(g,{compact:true});assert.equal(mobile.left,'120px');assert(parseFloat(mobile.top)<parseFloat(desktop.top));assert(parseFloat(mobile.top)<500);assert.equal(g.bottomY,500);assert(parseFloat(mobile.width)>=130&&parseFloat(mobile.width)<=500);}
});
test('double battle weather packets carry their own source, including changes inside the same turn',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle'),factory=require('../server/game/drift/pokemonFactory');const team=()=>[9,143,135,131].map(id=>factory.create(id,100,true)),players=[{username:'A',equipe:{pokemons:team()}},{username:'B',equipe:{pokemons:team()}}],battle=new DoublesBattle(...players,{now:()=>0,emit(){}});
 battle.sim.add('-weather','RainDance');battle.sim.add('-weather','SunnyDay');const events=battle.events().filter(e=>e.kind==='-weather');assert.deepEqual(events.slice(-2).map(e=>e.weather),['RainDance','SunnyDay']);
});
test('music bounds remove decoder-specific MP3 padding with a strictly bounded edge scan',async()=>{
 const {musicSequenceBounds}=await import('../vue-explorakit/src/services/sequencedMusic.js');const make=(start,end)=>{const samples=new Float32Array(1000);samples.fill(.1,Math.round(start*1000),1000-Math.round(end*1000));return{duration:1,sampleRate:1000,length:1000,numberOfChannels:1,getChannelData:()=>samples};};
 const chromium=musicSequenceBounds({intro:make(0,.02),loop:make(.02,0)}),webkit=musicSequenceBounds({intro:make(.024,.032),loop:make(.046,.012)});assert.equal(chromium.loopStart,.02);assert.equal(webkit.loopStart,.046);assert.equal(webkit.introEnd,.968);assert.equal(webkit.loopEnd,.988);const quiet=musicSequenceBounds({intro:make(.3,.3),loop:make(.3,.3)});assert.equal(quiet.loopStart,.1);assert.equal(quiet.loopEnd,.9);
});

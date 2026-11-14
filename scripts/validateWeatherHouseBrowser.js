// Reuse the authenticated native-battle harness and its dedicated SQL cleanup.
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),root=path.resolve(__dirname,'..');
let source=fs.readFileSync(root+'/scripts/validateBattleCardPolishBrowser.js','utf8');
source=source.replace("const app=require('express')()",`const clubModule=require('../server/realtime/whitepeakClub'),contexts=new Map();let club;
clubModule.getClub=io=>{if(club)return club;club=clubModule.createClub(io,{tickMs:0});const attach=club.attach;club.attach=c=>{contexts.set(c.id,c);return attach(c);};return club;};
const app=require('express')()`);
const from=source.indexOf(" const statuses=['poison'"),to=source.indexOf(' assert.deepEqual(errors,[]);success=true;');
if(from<0||to<0)throw Error('Native harness anchors changed');
const body=String.raw`
 await fixture();const sounds=await page.evaluate(async()=>{
  const Constructor=b._battleAudio.constructor,rows=[];
  for(const kind of ['rain','sandstorm','hail','snow','sun','sand-hit','hail-hit','zero-hit']){
   const c=new OfflineAudioContext(1,88200,44100),audio=new Constructor(()=>c);audio.context=c;audio.output=c.createGain();audio.output.connect(c.destination);audio.volume=.35;audio.ready=()=>true;audio.noiseBuffer=c.createBuffer(1,44100,44100);const noise=audio.noiseBuffer.getChannelData(0);let seed=7193;for(let i=0;i<noise.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=seed/2147483648-1;}
   if(kind.endsWith('-hit'))audio.impact({weather:kind==='hail-hit'?'hail':'sandstorm',damage:kind==='zero-hit'?0:6,maxHp:100,direct:false});
   else for(let i=0;i<5;i++)audio.cue({kind:'weather',weather:kind});
   const buffer=await c.startRendering(),data=buffer.getChannelData(0);await new Promise(r=>setTimeout(r,0));let peak=0,tail=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));if(i>44100)tail=Math.max(tail,Math.abs(data[i]));}
   rows.push({kind,peak,tail,voices:audio.voices.size,ambientGraph:!!audio.weatherAudio});audio.dispose();
  }return rows;
 });
 for(const s of sounds){assert.equal(s.voices,0);assert.equal(s.tail,0);assert(!s.ambientGraph);if(['sand-hit','hail-hit'].includes(s.kind))assert(s.peak>.01&&s.peak<.985,JSON.stringify(s));else assert.equal(s.peak,0);}
 measurements.push({weatherAudio:sounds});checks.push('five-weathers-silent-even-after-repeated-updates-and-only-real-weather-damage-audible');
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){
  await page.setViewportSize({width,height});await fixture();
  const rows=await page.evaluate(async()=>{const rows=[];for(const context of [{map:'route1',kind:'trainer',env:null},{map:'ville1_arene',kind:'trainer',env:null},{map:'super_tournament_duel',kind:'trainer',env:null},{map:'ville5_maison1',kind:'trainer',env:'whitepeak-club'},{map:'route1',kind:'pvp',env:null}]){
   b.battleMapName=context.map;b.setEncounterEnvironment(context.env);b.battleKind=context.kind;b.opponentEffortYield={attack:2};b.experienceNotice='XP';await b.$nextTick();rows.push({...context,competitive:b.competitivePresentation,xp:!!b.$el.querySelector('.experience-strip'),xpNotice:!!b.$el.querySelector('.experience-notice'),ev:!!b.$el.querySelector('[data-battle-effort-yield]'),hp:b.currentPokemon.currentHp,name:b.currentPokemon.name});
  }return rows;});
  for(const [i,row]of rows.entries()){assert.equal(row.competitive,i>=3);assert.equal(row.xp,i<3);assert.equal(row.xpNotice,i<3);assert.equal(row.ev,i<3);assert.equal(row.hp,rows[0].hp);assert.equal(row.name,rows[0].name);}
  measurements.push({width,presentation:rows});checks.push('house-training-and-pvp-hide-ev-xp-adventure-and-tower-retain-them-'+width);
  await page.evaluate(()=>{b.battleMapName='ville5_maison1';b.battleKind='trainer';b.setEncounterEnvironment('whitepeak-club');});await page.waitForTimeout(150);await shot('house-pve-'+width);
 }
`;
const power=fs.readFileSync(root+'/scripts/battlePowerBrowserChecks.js','utf8'),m=power.indexOf(' const music=await page.evaluate'),mEnd=power.lastIndexOf('\n};');if(m<0)throw Error('Music probe anchor missing');
const live=String.raw`
 await page.evaluate(()=>{v.battle=false;v.socket.disconnect();});
 await db.execute("UPDATE users SET map='ville5_maison1',x=432,y=208 WHERE id=?",[user.id]);
 await page.reload();await ready();await audioChecks.instrument(page);
 const response=await page.evaluate(()=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit('whitepeak:create',{mode:'pve',trainerKey:'champion_ana',level:50},(e,r)=>e?reject(e):resolve(r))));assert(response.success,JSON.stringify(response));
 await page.waitForFunction(()=>v.battle&&!v.$refs.battleOverlay.entranceActive&&!v.$refs.battleOverlay.presentationBusy,null,{timeout:30000});
 const first=await page.evaluate(()=>{window.b=v.$refs.battleOverlay;return{kind:b.musicKind,pve:b.battleKind,competitive:b.competitivePresentation,xp:!!b.$el.querySelector('.experience-strip'),ev:!!b.$el.querySelector('[data-battle-effort-yield]')};});assert.deepEqual(first,{kind:'gwenn',pve:'trainer',competitive:true,xp:false,ev:false});
 const room=club.roomFor(user.id);assert.equal(room.engine.type,'trainer');assert.equal(room.engine.rules.rewards,false);assert.equal(room.engine.musicKind(),'gwenn');const round=room.engine.round;
 await page.evaluate(()=>new Promise(resolve=>v.socket.emit('whitepeak:refresh',{battleSync:true},resolve)));await page.waitForFunction(()=>v.$refs.battleOverlay.musicKind==='gwenn');assert.equal(room.engine.round,round);
 await shot('real-pve-ana-gwenn');await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(120);await page.evaluate(()=>v.socket.connect());await ready();await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.musicKind==='gwenn'&&!v.$refs.battleOverlay.presentationBusy,null,{timeout:30000});assert.equal(room.engine.round,round);
 assert(await page.evaluate(()=>v.$refs.battleOverlay.competitivePresentation));await shot('real-pve-after-reconnect');checks.push('real-authenticated-house-pve-entry-refresh-and-reconnect-gwenn-no-xp-no-ev-no-extra-turn');
 await club.execute(()=>{room.engine.finish(null,'test_cleanup');});await club.tick();
`;
source=source.slice(0,from)+body+power.slice(m,mEnd)+live+source.slice(to);
source=source.replace("out='/tmp/riftmon-battle-cards-20261114-'","out='/tmp/riftmon-weather-house-20261114-'");
const name=root+'/scripts/__virtualWeatherHouseBrowser.js',mod=new Module(name,module);mod.filename=name;mod.paths=Module._nodeModulePaths(root+'/scripts');mod._compile(source,name);

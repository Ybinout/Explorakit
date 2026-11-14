const test=require('node:test'),assert=require('node:assert/strict');
test('shared reading windows remain bounded and survive reduced motion, with no hidden-tab wait',async()=>{
 const {battleReadingTime,pacedMovePhases,nativeEventPause,BATTLE_PACING}=await import('../vue-explorakit/src/services/battlePacing.js');
 for(const n of [1,25,80,5000]){const s='a'.repeat(n);assert(battleReadingTime(s)>=920&&battleReadingTime(s)<=2200);assert(battleReadingTime(s,{move:true})>=1700&&battleReadingTime(s,{move:true})<=2600);assert.equal(battleReadingTime(s,{hidden:true}),0);}
 const phases={windupMs:120,travelMs:700,impactMs:640},after=pacedMovePhases(phases);for(const k of Object.keys(phases))assert(after[k]>phases[k]&&after[k]<phases[k]*1.35+50);
 assert.equal(nativeEventPause({kind:'-damage',direct:false}),BATTLE_PACING.residual);assert.equal(nativeEventPause({kind:'-damage',direct:true}),BATTLE_PACING.damage);assert.equal(nativeEventPause({kind:'-status'},{status:'poison'}),BATTLE_PACING.status);assert.equal(nativeEventPause({kind:'upkeep'}),0);
});
test('native status visuals use resolved public causes, distinguish cures and do not invent effects for direct damage',async()=>{
 const {nativeStatusVisual,statusVisualKey,STATUS_VISUALS}=await import('../vue-explorakit/src/services/battleStatusVisuals.js');
 assert.equal(Object.keys(STATUS_VISUALS).length,13);
 for(const [cause,key]of [['brn','burn'],['tox','poison'],['psn','poison'],['confusion','confusion'],['move: Disable','disable'],['par','paralysis'],['frz','freeze'],['slp','sleep'],['move: Leech Seed','seed'],['Curse','curse'],['recoil','recoil'],['item: Life Orb','recoil']]){
  assert.equal(statusVisualKey(cause),key);assert.equal(nativeStatusVisual({kind:'-damage',source:cause}).status,key);assert.equal(nativeStatusVisual({kind:'cant',effect:cause}).status,key);
 }
 assert.equal(nativeStatusVisual({kind:'-status',effect:'tox'}).phase,'apply');assert.equal(nativeStatusVisual({kind:'-end',effect:'confusion'}).status,'cure');assert.equal(nativeStatusVisual({kind:'-curestatus',effect:'brn'}).status,'cure');
 for(const e of [{kind:'-damage',direct:true,effect:'psn'},{kind:'move',moveName:'Toxic'},{kind:'-immune',effect:'psn'},{kind:'-fail',effect:'Disable'},{kind:'-damage',source:'ability: Magic Guard'}])assert.equal(nativeStatusVisual(e),null);
});
test('legacy effect cues attach only to the visible identity and reject unrelated text and ambiguous names',async()=>{
 const {narratedStatusVisual,conditionStatusVisual}=await import('../vue-explorakit/src/services/battleStatusVisuals.js');
 const own={uuid:'own',name:'Arcanin'},foe={uuid:'foe',name:'Staross'},fighters=[{side:'player',pokemon:own},{side:'wild',pokemon:foe}];
 for(const [line,status,side]of [['Arcanin souffre de sa brulure (12 PV).','burn','player'],['Staross souffre gravement du poison (20 PV).','poison','wild'],['Arcanin est confus.','confusion','player'],['Staross ne peut pas utiliser Surf (Entrave).','disable','wild'],['Arcanin est paralyse par l’amour.','attraction','player'],['Staross dort.','sleep','wild'],['Arcanin subit 12 PV de contrecoup.','recoil','player'],['Staross se reveille !','cure','wild']]){const result=narratedStatusVisual(line,fighters);assert.equal(result?.status,status,line);assert.equal(result?.side,side,line);}
 for(const line of ['Arcanin utilise Toxic !','Staross est immunisé au poison.','Arcanin gagne 100 XP !','Le Poison ne fonctionne pas.','Ancien Arcanin est confus.'])assert.equal(narratedStatusVisual(line,fighters),null);
 assert.equal(narratedStatusVisual('Arcanin est confus.',[{side:'player',pokemon:own},{side:'wild',pokemon:{...foe,name:'Arcanin'}}]),null);
 assert.equal(conditionStatusVisual({key:'ailment',kind:'status',status:'burn'}).status,'burn');assert.equal(conditionStatusVisual({key:'disableTurns',kind:'status'}).status,'disable');assert.equal(conditionStatusVisual({key:'attack',kind:'up'}),null);
});
test('native raid and doubles logs preserve residual sources without modifying simulator state',()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids');
 const party=Array.from({length:4},()=>({ownerId:1,ownerName:'Test',pokemon:make(9,100,4,['Splash'],'Keen Eye')}));
 const raid=new RaidBattle(party,make(143,100,4,['Splash'],'Keen Eye'),{now:()=>1000,seed:[1,2,3,4]});
 const p=raid.sim.p1.active[0];raid.sim.damage(23,p,p,raid.sim.dex.conditions.get('brn'));const hp=p.hp;raid.collect();assert.equal(p.hp,hp);assert(raid.events.some(e=>e.kind==='-damage'&&e.slot===0&&e.source==='brn'&&e.direct===false));
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle');
 const players=['a','b'].map(id=>({id,username:id,equipe:{pokemons:[make(9,100,4,['Splash'],'Keen Eye'),make(135,100,4,['Splash'],'Keen Eye')]}}));
 const b=new DoublesBattle(...players,{emit(){},now:()=>1000});
 const target=b.sim.p1.active[0];b.sim.damage(17,target,target,b.sim.dex.conditions.get('psn'));const before=target.hp,events=b.events();assert.equal(target.hp,before);assert(events.some(e=>e.kind==='-damage'&&e.actor.side===0&&e.actor.slot===0&&e.source==='psn'&&e.direct===false));
});
test('doubles reserve a presentation grace period, preserve45 seconds to decide and never extend it on an unchanged request',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle'),{make}=require('../scripts/calibrateCorruptionRaids');let now=1000;
 const players=['a','b'].map(id=>({id,username:id,equipe:{pokemons:[make(9,100,4,['Splash'],'Keen Eye'),make(135,100,4,['Splash'],'Keen Eye')]}}));
 const b=new DoublesBattle(...players,{emit(){},now:()=>now});assert(b.playbackUntil>now);assert.equal(b.deadline-b.playbackUntil,45000);const deadline=b.deadline;
 now+=1000;b.refresh();assert.equal(b.deadline,deadline);now=deadline-1;b.tick();assert.equal(b.finished,false);now=deadline;b.tick();assert.equal(b.finished,true);
});

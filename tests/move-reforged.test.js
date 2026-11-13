const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const api=async()=>import('../vue-explorakit/src/services/moveVisuals.js');
function context(){const calls=[];return new Proxy({calls},{get:(o,k)=>k in o?o[k]:(...a)=>calls.push([k,...a]),set:(o,k,v)=>{o[k]=v;calls.push([k,v]);return true;}});}
async function renderer(){const {MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js'),c=context();let clock=0,requested=0,cancelled=0;const r=new MoveEffectRenderer({width:1,height:1,getContext:()=>c},{now:()=>clock,requestFrame:()=>++requested,cancelFrame:()=>cancelled++});r.resize(896,515,3);return{r,c,time:v=>{clock=v;},get requested(){return requested;},get cancelled(){return cancelled;}};}
test('every authoritative move resolves to finite bounded profiles, 18 distinct element silhouettes, and specific iconic styles',async()=>{
 const {moveVisual,ELEMENTS,SIGNATURE_MOVES}=await api(),moves=require('../data/game/moves.json');assert(moves.length>=638);assert.equal(Object.keys(ELEMENTS).length,18);assert.equal(new Set(Object.values(ELEMENTS).map(p=>p.shape)).size,18);
 for(const m of moves){const v=moveVisual({moveName:m.ename});assert.equal(v.moveType,m.type,m.ename);assert.equal(v.damageClass,m.combat.damage_class,m.ename);for(const key of ['windupMs','travelMs','impactMs'])assert(v[key]>0&&v[key]<=800);assert(v.intensity>=.18&&v.intensity<=1);}
 const styles=['Flamethrower','Fire Blast','Fire Spin','Thunderbolt','Thunder','Volt Switch','Draco Meteor','Hyper Beam','Surf','Earthquake','Blizzard','Rock Slide','Swords Dance','Calm Mind','Dragon Dance','Toxic','Will-O-Wisp','Recover','Protect','Stealth Rock'].map(moveName=>moveVisual({moveName}).style);assert.equal(new Set(styles).size,styles.length);assert(SIGNATURE_MOVES.length>=75);
 assert(moveVisual({moveName:'Hyper Beam'}).intensity>moveVisual({moveName:'Tackle'}).intensity);
 assert.equal(moveVisual({moveName:'Weather Ball',moveType:'Ice'}).moveType,'Ice');
});
test('the renderer paints different families and all element shapes, clips HUD, bounds targets and cancels its frame',async()=>{
 const {moveVisual,ELEMENTS}=await api(),f=await renderer(),hashes=new Set(),path={startX:140,startY:420,targetX:710,targetY:210,groundY:300};
 for(const type of Object.keys(ELEMENTS)){f.c.calls.length=0;f.r.setEffect({...moveVisual({moveName:'Tackle',moveType:type}),stage:'impact',result:{success:true,hits:2}},path,[{x:0,y:0,width:160,height:80}]);f.r.paintAt(160);assert(f.c.calls.some(c=>c[0]==='clip'&&c[1]==='evenodd'));hashes.add(crypto.createHash('sha256').update(JSON.stringify(f.c.calls)).digest('hex'));assert(f.r.stats.particles<=72);}
 assert.equal(hashes.size,18);assert.equal(f.r.dpr,1.5);assert(f.cancelled>0);f.r.dispose();assert.equal(f.r.canvas.width,0);assert.equal(f.r.frame,0);
});
test('a failed move never runs the impact painter; multi-hit counts remain bounded',async()=>{
 const {moveVisual}=await api(),f=await renderer(),p={startX:20,startY:30,targetX:80,targetY:40};let hits=0;f.r.impact=()=>hits++;
 for(const result of [{success:false},{missed:true},{immune:true},{blocked:true},{effectiveness:0}]){f.r.setEffect({...moveVisual({moveName:'Fire Fang'}),stage:'impact',result},p);f.r.paintAt(180);}assert.equal(hits,0);
 f.r.setEffect({...moveVisual({moveName:'Fury Swipes'}),stage:'impact',result:{success:true,hits:80}},p);f.r.paintAt(180);assert(hits>0);f.r.dispose();
});
test('Doubles mixed results and multi-hit damage use actual targets, ignoring residual and recoil damage',async()=>{
 const {doubleMoveVisual}=await import('../vue-explorakit/src/services/doubleMoveVisuals.js');
 const events=[{kind:'move',moveName:'Surf',actor:{side:0,slot:0},moveTarget:'allAdjacent',target:{side:1,slot:0}},
 {kind:'-immune',actor:{side:1,slot:0}},{kind:'-crit',actor:{side:1,slot:1}},
 {kind:'-damage',actor:{side:1,slot:1},direct:true},{kind:'-damage',actor:{side:1,slot:1},direct:true},
 {kind:'upkeep'},{kind:'-damage',actor:{side:0,slot:0},direct:false}];
 const p=doubleMoveVisual(events,0,[[{},{}],[{},{}]]);assert.equal(p.targets.find(p=>p.side===1&&p.slot===0).connected,false);const hit=p.targets.find(p=>p.side===1&&p.slot===1);assert(hit.connected&&hit.critical);assert.equal(hit.hits,2);assert(!p.targets.some(p=>p.side===0&&p.slot===0));
 const miss=doubleMoveVisual([{kind:'move',actor:{side:0,slot:0},target:{side:1,slot:1}},{kind:'-miss',actor:{side:0,slot:0},target:{side:1,slot:1}}],0);assert(!miss.targets[0].connected);
 const prep=doubleMoveVisual([{kind:'move',actor:{side:0,slot:0},target:{side:1,slot:0}},{kind:'-prepare',actor:{side:0,slot:0}}],0);assert(prep.prepared);assert(prep.targets.every(p=>!p.connected));
});
test('native Doubles delayed impacts emit one target-only cue without inventing a reserve caster',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle'),f=require('../server/game/drift/pokemonFactory');
 const mon=(id,moves)=>{const p=f.create(id,100,true);p.abilities=moves;p.movePp=moves.map(()=>40);p.heldItem=null;p.passiveAbility='Keen Eye';return p;};
 const a={id:'delayed-a',username:'A',equipe:{pokemons:[mon(65,['Future Sight','Splash']),mon(143,['Splash'])]}},b={id:'delayed-b',username:'B',equipe:{pokemons:[mon(143,['Splash']),mon(9,['Splash'])]}},events=[];
 const battle=new DoublesBattle(a,b,{emit:(_p,e,d)=>{if(_p===a&&e==='whitepeak:doubleFrame')events.push(...d.events);}});
 for(let turn=0;turn<4;turn++)for(const [p,slot]of [[a,0],[a,1],[b,0],[b,1]]){if(battle.finished)break;assert(battle.action(p,{turnId:battle.token,slot,action:'attack',moveIndex:p===a&&slot===0?(turn===0?0:1):0,...(p===a&&slot===0&&turn===0?{targetLoc:1}:{})}));}
 const delayed=events.filter(e=>e.kind==='move'&&e.delayed);assert.equal(delayed.length,1);assert.equal(delayed[0].moveName,'Future Sight');assert.equal(delayed[0].actor,null);assert.deepEqual(delayed[0].target,{side:1,slot:0});
});

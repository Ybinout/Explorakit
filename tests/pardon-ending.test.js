const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {teachMachine,machines}=require('../server/game/items/machines'),ending=require('../server/game/world/voidEnding');
const terrain=require('../server/game/world/mapRepository'),pokedex=require('../data/game/pokedex.json');
function mon(id=1,moves=['Purify']){const p=factory.create(id,30,true);p.passiveAbility=null;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(require('../server/game/battle/battleResources').getMaxMovePp);p.currentHp=20;p.maxHp=101;return p;}
function cast(a,b,state=engine.createBattleState()){const random=Math.random;Math.random=()=>.5;try{return engine.useattack('Purify',a,b,{battleState:state});}finally{Math.random=random;}}
for(const status of ['burn','poison','badly_poison','paralyze','sleep','freeze'])test(`Purification cures ${status} and heals half maximum HP, rounding up`,()=>{
 const a=mon(),b=mon(7,['Splash']);b.status=status;const r=cast(a,b);assert.equal(r.success,true);assert.equal(b.status,'normal');assert.equal(a.currentHp,71);assert.equal(a.movePp[0],19);
});
test('Purification without a major status fails, spends PP and leaves confusion/attraction alone',()=>{
 const a=mon(),b=mon();Object.assign(engine.ensureBattleData(b),{confusionTurns:3,infatuationTurns:3});const r=cast(a,b);assert.equal(r.success,false);assert.equal(a.currentHp,20);assert.equal(a.movePp[0],19);assert.equal(b.__battle.confusionTurns,3);assert.equal(b.__battle.infatuationTurns,3);
});
test('Purification respects Protect, Clone, Heal Block and sleep; Magic Bounce reflects it',()=>{
 for(const rule of ['protect','clone','healblock','sleep']){
  const a=mon(),b=mon(),s=engine.createBattleState();b.status='poison';
  if(rule==='protect')engine.ensureBattleData(b).protect=true;if(rule==='clone')engine.ensureBattleData(b).substituteHp=30;
  if(rule==='healblock')engine.ensureBattleData(a).healBlockTurns=2;if(rule==='sleep'){a.status='sleep';engine.ensureBattleData(a).sleepTurns=3;}
  const r=cast(a,b,s);assert.equal(r.success,false);assert.equal(b.status,'poison');assert.equal(a.currentHp,20);assert.equal(a.movePp[0],['healblock','sleep'].includes(rule)?20:19);
 }
 const a=mon(),b=mon();a.status='burn';b.status='poison';b.passiveAbility='Magic Bounce';cast(a,b);assert.equal(a.status,'normal');assert.equal(b.status,'poison');assert.equal(b.currentHp,71);
});
test('Purification CS is an explicit Poison-only exception, including every existing later species; other CS keep their rules',()=>{
 const expected=pokedex.filter(p=>p.type.includes('Poison')).map(p=>p.id);assert.deepEqual(machines.cs_purify.species,expected);assert.equal(expected.length,66);assert.equal(machines.cs_purify.price,3000);
 for(const p of pokedex){const pokemon={data:{id:p.id},currentHp:1,abilities:['Tackle'],movePp:[2],pendingMoves:[]};const choice={slot:1,expectedMoves:['Tackle']};
  if(p.type.includes('Poison')){const result=teachMachine(pokemon,'cs_purify',choice);assert.equal(result.abilities[1],'Purify');assert.equal(result.movePp[1],20);}else assert.throws(()=>teachMachine(pokemon,'cs_purify',choice),/compatible/);
 }
 assert(!machines.cs_surf.species.includes(129));
});
test('both ending badges are visible and exclusive, and neither affects the capture tier',()=>{
 const badges=require('../data/game/progression.json').badges,final=badges.filter(b=>b.exclusiveGroup==='professor_finale');assert.equal(final.length,2);assert(final.every(b=>!b.hidden&&b.countsForCapture===false));assert.deepEqual(final.map(b=>b.ending),['violence','pardon']);
 const {captureProgress}=require('../server/game/battle/captureProgression');assert.deepEqual(captureProgress(final.map(b=>({...b,earned:true}))),captureProgress([]));
});
const found={lucie_rescued:'true',void_found:'true',void_charge:'5',void_intro:'true'};
test('Pardon keeps the Professor standing and offers his apology once; legacy defeat remains Violence',()=>{
 const p={flags:{...found,void_defeated:'true',void_resolution:'pardon',void_claimed:'true'}};assert.equal(ending.state(p).resolution,'pardon');assert.equal(ending.actors('void_arena',p)[0].sprite,'professor-pixel-v1.png');assert.equal(ending.entryDialogue(p).name,'professor_pardoned');
 p.flags.void_pardon_seen='true';assert.equal(ending.entryDialogue(p),null);
 const legacy={flags:{...found,void_defeated:'true'}};assert.equal(ending.state(legacy).resolution,'violence');assert.equal(ending.actors('void_arena',legacy)[0].sprite,'professor-ko-pixel-v1.png');
});
test('admin preview has its own choice, apology and discovery while the permanent ending stays intact',()=>{
 const flags={...found,void_defeated:'true',void_claimed:'true',void_resolution:'violence',admin_void_replay:'true',admin_void_found:'true',admin_void_charge:'5',admin_void_resolution:'pardon',admin_void_defeated:'true',admin_professor_departure:'seen',admin_lab_rescued:'true'};
 assert.equal(ending.state({flags}).resolution,'pardon');assert.equal(ending.entryDialogue({flags}).name,'professor_pardoned');flags.admin_void_pardon_seen='true';assert.equal(ending.entryDialogue({flags}),null);assert.equal(flags.void_resolution,'violence');
});
test('five different research journals lie on reachable floor away from doors and the Professor, and remain read-only',()=>{
 const c=terrain.loadCollisionData('void_arena'),change=terrain.changeMapData('void_arena');assert.equal(ending.journals.length,5);assert.equal(new Set(ending.journals.map(b=>b.id)).size,5);
 const p={flags:found},before=JSON.stringify(p);assert.equal(ending.state(p).journals.length,5);assert.equal(ending.state({}).journals.length,0);
 for(const book of ending.journals){assert.equal(c[book.y][book.x],0);assert.equal(change[book.y][book.x],0);assert.notEqual(book.x,13);assert(book.pages.length>=2);assert(book.pages.every(s=>s.length>100));assert.equal(ending.journalAt({currentmap:'void_arena',x:book.x*32+16,y:book.y*32+16}).id,book.id);}
 assert.equal(ending.journalAt({currentmap:'start',x:0,y:0}),null);assert.equal(JSON.stringify(p),before);
 const text=ending.journals.flatMap(b=>b.pages).join(' ');for(const term of ['soigner','copier','violette','purification','Lucie'])assert(text.includes(term));assert(!/Badge Pardon|lance.*Purification|appuie|clic/i.test(text));
});
test('journal renderer uses the supplied floor positions without a loop or interactive HUD',async()=>{
 const {drawVoidJournals}=await import('../vue-explorakit/src/services/voidJournals.js'),rects=[],positions=[];
 const c={save(){},restore(){},translate:(x,y)=>positions.push([x,y]),fillRect:(...r)=>rects.push(r)};
 assert.equal(drawVoidJournals(c,'start',ending.state({flags:found})),0);assert.equal(rects.length,0);
 assert.equal(drawVoidJournals(c,'void_arena',ending.state({flags:found})),5);assert.equal(positions.length,5);assert(rects.every(r=>r.every(Number.isFinite)));assert(rects.length<=70);
});
test('Corrompu is a violet presentation status for the human, not an ordinary Pokémon ailment',async()=>{
 const {getBattleStatus}=await import('../vue-explorakit/src/services/gameView.js');assert.deepEqual(getBattleStatus('corrupted'),{key:'corrupted',code:'Corrompu',label:'Corruption'});const a=mon(),b=mon();b.status='corrupted';assert.equal(cast(a,b).success,false);assert.equal(b.status,'corrupted');
});

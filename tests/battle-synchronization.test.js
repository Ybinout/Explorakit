const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),feedback=require('../server/game/battle/residualPresentation');
function mon(id=143,moves=['Splash']){const p=factory.create(id,100,true);p.passiveAbility='Keen Eye';p.heldItem=null;p.abilities=[];p.movePp=[];for(const move of moves)p.addAbility(move);return p;}
test('residual checkpoints split weather, poison and healing in actual engine order and are opt-in',()=>{
 const a=mon(),b=mon(9),field=engine.createBattleState();a.status='poison';field.weather={kind:'sandstorm',turns:4};
 const original=[structuredClone(a),structuredClone(b)],before=a.currentHp;
 const messages=engine.processEndOfRound(a,b,field.sides.player,field.sides.enemy,field,{presentation:true});
 const steps=feedback.project(messages,a,b),own=steps.flatMap(step=>step.pokemon.filter(p=>p.side==='player'&&p.currentHp<before).map(p=>({hp:p.currentHp,message:step.message})));
 assert.equal(own.length,2);assert.match(own[0].message,/sable/);assert.match(own[1].message,/poison/);assert(own[0].hp>own[1].hp);assert.equal(own[1].hp,a.currentHp);
 assert.deepEqual(steps.filter(s=>s.message).map(s=>s.message),Array.from(messages));
 const reversed=feedback.project(messages,b,a,1);assert(reversed.flatMap(s=>s.pokemon).some(p=>p.uuid===a.uuid&&p.side==='opponent'));
 const comparisonField=engine.createBattleState();comparisonField.weather={kind:'sandstorm',turns:4};
 const baseline=engine.processEndOfRound(...original,comparisonField.sides.player,comparisonField.sides.enemy,comparisonField);
 assert.equal(baseline.presentation,undefined);assert.deepEqual(Array.from(messages),baseline);assert.equal(original[0].currentHp,a.currentHp);assert.equal(original[1].currentHp,b.currentHp);
 assert(!JSON.stringify(field).includes('presentation'));for(const step of steps)for(const p of step.pokemon){assert.deepEqual(Object.keys(p).sort(),['uuid','currentHp','maxHp','status','statStages','conditions','side'].sort());assert(!('abilities'in p||'heldItem'in p));}
});
test('future attacks retain their target-only animation inside the residual sequence, with real intermediate HP',()=>{
 const a=mon(65,['Future Sight']),b=mon(),field=engine.createBattleState();engine.useattack('Future Sight',a,b,{battleState:field,attackerSide:field.sides.player,defenderSide:field.sides.enemy});
 let steps=[];for(let turn=0;turn<4;turn++){const messages=engine.processEndOfRound(a,b,field.sides.player,field.sides.enemy,field,{presentation:true});steps=feedback.project(messages,a,b);if(steps.some(s=>s.delayed))break;}
 const delayed=steps.find(s=>s.delayed);assert(delayed);assert.equal(delayed.delayed.moveName,'Future Sight');assert.equal(delayed.delayed.actor,'player');assert.equal(delayed.delayed.targetUuid,b.uuid);assert(steps.some(s=>s.pokemon.some(p=>p.side==='opponent'&&p.currentHp===b.currentHp)));
});
test('burst-mode battles publish the animation and result snapshot before their critical/effect narration',()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle'),events=[],players=['a','b'].map(id=>({id,username:id,socketId:id,equipe:{pokemons:[mon(143,id==='a'?['Slash']:['Splash'])]},items:{},defeated:new Set(),drifts:[],equipped:[]}));
 const old=Math.random;Math.random=()=>.001;
 try{
  const battle=new DriftBattle(...players,{type:'pvp',emit:(p,event,data)=>{if(p===players[0])events.push({event,data});},rules:{report:false,rewards:false,permanentDeaths:false}});events.length=0;
  for(const p of players)assert(battle.action(p,{turnId:battle.token,action:'attack',number:0}));
  const animation=events.findIndex(e=>e.event==='battleMoveAnimation'),name=events.findIndex(e=>e.event==='battleText'&&/ utilise /.test(e.data.message)),result=events.findIndex(e=>e.event==='battleMoveResult'),state=events.findIndex((e,i)=>i>result&&e.event==='introAnimation'),crit=events.findIndex(e=>e.event==='battleText'&&e.data.message==='Coup critique !');
  assert(animation>=0&&name>animation&&result>name&&state>result);assert(crit>state,JSON.stringify(events.map(e=>[e.event,e.data.message])));
 }finally{Math.random=old;}
});
test('sprite tint is temporary input, preserves shadows, and is absent in reduced motion',async()=>{
 const {spriteTint}=await import('../vue-explorakit/src/services/spriteTint.js');
 const up=spriteTint(null,[{kind:'up'}]),down=spriteTint(null,[{kind:'down'}]);assert(up.filter&&down.filter&&up.filter!==down.filter);
 for(const status of ['poison','burn','paralysis','freeze','confusion'])assert(spriteTint({status}).filter);
 assert.match(spriteTint({status:'poison'},[],false,'drop-shadow(0 0 2px #000)').filter,/^drop-shadow/);assert.deepEqual(spriteTint(null),{});assert.deepEqual(spriteTint({status:'poison'},[{kind:'up'}],true),{});
});
test('new signatures and flowing beam geometry are finite, bounded and preserve failed-target exclusions',async()=>{
 const {MOVE_VARIANTS}=await import('../vue-explorakit/src/services/moveVariantEffects.js'),{moveVisual}=await import('../vue-explorakit/src/services/moveVisuals.js'),{MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js');
 const moves=require('../data/game/moves.json');assert(Object.keys(MOVE_VARIANTS).length>=30);assert(new Set(Object.values(MOVE_VARIANTS)).size>=28);
 const calls=[],c=new Proxy({globalAlpha:1},{get:(o,k)=>k in o?o[k]:(...args)=>{for(const v of args)if(typeof v==='number')assert(Number.isFinite(v));calls.push([k,...args]);},set:(o,k,v)=>(o[k]=v,true)}),canvas={width:1,height:1,getContext:()=>c},r=new MoveEffectRenderer(canvas,{quality:1,now:()=>0,requestFrame:()=>1,cancelFrame(){}});r.resize(393,400,3);
 for(const [name,variant]of Object.entries(MOVE_VARIANTS)){assert(moves.some(m=>m.ename===name),name);const v=moveVisual({moveName:name});assert.equal(v.variant,variant);for(const stage of ['travel','impact','aura']){r.setEffect({...v,stage,result:{success:true}},{startX:45,startY:320,targetX:280,targetY:120});r.paintAt(r.duration()*.45);assert((r.stats.variantParticles||0)<=24);}}
 calls.length=0;r.setEffect({...moveVisual({moveName:'Hyper Beam'}),stage:'travel',result:{success:true}},{startX:40,startY:320,targetX:280,targetY:100});r.paintAt(330);assert(calls.filter(c=>c[0]==='quadraticCurveTo').length>=30);const first=JSON.stringify(calls);calls.length=0;r.paintAt(340);assert.notEqual(JSON.stringify(calls),first);
 let impacts=0;r.impact=()=>impacts++;r.setEffect({...moveVisual({moveName:'Aqua Tail'}),stage:'impact',result:{missed:true}},{startX:45,startY:320,targetX:280,targetY:120});r.paintAt(200);assert.equal(impacts,0);r.dispose();
});

const test=require('node:test'),assert=require('node:assert/strict');
const visual=require('../server/game/battle/presentationState');
const factory=require('../server/game/drift/pokemonFactory');
const effects=require('../server/game/drift/driftEffects'),signals=require('../server/game/drift/driftSignals');
const engine=require('../server/game/battle/battleEngine');
const economy=require('../server/game/drift/economy'),fusion=require('../server/game/drift/fusion');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
function mon(id=7){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Tackle'];p.movePp=[35];return p;}
function owner(){return {userId:1,alive:true,run:{mode:'colosseum',phase:'colosseum_battle',endsAt:Infinity},equipe:{pokemons:[mon(),mon(4)]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()};}
function equip(p,n,rarity='mythic'){const d={uuid:'d'+n,definitionId:'DRF-'+String(n).padStart(3,'0'),rarity};p.drifts.push(d);p.equipped.push(d.uuid);}
test('visual state distinguishes recall, KO and forced replacement on both sides without replay or private stats',()=>{
 const viewer={},a=mon(),b=mon(4),c=mon(19),d=mon(25);
 assert.deepEqual(visual.transitions(viewer,a,c),[]);
 let events=visual.transitions(viewer,b,d);assert.deepEqual(events.map(e=>[e.side,e.kind]),[['player','recall'],['player','enter'],['opponent','recall'],['opponent','enter']]);
 b.currentHp=0;events=visual.transitions(viewer,b,d);assert.equal(events[0].kind,'faint');assert.deepEqual(visual.transitions(viewer,b,d),[]);
 assert.deepEqual(visual.transitions(viewer,a,d).map(e=>e.kind),['enter']);
 d.currentHp=0;assert.equal(visual.transitions(viewer,a,null)[0].kind,'faint');assert.deepEqual(visual.transitions(viewer,a,null),[]);
 assert(events.every(e=>Object.keys(e).every(k=>['side','kind','uuid','name'].includes(k))));visual.reset(viewer);assert.deepEqual(visual.transitions(viewer,b,d),[]);
});
test('real Colosseum manual switch emits recall before enemy attack; KO emits faint before end panel',()=>{
 const p=owner(),enemy={npc:true,equipe:{pokemons:[mon(19)]},drifts:[],equipped:[]},events=[];
 const b=new DriftBattle(p,enemy,{type:'arena',npcKey:'colosseum_1',emit:(_,name,payload)=>events.push({name,payload}),random:()=>.9,paceMs:0});
 assert.equal(events.find(e=>e.name==='battletrigger').payload.musicKind,'colosseum');
 assert(b.action(p,{action:'change',number:1,turnId:b.token}));
 const recall=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='recall'));
 assert(recall>=0);assert(events.findIndex(e=>e.name==='battleMoveAnimation')>recall);
 enemy.equipe.pokemons[0].currentHp=0;b.prune();b.checkEnd();
 const faint=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='faint'));
 assert(faint>=0);assert(events.findIndex(e=>e.name==='endbattle')>faint);
});
test('Drift feedback comes from applied modifiers/procs; inactive, missing and ineffective heals stay silent',()=>{
 const p=owner(),a=p.equipe.pokemons[0],d=mon(19);equip(p,2);equip(p,5);effects.attach(p.equipe.pokemons,p);
 const calculated=engine.calculateDamage(a,d,engine.getMoveByName('Tackle'));assert(calculated>0);
 assert.deepEqual(signals.capture(()=>{}).effects,[]);
 const actual=signals.capture(()=>engine.calculateDamage(a,d,engine.getMoveByName('Tackle')));assert(actual.effects.some(e=>e.definitionId==='DRF-002'));
 const result={success:true,damage:20,move:engine.getMoveByName('Tackle')};
 assert.deepEqual(signals.capture(()=>effects.afterMove(a,d,result,{stage(){},status(){}})).effects,[]);
 a.currentHp-=10;const heal=signals.capture(()=>effects.afterMove(a,d,result,{stage(){},status(){}}));assert(heal.effects.some(e=>e.definitionId==='DRF-005'));assert(a.currentHp>a.maxHp-10);
 p.equipped=[];assert.deepEqual(signals.capture(()=>engine.calculateDamage(a,d,engine.getMoveByName('Tackle'))).effects,[]);effects.detach(p.equipe.pokemons);
});
test('real signals are relative to each viewer and contain no owners or reserve identifiers',()=>{
 const p=owner(),q=owner();q.userId=2;q.run.mode='rift';p.run.mode='rift';equip(p,2);equip(q,13);const events=[];
 const b=new DriftBattle(p,q,{type:'pvp',emit:(who,name,payload)=>events.push({who,name,payload}),random:()=>.9,paceMs:0});
 b.action(p,{action:'attack',number:0,turnId:b.token});b.action(q,{action:'attack',number:0,turnId:b.token});
 for(const viewer of [p,q]){const records=events.filter(e=>e.who===viewer&&e.name==='battleDriftEffects');assert(records.length);const all=records.flatMap(e=>e.payload.effects);assert(all.every(e=>!('owner' in e)&&!('pokemon' in e)&&!('uuid' in e)));assert(all.some(e=>e.side==='player'));assert(all.some(e=>e.side==='opponent'));}
 b.finish(null,'fled');
});
test('mixed-rarity fusion raises the actual stat continuously, persists and deletion removes equipped family atomically',()=>{
 const p=owner();p.run.phase='colosseum_ready';equip(p,2,'rare');const old=effects.value(p,2);
 fusion.acquire(p,{uuid:'extra',definitionId:'DRF-002',rarity:'common'},'wild');assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].fusionPoints,3);assert(effects.value(p,2)>old);
 const restored=decode(encode(p));assert.equal(effects.value(restored,2),effects.value(p,2));
 restored.inbattle=true;assert.throws(()=>economy.remove(restored,'d2'));restored.inbattle=false;assert.throws(()=>economy.remove(restored,'foreign'));
 economy.remove(restored,'d2');assert.equal(restored.drifts.length,0);assert.deepEqual(restored.equipped,[]);assert.equal(effects.value(restored,2),0);assert.throws(()=>economy.remove(restored,'d2'));
});
test('Wild income gains 20% in all modes, including caps and reward bonuses',()=>{
 const {wildMoneyReward,adventureMoneyReward}=require('../server/game/battle/wildReward');
 for(const [level,wild,adventure]of [[1,31,47],[5,43,64],[15,72,108],[40,144,216],[50,172,259]]){assert.equal(wildMoneyReward({level}),wild);assert.equal(adventureMoneyReward({level}),adventure);}
 assert.equal(adventureMoneyReward({level:5}),64);assert.equal(wildMoneyReward({level:5}),43);
 for(const [level,money]of [[40,216],[50,259],[57,289],[60,302],[70,345],[73,358],[74,360],[100,360],[1000,360]])assert.equal(adventureMoneyReward({level}),money);
 for(let level=2;level<=100;level++)assert(adventureMoneyReward({level})>=adventureMoneyReward({level:level-1}));
 assert.equal(adventureMoneyReward({level:60},2),604);
 assert.equal(adventureMoneyReward({level:100},1.5),540);
 for(const invalid of [undefined,NaN,Infinity,-1])assert.equal(adventureMoneyReward({level:60},invalid),302);
 assert.equal(wildMoneyReward({level:100}),172);

});

test('stat Drift signals follow real stage changes, including caps and Contrary',()=>{
 const p=owner(),a=mon(19),d=p.equipe.pokemons[0];equip(p,27);effects.attach(p.equipe.pokemons,p,false,()=>0);
 const result={success:true,damage:1,move:engine.getMoveByName('Tackle')};
 const after=()=>signals.capture(()=>effects.afterMove(a,d,result,{stage:(target,stat,delta)=>engine.applyStageChange(target,stat,delta,[]),status(){}})).effects;
 assert(after().some(e=>e.definitionId==='DRF-027'&&e.detail.includes('réduite')));
 a.__battle.statStages.speed=-6;assert.deepEqual(after(),[]);
 a.passiveAbility='Contrary';assert(after().some(e=>e.detail.includes('augmentée')));effects.detach(p.equipe.pokemons);
});

test('expedition KO is published before XP and replacement, which never inherits the dead action',()=>{
 const p=owner(),q={npc:true,equipe:{pokemons:[mon(19),mon(25)]},drifts:[],equipped:[]},events=[];
 p.equipe.pokemons[0].currentSpeed=999;p.equipe.pokemons[0].currentAttack=999;q.equipe.pokemons[0].currentHp=1;
 q.equipe.pokemons.forEach(m=>{m.currentSpeed=1;m.abilities=['Tackle'];});
 const b=new DriftBattle(p,q,{emit:(_,name,payload)=>events.push({name,payload:JSON.parse(JSON.stringify(payload))}),random:()=>.9,paceMs:0});
 const dead=q.equipe.pokemons[0].uuid,live=q.equipe.pokemons[1].uuid;
 b.action(p,{action:'attack',number:0,turnId:b.token});
 const ko=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='faint'&&t.uuid===dead));
 const xp=events.findIndex(e=>e.name==='battleExperience');const enter=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='enter'&&t.uuid===live));
 assert(ko>=0&&xp>ko&&enter>xp);assert.equal(events.filter(e=>e.name==='battleMoveAnimation').length,1);b.finish(null,'fled');
});
test('expedition entrants appear before hazards and an entry KO is not mistaken for recall',()=>{
 const p=owner(),q={npc:true,equipe:{pokemons:[mon(19)]},drifts:[],equipped:[]},events=[];
 const b=new DriftBattle(p,q,{emit:(_,name,payload)=>events.push({name,payload:JSON.parse(JSON.stringify(payload))}),random:()=>.9,paceMs:0});
 const incoming=p.equipe.pokemons[1];incoming.currentHp=1;b.sides[0].hazards={stealthRock:true};
 b.action(p,{action:'change',number:1,turnId:b.token});
 const entry=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='enter'&&t.uuid===incoming.uuid));
 const faint=events.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='faint'&&t.uuid===incoming.uuid));
 assert(entry>=0&&faint>entry);assert.equal(events[entry].payload.player.equipe.pokemons[0].currentHp,1);b.finish(null,'fled');
});

test('Rift PvP status animations identify self versus opponent for both viewers',()=>{
 const p=owner(),q=owner();q.userId=2;p.run.mode=q.run.mode='rift';
 p.equipe.pokemons[0].abilities=['Swords Dance'];p.equipe.pokemons[0].movePp=[20];
 q.equipe.pokemons[0].abilities=['Growl'];q.equipe.pokemons[0].movePp=[40];
 const events=[],b=new DriftBattle(p,q,{type:'pvp',emit:(viewer,name,payload)=>events.push({viewer:viewer.userId,name,payload:JSON.parse(JSON.stringify(payload))}),random:()=>.9,paceMs:0});
 b.action(p,{action:'attack',number:0,turnId:b.token});b.action(q,{action:'attack',number:0,turnId:b.token});
 const moves=events.filter(e=>e.name==='battleMoveAnimation');assert.equal(moves.length,4);
 for(const viewer of [1,2]){const own=moves.find(e=>e.viewer===viewer&&e.payload.moveName==='Swords Dance'),other=moves.find(e=>e.viewer===viewer&&e.payload.moveName==='Growl');assert.equal(own.payload.moveTarget,'self');assert.equal(other.payload.moveTarget,'opponent');assert.notEqual(own.payload.actor,other.payload.actor);}
 assert.equal(p.equipe.pokemons[0].__battle.statStages.attack,1);b.finish(null,'fled');
});

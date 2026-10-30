const test=require('node:test'),assert=require('node:assert/strict');
const {AdventureExperience}=require('../server/game/battle/adventureExperience');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {calculateBattleExperience,reduceActiveOverlevelExperience,BATTLE_EXPERIENCE_MULTIPLIERS:rates}=require('../server/game/models/progression');
const mon=(id=7,level=20)=>{const p=factory.create(id,level,true);p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=null;p.heldItem=null;p.k=1;return p;};
const noop={to:()=>({emit(){}})};
test('Adventure: capture shares the normal wild XP among living entrants, once, and does not KO or reward the catch itself',()=>{
 const a=mon(),b=mon(1),bench=mon(4),enemy=mon(19),p={id:'owner',equipe:{pokemons:[a,b,bench,enemy]}},t=new AdventureExperience();t.enter(a,enemy);t.enter(b,enemy);
 const before=[a,b,bench,enemy].map(p=>p.experience),hp=enemy.currentHp,share=Math.floor(calculateBattleExperience(enemy,rates.wild,a)/2);
 assert.deepEqual(t.reward(p,enemy,rates.wild,noop),[],'an unconfirmed living opponent gives no XP');
 const awards=t.reward(p,enemy,rates.wild,noop,{captured:true});assert.equal(awards.length,2);assert.deepEqual([a,b,bench,enemy].map((p,i)=>p.experience-before[i]),[share,share,0,0]);assert.equal(enemy.currentHp,hp);assert.deepEqual([a,b,bench,enemy].map(p=>p.ev.speed),[1,1,0,0]);
 assert.deepEqual(t.reward(p,enemy,rates.wild,noop,{captured:true}),[]);enemy.currentHp=0;assert.deepEqual(t.reward(p,enemy,rates.wild,noop),[]);assert.equal(a.ev.speed,1);
});
test('Adventure: equipped Multi Exp keeps its sharing/overlevel rules and excludes the newly caught Pokémon, eggs and KO reserves',()=>{
 const a=mon(7,30),b=mon(1),ko=mon(4),egg=mon(25),enemy=mon(19),p={id:'owner',equipe:{pokemons:[a,b,ko,egg,enemy]}},t=new AdventureExperience({expShare:'equipped'});a.heldItem='exp_share';ko.currentHp=0;egg.isEgg=true;t.enter(a,enemy);
 const before=p.equipe.pokemons.map(p=>p.experience),full=reduceActiveOverlevelExperience(calculateBattleExperience(enemy,rates.wild,a),enemy,a),shared=Math.floor(calculateBattleExperience(enemy,rates.wild,b)*.4);
 t.reward(p,enemy,rates.wild,noop,{captured:true});assert.deepEqual(p.equipe.pokemons.map((p,i)=>p.experience-before[i]),[full,shared,0,0,0]);assert.equal(enemy.ev.speed,0);
});
function fixture(mode,size=2,expShare=false,random=()=>0,rules={}){
 const team=Array.from({length:size},(_,i)=>mon(i===0?7:1)),enemy=mon(19),events=[];
 if(expShare)team[0].heldItem='exp_share';
 const p={userId:1,socketId:'owner',alive:true,username:'capture',currentmap:'cave1',run:{mode,phase:'exploration',lobby:{rules:{durationMinutes:mode==='rift'?30:60}}},equipe:{pokemons:team},drifts:[],equipped:[],items:{hyperball:2},money:0,defeated:new Set(),chain:3};
 const q={npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]};
 const battle=new DriftBattle(p,q,{type:'wild',emit:(_,event,data)=>events.push({event,data}),random,paceMs:0,rules});
 return {p,q,battle,enemy,events,team:[...team]};
}
for(const mode of ['rift','colosseum'])for(const size of [2,6])for(const expShare of [false,true])test(`${mode}: real capture into ${size===6?'PC':'team'}, Multi Exp ${expShare}, same XP as a KO and no fake KO/streak`,()=>{
 const f=fixture(mode,size,expShare),control=fixture(mode,size,expShare),before=f.team.map(p=>p.experience),capturedXp=f.enemy.experience;
 control.enemy.currentHp=0;control.battle.reward(control.enemy);
 const expected=control.team.map((p,i)=>p.experience-before[i]);
 assert(f.battle.action(f.p,{action:'bag',itemKey:'hyperball',turnId:f.battle.token}));assert(f.battle.finished);assert.equal(f.battle.capturedPokemon,f.enemy);assert.deepEqual(f.team.map((p,i)=>p.experience-before[i]),expected);assert(expected[0]>0);
 assert.equal(f.enemy.experience,capturedXp);assert.equal(f.enemy.ev.speed,0);assert.equal(f.p.chain,3);assert.equal(f.battle.rewarded.size,0);assert.equal(f.p.items.hyperball,1);
 assert(size===6?f.p.storage[0].pokemon===f.enemy:f.p.equipe.pokemons.includes(f.enemy));
 const summary=f.events.find(e=>e.event==='endbattle').data.summary;assert.equal(summary.outcome,'captured');assert(summary.experience.some(e=>e.xpGained>0));assert(!summary.experience.some(e=>e.uuid===f.enemy.uuid));
 const xp=f.team.map(p=>p.experience);f.battle.reward(f.enemy,{captured:true});f.battle.reward(f.enemy);assert.deepEqual(f.team.map(p=>p.experience),xp);
 const restored=codec.decode(codec.encode(f.battle));restored.emit=()=>{};const restoredXp=restored.a.equipe.pokemons.map(p=>p.experience);restored.reward(restored.capturedPokemon,{captured:true});assert.deepEqual(restored.a.equipe.pokemons.map(p=>p.experience),restoredXp);
});
for(const mode of ['rift','colosseum'])test(`${mode}: a failed Ball followed by escape gives no XP; disabled rewards remain disabled`,()=>{
 const f=fixture(mode,2,false,()=>.999),before=f.team.map(p=>p.experience);assert(f.battle.action(f.p,{action:'bag',itemKey:'hyperball',turnId:f.battle.token}));assert(!f.battle.finished);assert.deepEqual(f.team.map(p=>p.experience),before);f.battle.tick();assert(f.battle.action(f.p,{action:'flee',turnId:f.battle.token}));assert.deepEqual(f.team.map(p=>p.experience),before);
 const disabled=fixture(mode,2,false,()=>0,{rewards:false}),xp=disabled.team.map(p=>p.experience);disabled.battle.action(disabled.p,{action:'bag',itemKey:'hyperball',turnId:disabled.battle.token});assert.deepEqual(disabled.team.map(p=>p.experience),xp);assert(!disabled.events.some(e=>e.event==='battleExperience'));
});
test('legacy checkpoints without a capture XP ledger cannot reward an already credited KO twice',()=>{
 const f=fixture('rift');f.enemy.currentHp=0;f.battle.reward(f.enemy);delete f.battle.experienceRewarded;const before=f.team.map(p=>p.experience);f.battle.reward(f.enemy);assert.deepEqual(f.team.map(p=>p.experience),before);f.battle.finish(null,'fled');
});

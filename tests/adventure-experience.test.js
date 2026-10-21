const test=require('node:test'),assert=require('node:assert/strict');
const {AdventureExperience}=require('../server/game/battle/adventureExperience');
const factory=require('../server/game/drift/pokemonFactory'),{calculateBattleExperience:xp,BATTLE_EXPERIENCE_MULTIPLIERS:rates}=require('../server/game/models/progression');
function mon(id=1,level=20){return factory.create(id,level,true);}
function fixture(){const a=mon(),b=mon(),bench=mon(),enemy=mon(19),p={id:'owner',equipe:{pokemons:[a,b,bench]}},events=[],io={to:id=>({emit:(name,payload)=>events.push({id,name,payload})})};return {a,b,bench,enemy,p,events,io,t:new AdventureExperience()};}
test('participation is per opponent and rewards living entrants equally, once, independently of team order',()=>{
 const {a,b,bench,enemy,p,events,io,t}=fixture(),other=mon(16),before=[a,b,bench].map(m=>m.experience),share=Math.floor(xp(enemy,rates.trainer,a)/2);
 t.enter(a,enemy);t.enter(a,enemy);t.enter(b,enemy);t.enter(b,other);p.equipe.pokemons=[b,bench,a];enemy.currentHp=0;
 const awards=t.reward(p,enemy,rates.trainer,io);assert.equal(awards.length,2);assert.equal(a.experience,before[0]+share);assert.equal(b.experience,before[1]+share);assert.equal(bench.experience,before[2]);assert.equal(a.ev.speed,0);assert.equal(b.ev.speed,1,'EV remain active-only');assert(events.every(e=>e.id==='owner'&&e.name==='battleExperience'));assert.deepEqual(t.reward(p,enemy,rates.trainer,io),[]);
 const priorA=a.experience,priorB=b.experience,full=xp(other,rates.trainer,b);other.currentHp=0;t.reward(p,other,rates.trainer,io);assert.equal(a.experience,priorA,'no participation against this opponent');assert.equal(b.experience,priorB+full);
});
test('KO, untouched reserves and entries after the enemy KO are excluded; each share uses its recipient level before any level-up',()=>{
 const {a,b,bench,enemy,p,io,t}=fixture();b.level=5;b.recalculateStats();a.level=60;a.recalculateStats();
 t.enter(a,enemy);t.enter(b,enemy);const expected=[a,b].map(poke=>Math.floor(xp(enemy,rates.wild,poke)/2)),before=[a.experience,b.experience,bench.experience];enemy.currentHp=0;t.enter(bench,enemy);t.reward(p,enemy,rates.wild,io);assert.deepEqual([a.experience-before[0],b.experience-before[1]],expected);assert.equal(bench.experience,before[2]);
 const f=fixture();f.t.enter(f.a,f.enemy);f.t.enter(f.b,f.enemy);f.a.currentHp=0;f.enemy.currentHp=0;const initial=f.b.experience,full=xp(f.enemy,rates.arena,f.b);f.t.reward(f.p,f.enemy,rates.arena,f.io);assert.equal(f.b.experience,initial+full);assert.equal(f.a.currentHp,0);
});
test('an unentered opponent, a capture/living foe and all participants KO give no XP and cannot be rewarded after healing',()=>{
 const f=fixture(),before=f.a.experience;f.t.enter(f.a,f.enemy);assert.deepEqual(f.t.reward(f.p,f.enemy,1,f.io),[]);f.a.currentHp=0;f.enemy.currentHp=0;assert.deepEqual(f.t.reward(f.p,f.enemy,1,f.io),[]);f.a.currentHp=10;assert.deepEqual(f.t.reward(f.p,f.enemy,1,f.io),[]);assert.equal(f.a.experience,before);
 const missing=mon(19);missing.currentHp=0;assert.deepEqual(f.t.reward(f.p,missing,1,f.io),[]);
});

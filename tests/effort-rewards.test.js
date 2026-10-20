const test=require('node:test'),assert=require('node:assert/strict');
const {effortYield,grantEffort}=require('../server/game/models/training');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const factory=require('../server/game/drift/pokemonFactory');
function mon(id=7){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Growl'];p.movePp=[40];return p;}
function owner(mode='rift'){return {userId:1,run:{mode,phase:'exploration'},equipe:{pokemons:[mon(),mon(4)]},items:{pokeball:3},drifts:[],equipped:[],defeated:new Set(),money:0};}
test('EV preview uses the exact species yield, includes mixed stats and never exposes a mutable catalog entry',()=>{
 assert.deepEqual(effortYield(mon(74)),{defense:1});assert.deepEqual(effortYield(mon(3)),{specialAttack:2,specialDefense:1});
 const copy=effortYield(mon(74));copy.defense=99;assert.deepEqual(effortYield(mon(74)),{defense:1});assert.equal(effortYield(null),null);
 const p=mon();p.ev={hp:252,attack:252,defense:6,specialAttack:0,specialDefense:0,speed:0};const before={...p.ev};grantEffort(p,mon(74));assert.deepEqual(p.ev,before);
 p.currentHp=0;assert.deepEqual(grantEffort(p,mon(74)),{});
});
for(const mode of ['rift','colosseum'])for(const success of [false,true])test(`${mode}: ${success?'successful':'failed'} capture awards EV only to the active fighter, without adding XP`,()=>{
 const p=owner(mode),active=p.equipe.pokemons[0],reserve=p.equipe.pokemons[1],enemy=mon(74),events=[];
 const b=new DriftBattle(p,{npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]},{emit:(_,name,payload)=>events.push({name,payload}),random:()=>success?0:.99,paceMs:0});
 const xp=active.experience,ev=active.ev.defense,teamEv={...reserve.ev},enemyEv={...enemy.ev};
 assert.deepEqual(events.find(e=>e.name==='introAnimation').payload.effortYield,{defense:1});
 assert(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}));
 assert.equal(active.ev.defense,ev+(success?1:0));assert.equal(active.experience,xp);assert.deepEqual(reserve.ev,teamEv);assert.deepEqual(enemy.ev,enemyEv);
 assert.equal(events.filter(e=>e.name==='battleExperience').length,0);
 if(success){assert(b.finished);assert.equal(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}),false);assert.equal(active.ev.defense,ev+1);}else b.finish(null,'fled');
});
test('PvP has no EV preview or reward, while NPC switches publish the new species yield',()=>{
 const p=owner(),q=owner();q.userId=2;const events=[];
 let b=new DriftBattle(p,q,{type:'pvp',emit:(_,name,payload)=>events.push({name,payload})});assert(events.filter(e=>e.name==='introAnimation').every(e=>e.payload.effortYield===null));b.finish(null,'fled');
 const a=owner(),enemy={npc:true,equipe:{pokemons:[mon(19),mon(74)]},drifts:[],equipped:[]};events.length=0;
 b=new DriftBattle(a,enemy,{type:'trainer',emit:(_,name,payload)=>events.push({name,payload})});enemy.equipe.pokemons[0].currentHp=0;b.prune();
 assert.deepEqual(events.filter(e=>e.name==='introAnimation').at(-1).payload.effortYield,{defense:1});b.finish(null,'fled');
});

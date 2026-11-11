const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),mutation=require('../server/game/corruption/pokemon'),modules=require('../server/game/corruption/modules'),balance=require('../server/game/corruption/balance'),codec=require('../server/game/drift/checkpointCodec');
const native=require('../server/game/raids/ruleset'),{RaidBattle}=require('../server/game/raids/RaidBattle');
const stats=['maxHp','attack','defense','specialAttack','specialDefense','speed'];
function make(id=9){const p=factory.create(id,100,true);p.iv=Object.fromEntries(Object.keys(p.iv).map(k=>[k,31]));p.ev={hp:252,attack:0,defense:0,specialAttack:252,specialDefense:6,speed:0};p.passiveAbility='Keen Eye';p.recalculateStats();p.abilities=['Tackle','Protect'];p.movePp=[35,10];return p;}
function apply(p,key){mutation.install(p,modules.get('cmod_'+key),{expectedRevision:p.corruption?.revision||0,expectedMoves:[...p.abilities],slot:p.abilities.length});}
function raid(){const p=[make(),make(143),make(135),make(195)],boss=make(248);boss.abilities=['Tackle','Crunch','Earthquake','Ice Beam'];boss.movePp=[35,15,10,10];return new RaidBattle(p.map((pokemon,i)=>({pokemon,ownerId:i+1,ownerName:'Test'})),boss,{seed:[1,2,3,4],now:()=>1000});}
test('four module penalties are additive on all six final stats, including after replacements, recalculation, SQL and checkpoints',()=>{
 const p=make(),base=Object.fromEntries(stats.map(k=>[k,p[k]]));let expected=0;
 for(const [key,n]of [['ability_levitate',5],['type_fire',4],['move_53',2],['offense_fire',1]]){
  apply(p,key);expected+=n;assert.equal(balance.penalty(p),expected);for(const stat of stats)assert.equal(p[stat],Math.max(1,Math.floor(base[stat]*(100-expected)/100)),stat);
 }
 apply(p,'ability_intimidate');assert.equal(balance.penalty(p),12);for(let i=0;i<3;i++)p.recalculateStats(true);for(const stat of stats)assert.equal(p[stat],Math.floor(base[stat]*88/100));
 const repo=require('../server/persistence/pokemonStorageRepository');p.currentHp=3;p.movePp[0]=2;const decoded=repo.decodePokemon(repo.encodePokemon(p));assert.equal(decoded.currentHp,3);assert.deepEqual(decoded.corruption,p.corruption);for(const stat of stats)assert.equal(decoded[stat],p[stat]);
 const checkpoint=codec.decode(codec.encode(p));for(const stat of stats)assert.equal(checkpoint[stat],p[stat]);assert.equal(checkpoint.currentHp,3);
 const doubles=require('../server/game/doubles/ruleset'),sim=native.create([[...Array(4)].map(()=>doubles.teamSet(p)),[doubles.teamSet(make(143))]],[1,2,3,4]),nativeP=sim.p1.pokemon[0];
 for(const [a,b]of Object.entries({maxHp:'hp',attack:'atk',defense:'def',specialAttack:'spa',specialDefense:'spd',speed:'spe'}))assert.equal(a==='maxHp'?nativeP.maxhp:nativeP.storedStats[b],p[a],a);
});
test('legacy suspended models gain the new malus exactly once while retaining battle boosts, K.O. and missing HP',()=>{
 const p=make(),base=Object.fromEntries(stats.map(k=>[k,p[k]]));p.corruption={version:1,revision:1,permanent:true,modules:{ability:{itemKey:'cmod_ability_levitate'}}};delete p.__corruptionStatPenalty;p.currentHp=0;p.currentAttack=p.attack*2;
 const q=codec.decode(codec.encode(p));assert.equal(q.currentHp,0);assert.equal(q.currentAttack,q.attack*2);for(const k of stats)assert.equal(q[k],Math.floor(base[k]*95/100));const r=codec.decode(codec.encode(q));assert.deepEqual(stats.map(k=>r[k]),stats.map(k=>q[k]));
});
test('legendary and mythical species cannot consume any corruption module, normal species remain eligible',()=>{
 for(const id of [...factory.legendary].filter(id=>id<=649))for(const key of ['ability_levitate','type_fire','move_53','offense_fire']){const p=make(id),before=JSON.stringify(p);assert.throws(()=>apply(p,key),/légendaires et fabuleux/);assert.equal(JSON.stringify(p),before);}
 const p=make(94);apply(p,'offense_fire');assert.equal(balance.penalty(p),1);
});
test('defensive module reduces matching direct damage by 30%, offensive module remains +20%',()=>{
 const a=make(),b=make();apply(a,'offense_fire');apply(b,'defense_fire');assert.equal(mutation.multiplier(a,b,{ename:'Flamethrower',type:'Fire'}),.84);assert.equal(mutation.multiplier(make(),b,{ename:'Flamethrower',type:'Fire'}),.7);assert.equal(mutation.multiplier(a,b,{ename:'Surf',type:'Water'}),1);
});
test('boss maximum HP gain is 15%, remains stable across resume, and rage caps at 110 / +66%',()=>{
 const b=raid(),plain=b.boss.maxHp;assert.equal(b.bossPokemon.maxhp,Math.ceil(plain*6*115/100));const hp=b.bossPokemon.maxhp;b.bossPokemon.hp-=17;const r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),b.now);assert.equal(r.bossPokemon.maxhp,hp);assert.equal(r.bossPokemon.hp,hp-17);
 const pressure=require('../server/game/raids/pressure');pressure.received(b.sim,b.bossPokemon,b.bossPokemon.maxhp,()=>{});assert.equal(pressure.view(b.sim).maximum,110);assert.equal(pressure.view(b.sim).value,110);assert.equal(pressure.view(b.sim).bonusPercent,66);assert(Math.abs(pressure.multiplier(b.sim)-1.66)<1e-12);
});
test('full HP no longer grants artificial survival but Focus Sash and Sturdy retain their native effects',()=>{
 for(const protection of [null,'sturdy','focussash']){const b=raid(),p=b.sim.p1.active[0];if(protection==='sturdy')p.setAbility(protection);if(protection==='focussash')p.setItem(protection);b.sim.damage(p.hp*3,p,b.bossPokemon,b.sim.dex.moves.get('tackle'));assert.equal(p.hp,protection?1:0,protection);assert(!b.sim.raid.events.some(e=>e.kind==='friendship'));}
});
test('boss PP never force Struggle, including after a cold checkpoint; all-disabled moves do not invent an attack',()=>{
 let b=raid();for(const slot of b.bossPokemon.moveSlots)slot.pp=0;b.planBoss();assert.equal(b.bossPlan.length,2);assert(b.bossPlan.every(m=>m!=='struggle'));b=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),b.now);for(const slot of b.bossPokemon.moveSlots)slot.pp=0;b.planBoss();assert(b.bossPlan.every(m=>m!=='struggle'));
 const count=b.sim.log.length;b.sim.runAction({choice:'move',pokemon:b.bossPokemon,move:b.sim.dex.moves.get('struggle'),targetLoc:1});assert(!b.sim.log.slice(count).some(l=>l.includes('|Struggle|')));
});
test('Safari legendary category is limited to 5% while Dark Continent final boss remains legendary',()=>{
 const rotation=require('../server/game/raids/rotation');let day,template;
 for(let n=1;n<=30&&!template;n++){const d='2026-11-'+String(n).padStart(2,'0'),r={map:'safari1'};const pool=rotation.pool(r.map,d);if(pool.some(id=>factory.legendary.has(id))&&pool.some(id=>!factory.legendary.has(id))){day=d;template=r;}}
 assert(template);let rare=0;for(let roll=0;roll<100;roll++){const r=rotation.populate({...template},day,null,n=>n===100?roll:0);if(factory.legendary.has(r.bossSpecies))rare++;}assert.equal(rare,5);
 const final=require('../server/game/world/darkContinent2').config.final.map;for(const id of rotation.pool(final,day))assert(factory.legendary.has(id));
});
test('every actual eligible raid species has four distinct independently usable damaging moves, never Struggle or status',()=>{
 const rotation=require('../server/game/raids/rotation'),habitats=require('../server/game/world/darkHabitats');const ids=new Set([...rotation.safariPool('2026-11-11'),...rotation.safariPool('2026-11-12'),...habitats.LAND.flat(),...habitats.WATER.flat(),...factory.legendary].filter(id=>id<=649));
 for(const id of ids){const set=rotation.bossSet(id,'balance-test');assert.equal(new Set(set.moves).size,4);for(const name of set.moves){const m=native.dex.moves.get(name);assert(m.exists&&m.id!=='struggle'&&m.category!=='Status'&&m.basePower>0&&!m.flags.charge&&!m.flags.recharge&&!m.selfdestruct,id+': '+name);}}
});

test('a legacy raid rebases only the affected ally once, keeps missing HP, PP, boosts and boss state through resume',()=>{
 const b=raid(),model=b.models[0].pokemon,p=b.sim.p1.pokemon[0],oldMax=p.maxhp,bossMax=b.bossPokemon.maxhp,pp=p.moveSlots.map(m=>m.pp);
 p.hp-=17;p.boosts.spa=2;model.corruption={version:1,revision:1,permanent:true,modules:{ability:{itemKey:'cmod_ability_intimidate'}}};delete model.__corruptionStatPenalty;
 const r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),b.now),q=r.sim.p1.pokemon[0];assert.equal(q.maxhp,Math.floor(oldMax*95/100));assert.equal(q.maxhp-q.hp,17);assert.equal(q.boosts.spa,2);assert.deepEqual(q.moveSlots.map(m=>m.pp),pp);assert.equal(r.bossPokemon.maxhp,bossMax);
 const next=RaidBattle.restore(codec.decode(codec.encode(r.snapshot())),b.now);assert.equal(next.sim.p1.pokemon[0].maxhp,q.maxhp);assert.equal(next.sim.p1.pokemon[0].hp,q.hp);
});

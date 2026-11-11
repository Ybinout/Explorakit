const test=require('node:test'),assert=require('node:assert/strict');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids');
const report=require('../server/game/raids/report'),codec=require('../server/game/drift/checkpointCodec');
function setup(owners=[1,2,3,4],reactive=true){
 const p=[135,9,143,195].map((id,i)=>({ownerId:owners[i],ownerName:'Dresseur '+owners[i],pokemon:make(id,100,4,['Tackle','Heal Pulse','Wish','Giga Drain'],'Keen Eye')}));
 for(const e of p)e.pokemon.heldItem=null;
 const boss=make(143,100,4,['Splash'],'Keen Eye');boss.heldItem=null;
 return new RaidBattle(p,boss,{seed:[1,2,3,4],reactive});
}
const totals=b=>report.view(b).trainers;
function cold(b){return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())));}
for(const reactive of [true,false])test(`raid report counts real HP and shield damage without overkill (${reactive?'reactive':'classic'})`,()=>{
 const b=setup(undefined,reactive),s=b.sim,a=s.p1.active[0],boss=b.bossPokemon;
 s.damage(40,boss,a,s.dex.moves.get('tackle'));assert.equal(totals(b)[0].damage,40);
 s.raid.shield={hp:25,max:25};s.damage(100,boss,a,s.dex.moves.get('tackle'));
 assert.equal(totals(b)[0].damage,65);assert.equal(totals(b)[0].shield,25);
 s.raid.shieldsUsed=2;boss.hp=7;s.damage(10000,boss,a,s.dex.moves.get('tackle'));
 assert.equal(totals(b)[0].damage,72);assert.equal(totals(b)[0].shield,25);
});
test('heals credit the healer, only actual recovered HP; friendly fire and healing the boss are excluded',()=>{
 const b=setup(),s=b.sim,[a,d]=s.p1.active;d.hp-=10;
 s.heal(1000,d,a,s.dex.moves.get('healpulse'));assert.equal(totals(b)[0].healing,10);assert.equal(totals(b)[1].healing,0);
 s.heal(1000,d,a,s.dex.moves.get('healpulse'));assert.equal(totals(b)[0].healing,10);
 s.damage(20,d,a,s.dex.moves.get('tackle'));assert.equal(totals(b)[0].damage,0);
 b.bossPokemon.hp-=100;s.heal(100,b.bossPokemon,a,s.dex.moves.get('healpulse'));assert.equal(totals(b)[0].healing,10);
 a.hp-=30;s.heal(25,a,b.bossPokemon,'drain');assert.equal(totals(b)[0].healing,35);
 a.hp-=10;s.heal(5,a,a,s.dex.items.get('leftovers'));assert.equal(totals(b)[0].healing,40);
 d.hp=0;s.heal(100,d,a,s.dex.moves.get('healpulse'));assert.equal(totals(b)[0].healing,40);
});
test('poison residuals credit their author; solo totals, cold restores and repeated views do not duplicate',()=>{
 const b=setup([1,1,2,2]),s=b.sim,a=s.p1.active[1],boss=b.bossPokemon;
 boss.setStatus('psn',a,s.dex.moves.get('toxic'));s.damage(100,boss,boss,s.dex.conditions.get('psn'));
 assert.equal(totals(b)[0].damage,30);assert.equal(totals(b)[0].pokemon[1].damage,30);
 const saved=report.view(b),r=cold(b);assert.deepEqual(report.view(r),saved);assert.deepEqual(report.view(r),saved);
 r.sim.damage(10,r.bossPokemon,r.sim.p1.active[0],r.sim.dex.moves.get('tackle'));
 assert.equal(totals(r)[0].damage,40);assert.equal(totals(r)[0].pokemon.length,2);
 r.retreat(1);assert.equal(totals(r)[0].damage,40);
 const solo=setup([1,1,1,1]);assert.equal(totals(solo).length,1);assert.equal(totals(solo)[0].pokemon.length,4);
});
test('native offensive and healing moves, Wish, withdrawal and result payload retain participant attribution',()=>{
 let b=setup(),s=b.sim,[a,d]=s.p1.active;
 const hp=b.bossPokemon.hp;s.actions.useMove('tackle',a,{target:b.bossPokemon});assert.equal(totals(b)[0].damage,hp-b.bossPokemon.hp);
 d.hp-=50;s.actions.useMove('healpulse',a,{target:d});assert.equal(totals(b)[0].healing,50);
 s.actions.useMove('wish',a);assert.equal(totals(b)[0].healing,50);
 s.turn++;d.hp-=35;
 s.runAction({choice:'move',pokemon:d,move:s.dex.moves.get('tackle'),targetLoc:1});
 assert.equal(totals(b)[0].healing,85);
 const before=report.view(b);b=cold(b);b.sim.win('p2');
 assert.deepEqual(b.view(1).report,before);assert.deepEqual(b.view(2).report,before);
});
test('AI projections do not affect totals and old snapshots are explicitly partial',()=>{
 const b=setup(),s=b.sim;s.raid.threatProjection=true;
 s.damage(20,b.bossPokemon,s.p1.active[0],s.dex.moves.get('tackle'));
 s.p1.active[1].hp-=50;s.heal(40,s.p1.active[1],s.p1.active[0],s.dex.moves.get('healpulse'));
 assert.equal(totals(b)[0].damage,0);assert.equal(totals(b)[0].healing,0);
 delete s.raid.threatProjection;delete s.raid.report;
 const old=cold(b);assert.equal(report.view(old).partial,true);
 old.sim.damage(5,old.bossPokemon,old.sim.p1.active[0],old.sim.dex.moves.get('tackle'));assert.equal(totals(old)[0].damage,5);
});
test('Poison Heal credits its holder and Pain Split counts actual redistribution, not its requested amount',()=>{
 const b=setup(),s=b.sim,[a]=s.p1.active,boss=b.bossPokemon;
 a.setAbility('poisonheal');a.hp-=100;
 a.setStatus('psn',boss,s.dex.moves.get('toxic'));
 const hp=a.hp;s.damage(50,a,boss,s.dex.conditions.get('psn'));
 assert.equal(totals(b)[0].healing,a.hp-hp);assert(totals(b)[0].healing>0);
 const healed=totals(b)[0].healing;a.hp=10;const beforeBoss=boss.hp;
 s.actions.useMove('painsplit',a,{target:boss});
 assert.equal(totals(b)[0].damage,beforeBoss-boss.hp);
 assert.equal(totals(b)[0].healing,healed+a.hp-10);
});

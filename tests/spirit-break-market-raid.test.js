const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids');
function pokemon(id,ability='Keen Eye'){const p=factory.create(id,100,true);p.passiveAbility=ability;p.heldItem=null;p.abilities=['Spirit Break'];p.movePp=[15];return p;}
function hit(attackAbility='Keen Eye',defendAbility='Keen Eye',protect=false){const a=pokemon(235,attackAbility),b=pokemon(143,defendAbility),s=engine.createBattleState();if(protect){b.__battle={statStages:{},protect:true};}const result=engine.useattack('Spirit Break',a,b,{battleState:s,attackerSide:s.sides.player,defenderSide:s.sides.enemy});return {a,b,result};}
test('Choc Émotionnel is a physical Fairy contact move, with one secondary SpA drop',()=>{
 const m=engine.getMoveByName('Spirit Break');assert.deepEqual([m.type,m.power,m.accuracy,m.pp,m.combat.damage_class],['Fairy',75,100,15,'physical']);
 const x=hit();assert(x.result.damage>0);assert.equal(x.b.__battle.statStages.specialAttack,-1);assert.equal(x.a.movePp[0],14);
 const sheer=hit('Sheer Force');assert(sheer.result.damage>0);assert.equal(sheer.b.__battle.statStages.specialAttack,0);
 const dust=hit('Keen Eye','Shield Dust');assert(dust.result.damage>0);assert.equal(dust.b.__battle.statStages.specialAttack,0);
 const shield=hit('Keen Eye','Keen Eye',true);assert.equal(shield.result.damage,0);assert.equal(shield.b.__battle.statStages.specialAttack,0);
 const machine=require('../data/game/machines.json').machines.cs_spirit_break;assert.deepEqual(machine.species,[235]);assert.equal(machine.move,'Spirit Break');
 assert.equal(require('../vue-explorakit/src/data/gameNames.fr.json').moves['Spirit Break'],'Choc Émotionnel');
});
test('Choc Émotionnel works in the doubles and raid simulators',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle');
 const create=(id,moves)=>make(id,100,4,moves,'Keen Eye');
 const players=[0,1].map(id=>({id,username:'T'+id,equipe:{pokemons:[create(143,id?['Splash']:['Spirit Break']),create(143,['Splash'])]}}));
 const d=new DoublesBattle(...players,{emit(){}}),target=d.sim.p2.active[0],hp=target.hp;
 d.sim.actions.runMove('spiritbreak',d.sim.p1.active[0],1);assert(target.hp<hp);assert.equal(target.boosts.spa,-1);
 const b=raid(),p=b.sim.p1.active[0];b.bossPokemon.setItem('');p.moveSlots[0]={...p.moveSlots[0],move:'Spirit Break',id:'spiritbreak',pp:15,maxpp:15,target:'normal'};
 const bossHp=b.bossPokemon.hp;b.action(1,{token:b.token,slot:0,action:'attack',moveIndex:0,targetLoc:1});
 for(let i=1;i<4;i++)b.action(i+1,{token:b.token,slot:i,action:'attack',moveIndex:0,targetLoc:1});
 assert(b.bossPokemon.hp<bossHp);assert.equal(b.bossPokemon.boosts.spa,-1);
});
function raid(){const mon=id=>make(id,100,4,['Splash'],'Keen Eye');return new RaidBattle([0,1,2,3].map(i=>({ownerId:i+1,ownerName:'T',pokemon:mon(143)})),mon(143),{reactive:false,seed:[1,2,3,4]});}
test('raid poison residual damage alone is reduced 70% on boss; allies and attacks are unchanged',()=>{
 for(const effect of ['psn','tox']){const b=raid(),p=b.bossPokemon,s=b.sim,old=p.hp;s.damage(100,p,p,s.dex.conditions.get(effect));assert.equal(old-p.hp,30,effect);
 const a=s.p1.active[0],ally=a.hp;s.damage(100,a,a,s.dex.conditions.get(effect));assert.equal(ally-a.hp,100,effect+' ally');
 const before=p.hp;s.damage(100,p,a,s.dex.moves.get('sludgebomb'));assert.equal(before-p.hp,100,'direct Poison attack');}
});
test('reduced poison is preserved across checkpoint restore and respects normal shields',()=>{
 const b=raid(),boss=b.bossPokemon,s=b.sim;const before=boss.hp;s.damage(10,boss,boss,s.dex.conditions.get('psn'));assert.equal(before-boss.hp,3);
 const codec=require('../server/game/drift/checkpointCodec'),r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000),hp=r.bossPokemon.hp;r.sim.damage(10,r.bossPokemon,r.bossPokemon,r.sim.dex.conditions.get('tox'));assert.equal(hp-r.bossPokemon.hp,3);
 r.sim.raid.shield={hp:500,max:500};const shield=r.sim.raid.shield.hp,old=r.bossPokemon.hp;r.sim.damage(100,r.bossPokemon,r.bossPokemon,r.sim.dex.conditions.get('psn'));assert.equal(old-r.bossPokemon.hp,30);assert.equal(r.sim.raid.shield.hp,shield);
});
test('actual end-of-turn poison and badly poisoned raid boss use the reduced native residual',()=>{
 for(const status of ['psn','tox']){
  const b=raid(),p=b.bossPokemon;p.setStatus(status);const hp=p.hp;
  for(let i=0;i<4;i++)b.action(i+1,{token:b.token,slot:i,action:'attack',moveIndex:0,targetLoc:1});
  const raw=Math.floor(p.baseMaxhp/(status==='psn'?8:16));
  assert.equal(hp-p.hp,Math.max(1,Math.floor(raw*.3)),status);
 }
});

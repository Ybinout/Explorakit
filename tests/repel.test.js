const test=require('node:test'),assert=require('node:assert/strict');
const {remainingRepel,repelDuration,validateRepel,stepRepel,repelsWild}=require('../server/game/items/repel');
const economy=require('../server/game/drift/economy');
const {buildPositionSnapshot,positionsAreEqual,toPublicPlayer}=require('../server/realtime/playerState');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
const {getShopCatalog}=require('../server/game/world/shopCatalog');
const party=()=>({repelSteps:0,equipe:{pokemons:[{level:40,currentHp:0},{level:12,currentHp:20},{level:99,currentHp:40}]}});
test('trois Repousse vendus dans chaque mode, durées et prix progressifs',()=>{
 for(const expedition of [false,true]){
  const catalog=getShopCatalog({expedition,mapName:'ville1_shop',flags:{hoze_defeated:'true'}});
  for(const [key,steps,price]of [['repel',100,350],['super_repel',200,500],['max_repel',250,700]]){
   assert.equal(repelDuration(key),steps);assert.equal(catalog.find(i=>i.key===key).price,price);
  }
 }
 assert.throws(()=>repelDuration('potion'));
});
test('le premier apte protège des niveaux strictement inférieurs, jamais des niveaux égaux',()=>{
 const p=party();p.repelSteps=2;const protection=stepRepel(p);
 assert.equal(protection.level,12);assert(repelsWild(protection,{level:11}));assert(!repelsWild(protection,{level:12}));assert(!repelsWild(protection,{level:13}));assert.equal(p.repelSteps,1);
});
test('le dernier pas reste protégé puis les rencontres reprennent sans compteur négatif',()=>{
 const p=party();p.repelSteps=1;const last=stepRepel(p);
 assert(last.expired);assert(repelsWild(last,{level:1}));assert.equal(remainingRepel(p),0);assert.equal(stepRepel(p),null);assert(!repelsWild(stepRepel(p),{level:1}));
});
test('changement d’ordre/niveau pris en compte au prochain pas, réserve surpuissante ignorée',()=>{
 const p=party();p.repelSteps=10;assert.equal(stepRepel(p).level,12);p.equipe.pokemons.reverse();assert.equal(stepRepel(p).level,99);p.equipe.pokemons[0].level=100;assert.equal(stepRepel(p).level,100);
});
test('activation sans cible refusée sans compagnon apte ou si protection déjà active',()=>{
 const p=party();assert.equal(validateRepel(p,'max_repel'),250);p.repelSteps=4;assert.throws(()=>validateRepel(p,'repel'),/déjà actif/);p.repelSteps=0;p.equipe.pokemons.forEach(poke=>poke.currentHp=0);assert.throws(()=>validateRepel(p,'repel'),/apte/);
});
test('expédition : stock consommé une fois, hors combat/exploration uniquement, aucun cumul',()=>{
 const p={...party(),alive:true,inbattle:false,run:{phase:'exploration'},items:{repel:2,super_repel:1},drifts:[],equipped:[]};
 const result=economy.useRepel(p,'repel');assert.equal(result.repelSteps,100);assert.equal(p.items.repel,1);assert.equal(result.items.find(i=>i.key==='repel').repelSteps,100);
 assert.throws(()=>economy.useRepel(p,'super_repel'),/déjà actif/);assert.equal(p.items.super_repel,1);
 p.repelSteps=0;p.inbattle=true;assert.throws(()=>economy.useRepel(p,'repel'));p.inbattle=false;p.run.phase='colosseum_ready';assert.throws(()=>economy.useRepel(p,'repel'));assert.equal(p.items.repel,1);
 p.run.phase='exploration';assert.throws(()=>economy.useRepel(p,'max_repel'),/sac/);assert.equal(p.repelSteps,0);
});
test('compteur privé dans la sauvegarde position et les checkpoints, anciens checkpoints compatibles',()=>{
 const p={...party(),x:16,y:48,currentmap:'start',repelSteps:73};const snapshot=buildPositionSnapshot(p);
 assert.equal(snapshot.repelSteps,73);assert(!positionsAreEqual(snapshot,{...snapshot,repelSteps:72}));assert(positionsAreEqual({...snapshot,repelSteps:0},{...snapshot,repelSteps:undefined}));assert(!('repelSteps' in toPublicPlayer(p)));
 const saved=decode(encode(p));assert.equal(saved.repelSteps,73);assert.equal(stepRepel(saved).remaining,72);delete p.repelSteps;assert.equal(remainingRepel(decode(encode(p))),0);
});

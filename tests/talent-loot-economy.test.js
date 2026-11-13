const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/talents/rules'),fx=require('../server/game/talents/effects'),dc=require('../server/game/world/darkContinent');
const wrap=b=>({__trainerTalents:b});
function plates(count=30){let n={};for(const node of rules.catalog.nodes.filter(n=>n.source==='plates'&&!n.ultimate).slice(0,count))n=rules.buy(n,node.id);return n;}
test('right-hand plate paths invest thirty points for25%, then one ultimate for35%; XP shares the existing budget',()=>{
 const list=rules.catalog.nodes.filter(n=>n.source==='plates'&&!n.ultimate);assert.equal(list.length,30);assert.equal(list.reduce((s,n)=>s+n.bonus,0),25);
 let n=plates(29);assert.match(rules.availability(n,'experience_plates_ultimate'),/30 points/);
 n=plates();assert.equal(rules.points(n).branches.experience,30);assert.equal(rules.bonuses(n).darkPlateChance,25);assert.equal(rules.bonuses(n).sharedExperience,0);
 n=rules.buy(n,'experience_plates_ultimate');const b=rules.bonuses(n);assert.equal(b.darkPlateChance,35);assert.equal(b.globalExperience,0);assert.equal(rules.points(n).branches.experience,31);
 assert.throws(()=>rules.buy(n,'experience_1_1'),/31 points/);assert.throws(()=>rules.buy(n,'experience_ultimate'),/31 points/);assert.throws(()=>rules.refund(n,list.at(-1).id),/ultime/);
 n=rules.refund(n,'experience_plates_ultimate');n=rules.refund(n,list.at(-1).id);assert.equal(rules.points(n).branches.experience,29);
 assert.deepEqual(rules.catalog,require('../vue-explorakit/src/data/talentTree.json'));
});
test('shared budget also accepts mixed XP/plate paths; pre-existing XP selections retain every bonus and cost',()=>{
 let n=plates(23);for(let i=1;i<=7;i++)n=rules.buy(n,'experience_1_'+i);assert.equal(rules.points(n).branches.experience,30);
 n=rules.buy(n,'experience_plates_ultimate');assert.equal(rules.bonuses(n).sharedExperience,9);assert.equal(rules.bonuses(n).globalExperience,0);
 assert.equal(rules.byId.get('experience_ultimate').cost.money,5000000);assert.equal(rules.catalog.maxPoints,124);
});
test('raid payouts are exactly80% and every Tower payout120% of previous floored gains, with or without saved talent profiles',()=>{
 for(const version of[1,2,3])for(const b of[null,{version,money:{raid:61,tower:60,wild:105},globalMoney:15}])for(const amount of[0,1,101,10000,3456789]){
  for(const[source,factor]of[['raid',.8],['tower',1.2],['wild',1],['trainer',1],['expedition',1]]){
   const old=Math.floor(amount*(1+((b?.money?.[source]||0)+(b?.globalMoney||0))/100));assert.equal(fx.money(amount,source,wrap(b)),Math.floor(old*factor));
  }
 }
 const prizes=require('../server/game/superTournament/cashPrizes'),cards=require('../server/game/superTournament/augmentations');
 assert.equal(cards.grant('prize_money_10k',1).amount,Math.floor(Math.round(1590*prizes.MONEY_MULTIPLIER)*1.2));
});
test('normal Dark island/mainland plate chance gets a relative35% boost; crystal chances, quantities and elite loot stay intact',()=>{
 const b=wrap(rules.bonuses(rules.buy(plates(),'experience_plates_ultimate'))),pokemon={data:{type:['Water']}};
 for(const map of['jungle1','jungle2','jungle3','jungle9','DC2_44','DC2_01']){
  const chance=dc.lootProfile(map).plateChance,draw=chance*1.2;
  assert(Math.abs(fx.plateChance(chance,b)-chance*1.35)<1e-12);
  const roll=()=>{const values=[];for(const[,chance]of dc.lootProfile(map).crystals){values.push(.999);if(chance===1)values.push(.999);}values.push(draw,0);return()=>values.length?values.shift():.999;};
  assert(!dc.loot(pokemon,roll(),map).some(i=>i.plateType));
  const found=dc.loot(pokemon,roll(),map,b);assert.deepEqual(found.filter(i=>i.plateType).map(i=>[i.key,i.quantity]),[['dark_plate_water',1]]);
  assert.deepEqual(dc.loot(pokemon,()=>0,map,b).filter(i=>!i.plateType),dc.loot(pokemon,()=>0,map).filter(i=>!i.plateType));
  const elite={...pokemon,darkContinentEncounter:{version:1,map,kind:'corrupted'}};assert.deepEqual(dc.loot(elite,()=>.5,map,b),dc.loot(elite,()=>.5,map));
 }
 assert.equal(fx.plateChance(.9,b),1);assert.equal(fx.plateChance(.24,null),.24);assert.equal(fx.experience(1000,b),1000);assert.equal(fx.money(1000,'wild',b),1000);
});

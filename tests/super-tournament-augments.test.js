const test=require('node:test'),assert=require('node:assert/strict');
const aug=require('../server/game/superTournament/augmentations'),rewards=require('../server/game/superTournament/rewards');
const {getMaxMovePp,getItemDefinition}=require('../server/game/battle/battleResources');
const healthy=()=>[{uuid:'test',name:'Test',currentHp:100,maxHp:100,status:'normal',abilities:['Tackle'],movePp:[getMaxMovePp('Tackle')],experience:9000,level:25,heldItem:'leftovers'}];
test('fixed per-offer probabilities: 30% money, 2% Super Candy, 0.2% Mega Candy',()=>{
 const counts={};for(let i=0;i<10000;i++){let first=true;const key=aug.draw(()=>{if(first){first=false;return(i+.5)/10000;}return .1;});counts[key||'none']=(counts[key||'none']||0)+1;}
 assert.deepEqual(counts,{prize_mega_candy:20,prize_super_candy:200,prize_money_10k:3000,none:6780});
 for(const [roll,key]of [[0,'prize_money_10k'],[.5999,'prize_money_10k'],[.6,'prize_money_25k'],[.8999,'prize_money_25k'],[.9,'prize_money_50k']]){let first=true;assert.equal(aug.draw(()=>{if(first){first=false;return .1;}return roll;}),key);}
 for(const roll of [-1,1,NaN,Infinity])assert.throws(()=>aug.draw(()=>roll));
});
test('at most one economic card, still four distinct choices; rarity does not rise for healthy teams',()=>{
 assert.equal(rewards.cards.length,34);assert.equal(aug.cards.length,5);
 for(let i=0;i<1000;i++){
  const rng=()=>{let n=i+1;return()=>((n=(n*1664525+1013904223)>>>0)/2**32);};
  const full=healthy(),hurt=healthy();hurt[0].currentHp=1;hurt[0].status='poison';hurt[0].movePp=[0];
  const a=rewards.createOffer(full,1,rng()),b=rewards.createOffer(hurt,1,rng());
  assert.equal(new Set(a.cards).size,4);assert.equal(new Set(b.cards).size,4);
  const extra=o=>o.cards.filter(k=>k.startsWith('prize_'));assert(extra(a).length<=1);assert.deepEqual(extra(a),extra(b));
  const view=rewards.viewOffer(b,hurt);assert(view.choices.every(c=>c.usable));
 }
});
test('cash follows the cycle; candy uses existing level-limited items and cannot increase tournament XP',()=>{
 for(const [key,n]of [['prize_money_10k',2500],['prize_money_25k',12500],['prize_money_50k',25000]])for(const [room,mult]of [[1,1],[16,1],[17,2],[320,20]])assert.equal(aug.grant(key,room).amount,n*mult);
 for(const [key,item,max]of [['prize_super_candy','rare_candy',100],['prize_mega_candy','mega_candy',200]]){assert.equal(aug.grant(key,1).itemKey,item);assert.equal(getItemDefinition(item).fieldUse.maxLevel,max);}
 assert.equal(aug.grant('forged',1),null);assert.throws(()=>aug.grant('prize_money_10k',0));
});
test('account rewards require no target, ignore supplied amounts and preserve every Pokemon resource',()=>{
 for(const card of aug.cards){const t=healthy(),before=JSON.stringify(t),o={id:'offer',afterRoom:17,cards:[card.key,'heal_10','cure']};
  const view=rewards.viewOffer(o,t);assert(!view.canSkip);assert.equal(view.choices[0].target,'account');assert.equal(view.choices[0].usable,true);
  const result=rewards.applyChoice(o,t,{offerId:'offer',cardKey:card.key,amount:999999999,itemKey:'masterball',quantity:99});
  assert.deepEqual(result.grant,aug.grant(card.key,17));assert.deepEqual(result.changes,[]);assert.equal(JSON.stringify(t),before);
  assert.throws(()=>rewards.applyChoice(o,t,{offerId:'foreign',cardKey:card.key}));assert.throws(()=>rewards.applyChoice(o,t,{offerId:'offer',skip:true}));
 }
});

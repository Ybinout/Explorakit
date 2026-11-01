const test=require('node:test'),assert=require('node:assert/strict');
const rewards=require('../server/game/superTournament/rewards'),{getMaxMovePp}=require('../server/game/battle/battleResources');
function random(seed){let n=seed;return()=>((n=(n*1664525+1013904223)>>>0)/2**32);}
const states=[['healthy',100,35,'normal'],['only PP missing',100,34,'normal'],['hurt',75,35,'normal'],['hurt with missing PP',75,20,'normal'],['status only',100,35,'burn'],['KO',0,0,'normal']];
for(const [state,hp,pp,status]of states)test(`Renaissance stays legendary for ${state}, including rerolls`,()=>{
 const team=[{uuid:'a',currentHp:hp,maxHp:100,status,abilities:['Tackle'],movePp:[Math.min(pp,getMaxMovePp('Tackle'))]}],before=JSON.stringify(team),rng=random(74);let initial=0,rerolls=0;
 for(let i=0;i<5000;i++){
  const a=rewards.createOffer(team,1,rng),b=rewards.createOffer(team,1,rng,undefined,a.cards);
  for(const offer of [a,b]){assert.equal(offer.cards.length,4);assert.equal(new Set(offer.cards.map(rewards.familyOf)).size,4);}
  assert(b.cards.every(k=>!a.cards.includes(k)));
  initial+=a.cards.includes('full_reset');rerolls+=b.cards.includes('full_reset');
 }
 assert(initial>0&&initial<100,`${state}: ${initial}/5000 initial Renaissance offers`);
 assert(rerolls>0&&rerolls<100,`${state}: ${rerolls}/5000 rerolled Renaissance offers`);
 assert.equal(JSON.stringify(team),before);
});
test('a saved Renaissance choice keeps its effect and is never rerolled on reconnect',()=>{
 const team=[{uuid:'a',currentHp:0,maxHp:100,status:'burn',abilities:['Tackle'],movePp:[0],heldItem:null}],offer={id:'saved-reset',afterRoom:12,cards:['full_reset','pp_3','revive_25','cure']},before=JSON.stringify(offer);
 assert.equal(rewards.needsRepair(offer),false);assert.equal(rewards.ensureFour(offer,team,()=>{throw Error('unexpected redraw');}),false);assert.equal(JSON.stringify(offer),before);
 rewards.applyChoice(offer,team,{offerId:offer.id,cardKey:'full_reset',pokemonUuid:'a'});assert.equal(team[0].currentHp,100);assert.equal(team[0].status,'normal');assert.deepEqual(team[0].movePp,[getMaxMovePp('Tackle')]);assert.equal(team[0].heldItem,null);
});

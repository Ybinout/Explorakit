const test=require('node:test'),assert=require('node:assert/strict');
const rewards=require('../server/game/superTournament/rewards'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {getMaxMovePp}=require('../server/game/battle/battleResources'),{TournamentController}=require('../server/game/superTournament/controller');
const content=require('../server/game/superTournament/content');
const owner=()=>({currentmap:content.MAPS.room,drifts:[],equipped:[]});
function team(kind='mixed'){
 const party=[9,94,212].map(id=>factory.create(id,100,true));
 if(kind!=='healthy'){party[0].currentHp=1;party[0].status='poison';party[0].movePp=party[0].movePp.map(()=>0);if(kind==='mixed')party[1].currentHp=0;}
 return party;
}
function rng(seed){let n=seed;return()=>((n=(n*1664525+1013904223)>>>0)/2**32);}
function distinct(offer){assert.equal(offer.cards.length,4);assert.equal(new Set(offer.cards).size,4);assert.equal(new Set(offer.cards.map(rewards.familyOf)).size,4);assert(offer.cards.every(k=>rewards.familyOf(k)));}
test('families cover all cards, including every PP variant and mythic overlaps',()=>{
 assert(rewards.cards.every(c=>rewards.familyOf(c.key)));
 for(const key of ['pp_3','pp_5','all_pp_3','all_pp_5','full_pp','team_pp_5','power_mana'])assert.equal(rewards.familyOf(key),'pp');
 for(const key of ['heal_10','team_heal_50','full_restore','full_reset','power_miracle','power_fountain','power_vampire','power_sanctuary','pact_leech','pact_breath'])assert.equal(rewards.familyOf(key),'healing');
 for(const key of ['revive_25','revive_50','revive_100','team_revive_25','power_reunion'])assert.equal(rewards.familyOf(key),'revive');
 assert.equal(rewards.familyOf('cure'),rewards.familyOf('team_cure'));assert.equal(rewards.familyOf('pact_fortress'),rewards.familyOf('power_bastion'));assert.equal(rewards.familyOf('unknown'),null);
});
test('new offers and paid rerolls always contain four different families for healthy, hurt and KO parties',()=>{
 for(const kind of ['healthy','hurt','mixed']){const party=team(kind),before=codec.encode(party);for(let seed=1;seed<=2000;seed++){
  const random=rng(seed),o=owner(),offer=rewards.createOffer(party,seed,random,o);distinct(offer);
  const rerolled=rewards.createOffer(party,seed,random,o,offer.cards);distinct(rerolled);assert(rerolled.cards.every(k=>!offer.cards.includes(k)));
  assert(offer.cards.filter(k=>!k.startsWith('power_')&&!k.startsWith('pact_')&&!k.startsWith('next_')&&!k.startsWith('prize_')).length>=2);
 }assert.deepEqual(codec.encode(party),before);}
});
test('when recovery families are usable, every ordinary offer has one HP, PP, revive and status choice',()=>{
 const party=team();for(let seed=1;seed<100;seed++){const random=()=>.99,offer=rewards.createOffer(party,1,random,owner());distinct(offer);assert.deepEqual(offer.cards.map(rewards.familyOf).sort(),['healing','pp','revive','status']);assert(rewards.viewOffer(offer,party,owner()).choices.every(c=>c.usable));}
});
test('mythic PP and vampirism never coexist with equivalent lesser recovery or healing pact cards',()=>{
 const party=team(),pacts=require('../server/game/superTournament/twists').cards.filter(c=>c.kind==='pact'),weight=c=>c.rarity==='epic'?1:3;
 const index=pacts.findIndex(c=>c.key==='pact_leech'),selection=(pacts.slice(0,index).reduce((n,c)=>n+weight(c),0)+.5)/pacts.reduce((n,c)=>n+weight(c),0);
 for(const [roll,power]of [[.03,'power_mana'],[.006,'power_vampire']]){
  const values=[.99,roll,.20,selection],random=()=>values.length?values.shift():.99,offer=rewards.createOffer(party,1,random,owner());distinct(offer);assert(offer.cards.includes(power));assert.equal(offer.cards.filter(k=>rewards.familyOf(k)===rewards.familyOf(power)).length,1);
 }
});
test('old duplicate offers keep their UUID, room and rarest card, replacing only conflicts once',()=>{
 const party=team(),offer={id:'stable',afterRoom:42,cards:['pp_3','pp_5','all_pp_5','power_mana']},before=codec.encode(party);
 assert(rewards.needsRepair(offer));assert(rewards.ensureFour(offer,party,()=>.99));distinct(offer);assert(offer.cards.includes('power_mana'));assert.equal(offer.id,'stable');assert.equal(offer.afterRoom,42);assert.deepEqual(codec.encode(party),before);
 const saved=codec.encode(offer);assert.equal(rewards.ensureFour(offer,party,()=>{throw Error('second draw');}),false);assert.deepEqual(codec.encode(offer),saved);
});
test('unique saved choices do not get redrawn; short and unknown legacy offers are filled without family duplication',()=>{
 for(const cards of [[],['unknown'],['cure','team_cure'],['heal_10','pp_3','revive_25']]){const offer={id:'legacy',cards};assert(rewards.ensureFour(offer,team(),()=>.99));distinct(offer);}
 const offer={id:'already-good',cards:['heal_10','pp_3','revive_25','cure']},before=codec.encode(offer);assert.equal(rewards.ensureFour(offer,team(),()=>{throw Error('redraw');}),false);assert.deepEqual(codec.encode(offer),before);
});
function fixture(){let data=null,version=0,fail=false;const persist={load:async()=>({run:data?codec.decode(data):null,version}),save:async(_id,run,v)=>{assert.equal(v,version);if(fail){fail=false;throw Error('injected');}data=codec.encode(run);return ++version;}};
 const create=()=>new TournamentController({userId:1,emit:()=>{},travel:async()=>{},getPlayer:()=>({id:'owner',username:'Test'}),random:()=>.99,persist});return{c:create(),create,fail:()=>{fail=true;}};
}
test('load persists family repair without spending a reroll or changing team, score, room or cash; failed repair rolls back',async()=>{
 const f=fixture(),c=f.c;await c.register({pokemons:team()});await c.atomic(()=>{c.run.phase='reward';c.run.room=16;c.run.cleared=17;c.run.score=5100;c.run.reward={id:'saved',afterRoom:17,cards:['pp_3','pp_5','all_pp_5','full_pp']};});
 const before=codec.encode(c.run),loaded=f.create();f.fail();await assert.rejects(()=>loaded.load(),/injected/);assert.deepEqual(codec.encode(loaded.run),before);
 await loaded.load();distinct(loaded.run.reward);assert.equal(loaded.run.reward.id,'saved');assert.equal(loaded.run.room,16);assert.equal(loaded.run.score,5100);assert.deepEqual(loaded.run.rerolls,c.run.rerolls);assert.deepEqual(loaded.run.cash,c.run.cash);assert.deepEqual(codec.encode(loaded.run.player.equipe),codec.encode(codec.decode(before).player.equipe));
 const version=loaded.version,again=f.create();await again.load();assert.equal(again.version,version);assert.deepEqual(again.run.reward,loaded.run.reward);
});
test('twenty levels per completed cycle apply to every trainer, with real stat growth and unchanged sets',()=>{
 for(let slot=0;slot<16;slot++){const original=content.createTeam(slot).pokemons;
  for(const [cycle,levels]of [[1,[95,105,110]],[2,[115,125,130]],[3,[135,145,150]]]){
   const scaled=content.createTeam(cycle*16+slot).pokemons;assert.deepEqual(scaled.map(p=>p.level),levels);
   for(let i=0;i<3;i++){assert.equal(scaled[i].data.id,original[i].data.id);assert.equal(scaled[i].k,4);assert.deepEqual(scaled[i].iv,original[i].iv);assert.deepEqual(scaled[i].abilities,original[i].abilities);assert.equal(scaled[i].heldItem,original[i].heldItem);for(const stat of ['maxHp','attack','defense','specialAttack','specialDefense','speed'])assert(scaled[i][stat]>original[i][stat]);assert.equal(scaled[i].currentHp,scaled[i].maxHp);assert.deepEqual(scaled[i].movePp,scaled[i].abilities.map(getMaxMovePp));}
  }
 }
});

const test=require('node:test'),assert=require('node:assert/strict');
const fortune=require('../server/game/superTournament/fortune'),rewards=require('../server/game/superTournament/rewards'),rerolls=require('../server/game/superTournament/rerolls'),twists=require('../server/game/superTournament/twists'),cash=require('../server/game/superTournament/cashPrizes'),content=require('../server/game/superTournament/content');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine'),fx=require('../server/game/drift/driftEffects'),codec=require('../server/game/drift/checkpointCodec');
function rng(seed=19){return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);}
const owner=()=>({currentmap:content.MAPS.room,drifts:[],equipped:[],equipe:{pokemons:[factory.create(9,100,true),factory.create(94,100,true)]}});
test('two initial/cycle rerolls, +1 from a declined offer, current-cycle-only legacy compensation and idempotent upgrade',()=>{
 const run={room:0};assert.equal(rerolls.ensure(run).remaining,2);rerolls.grantSkip(run);assert.equal(run.rerolls.remaining,3);run.room=16;assert(rerolls.grantCycle(run));assert.equal(run.rerolls.remaining,5);assert(!rerolls.grantCycle(run));assert.equal(rerolls.view(run).perCycle,2);assert.equal(rerolls.view(run).perSkip,1);
 const legacy={room:79,rerolls:{remaining:0,spent:7,grantedThroughCycle:5}},before=legacy.rerolls;rerolls.ensure(legacy);assert.equal(legacy.rerolls.remaining,1);assert.equal(legacy.rerolls.spent,before.spent);const saved=codec.encode(legacy);rerolls.ensure(legacy);assert.deepEqual(codec.encode(legacy),saved);
});
test('fortune is a rare, target-free, attempt-only choice; choosing it leaves current cards and Adventure stats intact',()=>{
 const o=owner(),team=o.equipe.pokemons,before=codec.encode(team),offer={id:'fortune',afterRoom:1,cards:[fortune.KEY,'heal_10','pp_3','cure']};const copy=JSON.stringify(offer);
 assert.equal(rewards.viewOffer(offer,team,o).choices[0].rarity,'rare');rewards.applyChoice(offer,team,{offerId:'fortune',cardKey:fortune.KEY},o);assert(fortune.has(o));assert.equal(JSON.stringify(offer),copy);assert.deepEqual(codec.encode(team),before);assert.throws(()=>fortune.activate(o));assert(fortune.has(codec.decode(codec.encode(o))));assert(!fortune.has({...o,currentmap:'route1'}));assert.throws(()=>fortune.activate({...o,currentmap:'route1'}));assert(!rewards.viewOffer(offer,team,o).choices[0].usable);
});
test('fortune has a moderate draw rate and removes all commons from initial offers and repeated rerolls, without duplicate families or softlocks',()=>{
 const o=owner(),team=o.equipe.pokemons;team[0].currentHp=1;team[0].movePp.fill(0);team[1].currentHp=0;let count=0;
 for(let i=0;i<10000;i++)count+=fortune.draw(o,()=>i/10000)===fortune.KEY;assert.equal(count,600);
 fortune.activate(o);assert.equal(fortune.draw(o,()=>0),null);const random=rng();let old=[];
 for(let i=0;i<3000;i++){const offer=rewards.createOffer(team,1,random,o,old),v=rewards.viewOffer(offer,team,o);assert.equal(v.choices.length,4);assert.equal(new Set(offer.cards.map(rewards.familyOf)).size,4);assert(v.choices.every(c=>c.rarity!=='common'));assert(offer.cards.every(k=>!old.includes(k)));old=offer.cards;}
});
test('PP cards gain 8/15 for one move, 5/10 per move, and 10 team-wide, with exact caps and no fainted restoration',()=>{
 for(const[key,amount]of[['pp_3',8],['pp_5',15],['all_pp_3',5],['all_pp_5',10],['team_pp_5',10]]){const o=owner(),p=o.equipe.pokemons[0];p.abilities=['Tackle','Protect'];p.movePp=[0,0];o.equipe.pokemons[1].currentHp=0;o.equipe.pokemons[1].movePp.fill(0);const offer={id:key,afterRoom:1,cards:[key]};rewards.applyChoice(offer,o.equipe.pokemons,{offerId:key,cardKey:key,pokemonUuid:p.uuid,moveIndex:0},o);assert.equal(p.movePp[0],Math.min(amount,engine.getMoveByName('Tackle').pp));assert.equal(p.movePp[1],key==='pp_3'||key==='pp_5'?0:Math.min(amount,engine.getMoveByName('Protect').pp));assert(o.equipe.pokemons[1].movePp.every(n=>n===0));}
});
test('new conditional pacts apply their real benefits and light costs, are preview-safe and never affect Adventure',()=>{
 const o=owner(),a=o.equipe.pokemons[0],b=factory.create(143,100,true);a.passiveAbility=b.passiveAbility=null;a.heldItem=b.heldItem=null;fx.attach([a],o);fx.attach([b],{drifts:[],equipped:[]});const move=engine.getMoveByName('Tackle');twists.activate(o,'pact_opening');assert.equal(fx.multiplier(a,b,move,false),1.15);assert.equal(fx.speed(a),.97);a.currentHp--;assert.equal(fx.multiplier(a,b,move,false),1);twists.activate(o,'pact_last_stand');a.currentHp=Math.floor(a.maxHp/2);assert.equal(fx.multiplier(a,b,move,false),1.18);assert.equal(fx.multiplier(b,a,move,false),1.05);a.currentHp=a.maxHp;assert.equal(fx.multiplier(a,b,move,false),1.15);
 const before=codec.encode(o);twists.multiplier({...o,__preview:true},null,a,b,move);assert.deepEqual(codec.encode(o),before);assert.equal(twists.multiplier({...o,currentmap:'start'},null,a,b,move),1);
 const crit=owner();twists.activate(crit,'pact_spark');assert.equal(twists.criticalStage(crit),1);assert.throws(()=>twists.activate(crit,'pact_hunter'));assert.equal(twists.multiplier(crit,null,a,b,move),.95);
});
test('after-win pacts heal 8% and restore one PP only to living companions, never stats, items or XP',()=>{
 const o=owner(),[a,b]=o.equipe.pokemons;a.currentHp=1;a.movePp.fill(0);b.currentHp=0;b.movePp.fill(0);const keep=o.equipe.pokemons.map(p=>[p.experience,p.level,p.iv,p.ev,p.heldItem]);twists.activate(o,'pact_campfire');twists.activate(o,'pact_resupply');const changes=twists.afterWin(o);assert.equal(changes.length,1);assert.equal(a.currentHp,1+Math.floor(a.maxHp*.08));assert(a.movePp.every(n=>n===1));assert.equal(b.currentHp,0);assert(b.movePp.every(n=>n===0));assert.deepEqual(o.equipe.pokemons.map(p=>[p.experience,p.level,p.iv,p.ev,p.heldItem]),keep);assert.equal(twists.afterWin({...o,currentmap:'route1'}).length,0);
});
test('Lum Berries drop from six to two and replacements match strategic roles, only inside the tower',()=>{
 const source=JSON.stringify(require('../data/game/pnj_teams.json')),lum=[];for(let i=0;i<16;i++)for(const p of content.createTeam(i).pokemons){assert(require('../server/game/battle/battleResources').getItemDefinition(p.heldItem));if(p.heldItem==='lum_berry')lum.push([i,p.data.id]);}
 assert.deepEqual(lum,[[8,445],[12,373]]);for(const[i,id,key]of[[10,212,'expert_belt'],[11,282,'sitrus_berry'],[13,248,'chople_berry'],[14,130,'wacan_berry']])assert.equal(content.createTeam(i).pokemons.find(p=>p.data.id===id).heldItem,key);assert.equal(JSON.stringify(require('../data/game/pnj_teams.json')),source);
});
test('money rises exactly 10% at every uncapped cycle and card prizes, while earned receipts remain unchanged',()=>{
 for(let room=1;room<=96;room++){const c=Math.floor((room-1)/16)+1,n=(room-1)%16,old=[5440,10880,16320,21760][Math.floor(n/4)]*c+(n===15?54400*c:0);assert.equal(cash.quote(room).total,old*11/10);}
 assert.equal(cash.schedule().firstCycleTotal,299200);for(const[key,old]of[['prize_money_10k',1700],['prize_money_25k',8500],['prize_money_50k',17000]])assert.equal(require('../server/game/superTournament/augmentations').grant(key,33).amount,old*11/10*3);
 const run={room:3,cash:{version:1,paidThrough:3,earned:16320,last:{amount:5440}}},before=JSON.stringify(run.cash);cash.ensure(run);assert.equal(JSON.stringify(run.cash),before);
});

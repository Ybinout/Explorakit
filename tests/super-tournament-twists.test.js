const test=require('node:test'),assert=require('node:assert/strict');
const twists=require('../server/game/superTournament/twists'),rewards=require('../server/game/superTournament/rewards');
const fx=require('../server/game/drift/driftEffects'),engine=require('../server/game/battle/battleEngine'),signals=require('../server/game/drift/driftSignals');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {TournamentController}=require('../server/game/superTournament/controller');
const content=require('../server/game/superTournament/content'),humanAI=require('../server/game/battle/humanTrainerAI');
const owner=()=>({currentmap:content.MAPS.room,drifts:[],equipped:[]});
function pair(keys=[]){const a=factory.create(143,80,true),b=factory.create(143,80,true),o=owner();for(const p of[a,b]){p.passiveAbility=null;p.heldItem=null;engine.ensureBattleData(p);}for(const k of keys)twists.activate(o,k);fx.attach([a],o);fx.attach([b],{drifts:[],equipped:[]});return{a,b,o};}
function fixture(){let saved=null,version=0,fail=false;const events=[];
 const persist={load:async()=>({run:saved?codec.decode(saved):null,version}),save:async(_id,r,v)=>{assert.equal(v,version);if(fail){fail=false;throw Error('injected');}saved=r?codec.encode(r):null;return ++version;}};
 const create=()=>new TournamentController({userId:1,persist,random:()=>.99,getPlayer:()=>({id:'test',username:'Test'}),emit:(e,p)=>events.push([e,p]),travel:async()=>{}});
 return {c:create(),create,events,fail:()=>{fail=true;}};
}
async function draft(c,keys=['heal_10','heal_25','cure','pp_3']){await c.atomic(()=>{c.run.phase='reward';c.run.cleared=c.run.room+1;c.run.reward={id:'offer',afterRoom:c.run.cleared,cards:keys};});}
const party=()=>({pokemons:[factory.create(9,100,true),factory.create(94,100,true)]});
test('19 bargains and two next-opponent cards are unique, fully described and target-free',()=>{
 assert.equal(twists.cards.filter(c=>c.kind==='pact').length,19);assert.equal(twists.cards.filter(c=>c.kind==='opponent').length,2);assert.equal(rewards.cards.length,55);assert.equal(new Set(rewards.cards.map(c=>c.key)).size,55);
 for(const c of twists.cards){assert(c.description&&c.duration);if(c.kind==='pact')assert(c.boon&&c.cost);const o=owner(),team=party().pokemons,before=codec.encode(team),offer={id:'offer',cards:[c.key],afterRoom:1};
  const view=rewards.viewOffer(offer,team,o);assert(view.choices[0].usable);assert.deepEqual(view.choices[0].targets,[]);assert(!view.canSkip);rewards.applyChoice(offer,team,{offerId:'offer',cardKey:c.key,values:{critical:999}},o);assert.deepEqual(codec.encode(team),before);assert.equal(rewards.viewOffer(offer,team,o).choices[0].usable,false);assert.throws(()=>rewards.applyChoice(offer,team,{offerId:'offer',cardKey:c.key},o));
 }
});
test('absolute rare-card odds are 0.8% solo opponent, 4% duo, 35.2% bargain; no owned or excluded cards',()=>{
 const counts={};for(let i=0;i<10000;i++){let first=true;const k=twists.draw(owner(),()=>first?(first=false,(i+.5)/10000):.5);const kind=k?.startsWith('pact_')?'pact':k||'none';counts[kind]=(counts[kind]||0)+1;}
 assert.deepEqual(counts,{next_opponent_one:80,next_opponent_two:400,pact:3520,none:6000});
 const o=owner();for(const c of twists.cards.filter(c=>c.kind==='pact'))twists.activate(o,c.key);assert.equal(twists.draw(o,()=>.2),null);assert.equal(twists.draw(owner(),()=>.01,new Set(['next_opponent_two'])),null);
 for(const n of[-1,1,NaN,Infinity])assert.throws(()=>twists.draw(owner(),()=>n));
});
test('a bargain or reduced-opponent offer may be declined without forcing a malus or sacrificing leaderboard points',()=>{
 for(const key of['pact_cold_blood','next_opponent_one']){const o=owner(),team=party().pokemons,offer={id:'decline',afterRoom:1,cards:[key,'heal_10','heal_25','pp_3']},before=codec.encode({o,team});assert(rewards.viewOffer(offer,team,o).canDecline);const result=rewards.applyChoice(offer,team,{offerId:'decline',skip:true},o);assert.equal(result.name,'Récompense passée');assert.deepEqual(codec.encode({o,team}),before);}
});
test('four distinct offers retain at least two recovery choices, at most one twist and one mythic',()=>{
 const team=party().pokemons;team[0].currentHp=1;team[0].status='poison';team[0].movePp[0]=0;team[1].currentHp=0;
 for(let seed=1;seed<=1000;seed++){let n=seed;const random=()=>((n=(n*1664525+1013904223)>>>0)/2**32),o=owner(),offer=rewards.createOffer(team,1,random,o),view=rewards.viewOffer(offer,team,o);
  assert.equal(new Set(offer.cards).size,4);assert(view.choices.every(c=>c.usable));assert(offer.cards.filter(k=>twists.get(k)).length<=1);assert(offer.cards.filter(k=>k.startsWith('power_')).length<=1);assert(offer.cards.filter(k=>!twists.get(k)&&!k.startsWith('power_')&&!k.startsWith('prize_')).length>=2);
  const next=rewards.createOffer(team,1,random,o,offer.cards);assert(next.cards.every(k=>!offer.cards.includes(k)));
 }
});
test('crit bargain raises actual crit chance and Water damage without modifying saved stats',()=>{
 const {a,b,o}=pair(),move=engine.getMoveByName('Tackle'),old=Math.random,before=JSON.stringify(a);Math.random=()=>.1;
 try{let plain=engine.useattack('Tackle',a,b,{consumePp:false});assert(!plain.critical);b.currentHp=b.maxHp;twists.activate(o,'pact_hunter');fx.attach([a],o);const result=engine.useattack('Tackle',a,b,{consumePp:false});assert(result.critical);assert.equal(fx.multiplier(b,a,engine.getMoveByName('Surf'),false),1.25);assert.equal(fx.multiplier(b,a,move,false),1);assert.equal(a.attack,JSON.parse(before).attack);}
 finally{Math.random=old;}
});
test('speed malus applies alongside held items, Tailwind and paralysis; snapshots expose only public pacts to AI',()=>{
 const {a,b,o}=pair();a.heldItem='choice_scarf';const state=engine.createBattleState(),speed=engine.getBattleSpeed(a,state.sides.player,state,b);twists.activate(o,'pact_cold_blood');
 assert.equal(engine.getBattleSpeed(a,state.sides.player,state,b),Math.floor(speed*.9));state.sides.player.screens.tailwindTurns=2;a.status='paralyze';assert(engine.getBattleSpeed(a,state.sides.player,state,b)<=Math.floor(speed*.9)+1);
 const view=humanAI.publicPokemon(a);assert.deepEqual(view.__towerPactContext.superTournamentPacts,['pact_cold_blood']);assert.equal(view.__towerPactContext.__preview,true);assert(!('heldItem'in view));assert(!('pending'in view));
 const copy=structuredClone(view),base=structuredClone(view);delete base.__towerPactContext;assert(engine.getBattleSpeed(copy)<engine.getBattleSpeed(base));
 const messages=signals.capture(()=>engine.estimateDamage(a,b,engine.getMoveByName('Tackle')));assert.equal(messages.effects.length,0);
});
test('type, class, finisher and defensive tradeoffs affect only the specified direct damage',()=>{
 const {a,b,o}=pair();twists.activate(o,'pact_blaze');assert.equal(fx.multiplier(a,b,engine.getMoveByName('Flamethrower'),false),1.3);assert.equal(fx.multiplier(a,b,engine.getMoveByName('Tackle'),false),1);assert.equal(fx.multiplier(b,a,engine.getMoveByName('Surf'),false),1.3);
 twists.activate(o,'pact_mind');assert.equal(fx.multiplier(a,b,engine.getMoveByName('Psychic'),false),1.25);assert.equal(fx.multiplier(a,b,engine.getMoveByName('Tackle'),false),.8);assert.equal(fx.multiplier(a,b,engine.getMoveByName('Toxic'),false),1);
 const f=pair(['pact_execution']);assert.equal(fx.multiplier(f.a,f.b,engine.getMoveByName('Tackle'),false),.9);f.b.currentHp=Math.floor(f.b.maxHp*.35);assert.equal(fx.multiplier(f.a,f.b,engine.getMoveByName('Tackle'),false),1.3);
 const d=pair(['pact_veil']);assert.equal(fx.multiplier(d.b,d.a,engine.getMoveByName('Tackle'),false),1.15);assert.equal(fx.multiplier(d.b,d.a,engine.getMoveByName('Surf'),false),.8);
});
test('the damage estimator used by AI sees the same damage bargain, without mutating either fighter',()=>{
 const {a,b,o}=pair(),move=engine.getMoveByName('Tackle'),plain=engine.estimateDamage(a,b,move);twists.activate(o,'pact_glass');const before=codec.encode({a,b});const estimate=engine.estimateDamage(a,b,move);assert(estimate>=Math.floor(plain*1.2)-1);assert.deepEqual(codec.encode({a,b}),before);
 const old=Math.random;Math.random=()=>.99;try{assert(Math.abs(engine.calculateDamage(a,b,move)-estimate)<=2);}finally{Math.random=old;}
});
test('healing pacts use existing combat hooks, signal their name and keep their speed/type costs',()=>{
 const {a,b,o}=pair(['pact_leech','pact_breath']);a.currentHp=30;
 const captured=signals.capture(()=>fx.afterMove(a,b,{move:engine.getMoveByName('Tackle'),success:true,damage:40,effectiveness:1},{contact:false,status:()=>false,stage:()=>{}}));assert.equal(a.currentHp,36);assert(captured.effects.some(e=>e.name==='Soif de vie'));
 fx.endTurn(a);assert.equal(a.currentHp,36+Math.floor(a.maxHp*.05));assert.equal(twists.speed(o),.9);assert.equal(fx.multiplier(b,a,engine.getMoveByName('Flamethrower'),false),1.25);
});
test('ordinary Adventure/Rift/Colosseum stay unchanged; switching and checkpoint preserve attempt-only pacts',()=>{
 const {a,b,o}=pair(['pact_glass','pact_cold_blood']),restored=codec.decode(codec.encode({a,b,o}));assert.equal(fx.multiplier(restored.a,restored.b,engine.getMoveByName('Tackle'),false),1.2);assert.equal(fx.speed(restored.a),.9);fx.switched(restored.a,false);assert.equal(fx.speed(restored.a),.9);
 for(const map of['start','route1','rift_room','colosseum']){restored.o.currentmap=map;assert.equal(fx.speed(restored.a),1);assert.equal(fx.criticalStage(restored.a),0);assert.equal(fx.multiplier(restored.a,restored.b,engine.getMoveByName('Tackle'),false),1);assert.deepEqual(twists.active(restored.o),[]);}
});
test('one reroll initially, four fresh cards, no mutation of team/cash/score; stale claim rejected',async()=>{
 const f=fixture(),c=f.c;await c.register(party());await draft(c);const before=codec.encode(c.run.player.equipe),cash=codec.encode(c.run.cash),score=c.run.score,old=c.run.reward;
 await c.rerollReward({offerId:old.id});assert.notEqual(c.run.reward.id,old.id);assert(c.run.reward.cards.every(k=>!old.cards.includes(k)));assert.equal(c.run.rerolls.remaining,0);assert.equal(c.run.rerolls.spent,1);assert.deepEqual(codec.encode(c.run.player.equipe),before);assert.deepEqual(codec.encode(c.run.cash),cash);assert.equal(c.run.score,score);
 await assert.rejects(()=>c.claimReward({offerId:old.id,cardKey:old.cards[0]}),/disponible/);await assert.rejects(()=>c.rerollReward({offerId:c.run.reward.id}),/plus de relance/);const resumed=f.create();await resumed.load();assert.deepEqual(resumed.run.reward,c.run.reward);assert.deepEqual(resumed.run.rerolls,c.run.rerolls);
});
test('failed or invalid reroll keeps its token and old offer; concurrent duplicate requests only spend once',async()=>{
 const f=fixture(),c=f.c;await c.register(party());await draft(c);const before=codec.encode(c.run);f.fail();await assert.rejects(()=>c.rerollReward({offerId:'offer'}),/injected/);assert.deepEqual(codec.encode(c.run),before);await assert.rejects(()=>c.rerollReward({offerId:'forged'}));
 const results=await Promise.allSettled([c.execute(()=>c.rerollReward({offerId:'offer'})),c.execute(()=>c.rerollReward({offerId:'offer'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(c.run.rerolls.remaining,0);
});
test('each new cycle adds one token exactly once; unused tokens carry and legacy snapshots get one current-cycle token',async()=>{
 const f=fixture(),c=f.c;await c.register(party());for(const room of[15,31,47]){await c.atomic(()=>{c.run.room=room;c.run.phase='cleared';});await c.next();assert.equal(c.run.rerolls.remaining,Math.floor((room+1)/16)+1);assert.equal(await c.next(),false);const resumed=f.create();await resumed.load();assert.equal(resumed.run.rerolls.remaining,c.run.rerolls.remaining);}
 await c.atomic(()=>{delete c.run.rerolls;c.run.room=80;c.run.phase='ready';});const restored=f.create();await restored.load();assert.deepEqual(restored.run.rerolls,{remaining:1,grantedThroughCycle:6,spent:0});const again=f.create();await again.load();assert.equal(again.run.rerolls.remaining,1);
});
for(const count of[1,2])test(`next-opponent card keeps the ${count} strongest slots once, survives battle reconnect and credits only real KOs`,async()=>{
 const f=fixture(),c=f.c;await c.register(party());const key=count===1?'next_opponent_one':'next_opponent_two';await draft(c,[key,'heal_10','cure','pp_3']);await c.claimReward({offerId:'offer',cardKey:key});const re=f.create();await re.load();assert.equal(twists.pending(re.run.player).count,count);await re.next();await re.atomic(()=>re.startBattle());
 assert.equal(re.run.battle.originals.filter(p=>re.run.enemySlots.has(p.uuid)).length,count);assert.deepEqual(re.run.battle.b.equipe.pokemons.map(p=>p.level).sort((a,b)=>a-b),[75,85,90].slice(-count));assert.equal(twists.pending(re.run.player),null);
 const loaded=f.create();await loaded.load();assert.equal(loaded.run.battle.b.equipe.pokemons.length,count);await loaded.atomic(()=>{const b=loaded.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();loaded.reconcile();loaded.reconcile();});assert.equal(loaded.run.score,100*count);
 await loaded.claimReward({offerId:loaded.run.reward.id,skip:true});await loaded.next();await loaded.atomic(()=>loaded.startBattle());assert.equal(loaded.run.battle.b.equipe.pokemons.length,3);
});

const test=require('node:test'),assert=require('node:assert/strict');
const twists=require('../server/game/superTournament/twists'),powers=require('../server/game/superTournament/powers'),rewards=require('../server/game/superTournament/rewards');
const engine=require('../server/game/battle/battleEngine'),fx=require('../server/game/drift/driftEffects'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec'),ai=require('../server/game/battle/humanTrainerAI');
function fixture(){const a=factory.create(9,100,true),b=factory.create(143,100,true);for(const p of[a,b]){p.passiveAbility=null;p.heldItem=null;p.maxHp=p.currentHp=1000;engine.ensureBattleData(p);}const owner={currentmap:'super_tournament_room',equipe:{pokemons:[a]},drifts:[],equipped:[]};fx.attach([a],owner);fx.attach([b],{drifts:[],equipped:[]});return{a,b,owner};}
function close(a,b){assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);}
function offer(key,id){return{id,afterRoom:1,cards:[key,'heal_10','pp_3','cure']};}
for(const card of twists.cards.filter(c=>c.kind==='pact'))test(`${card.key}: two distinct choices stack, preserve the party and keep one entry`,()=>{
 const f=fixture(),before=JSON.stringify(f.owner.equipe);for(let i=0;i<2;i++){const o=offer(card.key,'choice'+i);assert(rewards.viewOffer(o,[f.a],f.owner).choices[0].usable);rewards.applyChoice(o,[f.a],{offerId:o.id,cardKey:card.key},f.owner);}
 assert.equal(twists.count(f.owner,card.key),2);assert.equal(twists.active(f.owner).length,1);assert.equal(twists.active(f.owner)[0].stacks,2);assert(twists.active(f.owner)[0].cumulativeDescription);assert.equal(f.owner.superTournamentPacts.length,1);assert.equal(JSON.stringify(f.owner.equipe),before);assert.equal(twists.count(codec.decode(codec.encode(f.owner)),card.key),2);
});
test('typed Fairy pacts affect Fairy attacks, apply their own costs and compound twice; AI sees the same public total',()=>{
 const {a,b,owner}=fixture();twists.activate(owner,'pact_fairy');twists.activate(owner,'pact_fairy');close(fx.multiplier(a,b,engine.getMoveByName('Moonblast'),false),1.25**2);close(fx.multiplier(b,a,engine.getMoveByName('Iron Head'),false),1.3**2);assert.equal(fx.multiplier(a,b,engine.getMoveByName('Surf'),false),1);
 const preview=ai.publicPokemon(a);close(fx.multiplier(preview,b,engine.getMoveByName('Moonblast'),false),1.25**2);const before=codec.encode(owner);twists.multiplier({...owner,__preview:true},null,a,b,engine.getMoveByName('Moonblast'));assert.deepEqual(codec.encode(owner),before);
});
test('power stacks: Bastion uses consecutive reductions, healing sums, and preview defense agrees at two copies',()=>{
 const {a,b,owner}=fixture();for(const key of['power_bastion','power_vampire','power_fountain','power_sanctuary']){powers.activate(owner,key);powers.activate(owner,key);assert.equal(powers.count(owner,key),2);}
 close(fx.multiplier(b,a,engine.getMoveByName('Tackle'),false),.36);close(fx.multiplier(b,ai.publicPokemon(a),engine.getMoveByName('Tackle'),false),.36);assert.equal(powers.value(owner,5),100);assert.equal(powers.value(owner,16),30);a.currentHp=10;fx.endTurn(a);assert.equal(a.currentHp,310);a.currentHp=1;assert.equal(powers.afterWin(owner)[0].amount,500);assert.equal(powers.active(codec.decode(codec.encode(owner))).find(p=>p.key==='power_bastion').stacks,2);
});
test('Phoenix copies add one fatal-hit survival each per battle and preserve used charges at checkpoint',()=>{
 const {a,b,owner}=fixture();powers.activate(owner,'power_phoenix');powers.activate(owner,'power_phoenix');a.currentHp=500;let before=a.currentHp;a.currentHp-=fx.directDamage(a,2000,b);fx.afterDamage(a,before,b);assert.equal(a.currentHp,200);
 const f=codec.decode(codec.encode({a,b,owner}));before=f.a.currentHp;f.a.currentHp-=fx.directDamage(f.a,2000,f.b);fx.afterDamage(f.a,before,f.b);assert.equal(f.a.currentHp,200);assert.equal(fx.states.get(f.a).phoenixUsed,2);assert.equal(fx.directDamage(f.a,2000,f.b),2000);fx.damage(f.a,200);assert.equal(f.a.currentHp,0);
});
test('Palette rewards changing attack types, penalizes repeating them and leaves the first move unchanged',()=>{
 const {a,b,owner}=fixture();twists.activate(owner,'pact_palette');twists.activate(owner,'pact_palette');const surf=engine.getMoveByName('Surf');assert.equal(fx.multiplier(a,b,surf,false),1);a.__battle.lastMoveUsed='Thunderbolt';close(fx.multiplier(a,b,surf,false),1.05**2);a.__battle.lastMoveUsed='Water Gun';close(fx.multiplier(a,b,surf,false),.98**2);
});
test('legacy keys mean one copy, new counters have bounded key sets, and no bonuses escape the attempt',()=>{
 const {a,b,owner}=fixture();owner.superTournamentPacts=['pact_glass','pact_glass'];owner.superTournamentPassives=['power_fountain'];assert.equal(twists.count(owner,'pact_glass'),1);assert.equal(powers.count(owner,'power_fountain'),1);twists.activate(owner,'pact_glass');powers.activate(owner,'power_fountain');assert.equal(twists.count(owner,'pact_glass'),2);assert.equal(powers.count(owner,'power_fountain'),2);assert.equal(owner.superTournamentPacts.length,1);
 for(const map of['start','route1','rift_room','colosseum']){owner.currentmap=map;assert.equal(fx.multiplier(a,b,engine.getMoveByName('Tackle'),false),1);assert.equal(powers.value(owner,16),0);assert.equal(twists.value(owner,5),0);assert.throws(()=>twists.activate(owner,'pact_glass'));assert.throws(()=>powers.activate(owner,'power_fountain'));}
});
test('ten modest common pacts can actually be drawn; Fortune removes them without weakening recovery/family guarantees',()=>{
 assert.equal(twists.cards.filter(c=>c.rarity==='common').length,10);const f=fixture();f.a.currentHp=1;f.a.status='poison';f.a.movePp.fill(0);let seed=77,random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296),found=new Set();
 for(let i=0;i<4000;i++){const o=rewards.createOffer([f.a],1,random,f.owner);assert.equal(o.cards.length,4);assert.equal(new Set(o.cards.map(rewards.familyOf)).size,4);assert(o.cards.filter(k=>!twists.get(k)&&!k.startsWith('power_')&&!k.startsWith('prize_')&&k!=='fortune_charm').length>=2);for(const k of o.cards)if(twists.get(k)?.rarity==='common')found.add(k);}
 assert.equal(found.size,10);require('../server/game/superTournament/fortune').activate(f.owner);for(let i=0;i<500;i++)assert(rewards.viewOffer(rewards.createOffer([f.a],1,random,f.owner),[f.a],f.owner).choices.every(c=>c.rarity!=='common'));
});
test('extremely long stack counts never turn damage or speed into Infinity, NaN, a negative value or immunity',()=>{
 const {a,b,owner}=fixture();for(const key of['pact_glass','pact_quickstep'])twists.activate(owner,key);owner.superTournamentPactStacks={pact_glass:1000000,pact_quickstep:1000000};powers.activate(owner,'power_bastion');owner.superTournamentPassiveStacks={power_bastion:1000000};for(const n of[fx.speed(a),fx.multiplier(a,b,engine.getMoveByName('Tackle'),false),fx.multiplier(b,a,engine.getMoveByName('Tackle'),false)])assert(Number.isFinite(n)&&n>0);
});

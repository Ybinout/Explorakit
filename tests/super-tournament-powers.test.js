const test=require('node:test'),assert=require('node:assert/strict');
const powers=require('../server/game/superTournament/powers'),rewards=require('../server/game/superTournament/rewards');
const fx=require('../server/game/drift/driftEffects'),signals=require('../server/game/drift/driftSignals'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {getMaxMovePp}=require('../server/game/battle/battleResources');
const owner=keys=>({currentmap:'super_tournament_room',superTournamentPassives:keys||[],drifts:[],equipped:[]});
function team(){return [{uuid:'a',data:{id:9},name:'A',currentHp:20,maxHp:100,status:'poison',abilities:['Tackle'],movePp:[0],experience:1000,level:20,heldItem:'leftovers'}, {uuid:'b',data:{id:94},name:'B',currentHp:0,maxHp:100,status:'burn',abilities:['Tackle'],movePp:[0],experience:2000,level:20,heldItem:null}];}
function choose(key,t,player){return rewards.applyChoice({id:'offer',afterRoom:1,cards:[key]},t,{offerId:'offer',cardKey:key},player);}
function fixture(keys){const a=factory.create(19,30,true),b=factory.create(19,30,true);for(const p of [a,b]){p.passiveAbility=null;p.heldItem=null;p.maxHp=100;p.currentHp=100;engine.ensureBattleData(p);}const p=owner(keys);p.equipe={pokemons:[a]};fx.attach([a],p,false,()=>.99);fx.attach([b],{drifts:[],equipped:[]},false,()=>.99);return {a,b,p};}
test('new offers contain four distinct cards, at most one power and one economic card',()=>{
 assert.equal(rewards.CHOICES,4);assert.equal(rewards.cards.length,65);const o=rewards.createOffer(team(),1,()=>0,owner());assert.equal(new Set(o.cards).size,4);assert.equal(o.cards.filter(k=>k.startsWith('power_')).length,1);assert.equal(o.cards.filter(k=>k.startsWith('prize_')).length,0);assert.equal(o.cards.filter(k=>k.startsWith('pact_')||k.startsWith('next_opponent_')).length,1);
 for(let seed=1;seed<=1000;seed++){let n=seed;const r=()=>((n=(n*1664525+1013904223)>>>0)/2**32),o=rewards.createOffer(team(),1,r,owner());assert.equal(new Set(o.cards).size,4);assert(o.cards.filter(k=>k.startsWith('power_')).length<=1);assert(o.cards.filter(k=>k.startsWith('prize_')).length<=1);}
});
test('power odds are fixed tickets; owned powers and useless restorations do not get rerolled',()=>{
 const counts={};for(let i=0;i<10000;i++){const k=powers.draw(owner(),()=>(i+.5)/10000,()=>true);counts[k||'none']=(counts[k||'none']||0)+1;}
 assert.equal(counts.none,9650);for(const c of powers.cards)assert.equal(counts[c.key],c.tickets);
 const p=owner(['power_vampire']);assert.equal(powers.draw(p,()=>.006,()=>true),null);assert.equal(powers.draw(owner(),()=>0,()=>false),null);
});
test('pending three-card offers gain just one normal card, once, retaining their identifier and choices',()=>{
 const o={id:'stable',afterRoom:8,cards:['prize_super_candy','heal_10','pp_3']},before=[...o.cards];assert(rewards.ensureFour(o,team(),()=>.5));assert.equal(o.id,'stable');assert.deepEqual(o.cards.slice(0,3),before);assert.equal(new Set(o.cards).size,4);assert(!o.cards[3].startsWith('power_'));assert.equal(rewards.ensureFour(o,team(),()=>{throw Error('reroll');}),false);
});
test('passives are unique, target-free, persisted by codec and have no instant heal or progression effect',()=>{
 const p=owner(),t=team(),before=JSON.stringify(t);for(const c of powers.cards.filter(c=>c.kind==='passive')){const result=choose(c.key,t,p);assert.equal(result.passive.key,c.key);assert.deepEqual(result.changes,[]);assert.throws(()=>choose(c.key,t,p));assert.equal(rewards.viewOffer({id:'offer',afterRoom:1,cards:[c.key]},t,p).choices[0].usable,false);}assert.equal(JSON.stringify(t),before);assert.equal(powers.active(p).length,5);assert.deepEqual(powers.active(codec.decode(codec.encode(p))),powers.active(p));assert.throws(()=>powers.activate({currentmap:'start'},'power_vampire'));
});
test('three exceptional recovery cards apply exactly, preserving XP, items and conscious/dead distinctions',()=>{
 for(const key of ['power_miracle','power_reunion','power_mana']){const t=team(),before=t.map(p=>[p.experience,p.level,p.heldItem]);const result=choose(key,t,owner());assert(result.changes.length);assert.deepEqual(t.map(p=>[p.experience,p.level,p.heldItem]),before);if(key==='power_miracle'){assert.deepEqual(t.map(p=>[p.currentHp,p.status,p.movePp[0]]),[[100,'normal',getMaxMovePp('Tackle')],[100,'normal',getMaxMovePp('Tackle')]]);}if(key==='power_reunion'){assert.equal(t[0].currentHp,20);assert.equal(t[1].currentHp,100);assert.equal(t[1].status,'normal');assert.deepEqual(t[1].movePp,[0]);}if(key==='power_mana'){assert.equal(t[0].movePp[0],getMaxMovePp('Tackle'));assert.equal(t[1].currentHp,0);assert.equal(t[1].movePp[0],0);}}
});
test('vampirism heals half the direct damage with its real combat signal and never exceeds maximum HP',()=>{
 const {a,b}=fixture(['power_vampire']);a.currentHp=20;const result={move:engine.getMoveByName('Tackle'),success:true,damage:40,effectiveness:1};const captured=signals.capture(()=>fx.afterMove(a,b,result,{contact:false,status:()=>false,stage:()=>{}}));assert.equal(a.currentHp,40);assert(captured.effects.some(e=>e.name==='Vampirisme royal'));a.currentHp=95;fx.afterMove(a,b,result,{contact:false,status:()=>false,stage:()=>{}});assert.equal(a.currentHp,100);
});
test('bastion reduces real engine damage; fountain heals 15% only for the active living Pokemon',()=>{
 const {a,b}=fixture(['power_bastion','power_fountain']);const move=engine.getMoveByName('Tackle');assert.equal(fx.multiplier(b,a,move,false),.6);const baseline=engine.calculateDamage(b,a,move);fx.detach([a]);const ordinary=engine.calculateDamage(b,a,move);assert(baseline<ordinary);const f=fixture(['power_fountain']);f.a.currentHp=20;fx.endTurn(f.a);assert.equal(f.a.currentHp,35);f.a.currentHp=0;fx.endTurn(f.a);assert.equal(f.a.currentHp,0);
});
test('phoenix works once per Pokemon per battle and checkpoint, without protecting residual damage',()=>{
 const {a,b,p}=fixture(['power_phoenix']);a.currentHp=50;const before=a.currentHp,loss=fx.directDamage(a,200,b);assert.equal(loss,30);a.currentHp-=loss;fx.afterDamage(a,before,b);assert.equal(a.currentHp,20);const restored=codec.decode(codec.encode({a,b,p}));assert.equal(fx.directDamage(restored.a,200,restored.b),200);fx.damage(restored.a,20);assert.equal(restored.a.currentHp,0);fx.attach([a],p,false,()=>.99);a.currentHp=50;assert.equal(fx.directDamage(a,200,b),30);
});
test('victory sanctuary heals all living allies, never revives, caps HP and is absent outside the tournament',()=>{
 const p=owner(['power_sanctuary']);p.equipe={pokemons:team()};let changes=powers.afterWin(p);assert.equal(changes[0].amount,25);assert.equal(p.equipe.pokemons[0].currentHp,45);assert.equal(p.equipe.pokemons[1].currentHp,0);p.equipe.pokemons[0].currentHp=98;assert.equal(powers.afterWin(p)[0].amount,2);p.currentmap='start';assert.deepEqual(powers.afterWin(p),[]);
});
test('ordinary Adventure, Rift and Colosseum owners keep all previous multipliers and hooks',()=>{
 for(const map of ['start','route1','colosseum','rift_room']){const {a,b,p}=fixture(['power_vampire','power_bastion','power_fountain','power_phoenix']);p.currentmap=map;assert.equal(powers.value(p,5),0);assert.equal(fx.multiplier(b,a,engine.getMoveByName('Tackle'),false),1);a.currentHp=20;fx.endTurn(a);assert.equal(a.currentHp,20);assert.equal(fx.directDamage(a,200,b),200);}
});

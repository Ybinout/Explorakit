const test=require('node:test'),assert=require('node:assert/strict');
const {partyIndicator}=require('../server/game/battle/partyIndicator');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const factory=require('../server/game/drift/pokemonFactory');
const codec=require('../server/game/drift/checkpointCodec');
function actor(id,size,npc=false){return{userId:id,npc,currentmap:'route2',username:'Test',run:{mode:'colosseum'},equipe:{pokemons:[7,4,25,19,16,1].slice(0,size).map(id=>{const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Splash'];p.movePp=[40];return p;})},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};}
function fixture(type='trainer',sizes=[2,6]){const a=actor(1,sizes[0]),b=actor(2,sizes[1],type!=='pvp'),events=[];const battle=new DriftBattle(a,b,{type,emit:(p,e,payload)=>{if(e==='introAnimation')events.push({id:p.userId,payload:structuredClone(payload)});},paceMs:0,random:()=>.5});return{a,b,battle,events,last:id=>events.filter(e=>e.id===id).at(-1).payload.opponentParty};}
test('anonymous balls show the actual party size, healthy first, with no unseen information or mutation',()=>{
 const team=[{uuid:'secret',data:{id:150},currentHp:0,abilities:['Secret'],heldItem:'secret'},{currentHp:1},{currentHp:100},{isEgg:true,currentHp:1},{storyActor:'professor',currentHp:1}];
 assert.deepEqual(partyIndicator(team),[true,true,false]);assert.equal(team[0].uuid,'secret');assert.deepEqual(partyIndicator([...team].reverse()),[true,true,false]);
 assert.equal(partyIndicator([]),null);assert.equal(partyIndicator([{storyActor:'professor',currentHp:1}]),null);assert.equal(partyIndicator(Array(9).fill({currentHp:1})).length,6);
});
for(const type of ['trainer','arena'])test(`${type}: grey balls survive switches, permanent removal and checkpoint resume`,()=>{
 const f=fixture(type);try{
  assert.deepEqual(f.last(1),Array(6).fill(true));
  [f.b.equipe.pokemons[0],f.b.equipe.pokemons[2]]=[f.b.equipe.pokemons[2],f.b.equipe.pokemons[0]];f.battle.sync();assert.deepEqual(f.last(1),Array(6).fill(true));
  f.b.equipe.pokemons[0].currentHp=0;f.battle.prune();f.battle.sync();assert.equal(f.b.equipe.pokemons.length,5);assert.deepEqual(f.last(1),[true,true,true,true,true,false]);
  const restored=codec.decode(codec.encode(f.battle)),events=[];restored.emit=(_p,e,d)=>{if(e==='introAnimation')events.push(d);};restored.resume(restored.a);assert.deepEqual(events.at(-1).opponentParty,f.last(1));
  for(const p of restored.b.equipe.pokemons)p.currentHp=0;restored.sync();assert.deepEqual(events.at(-1).opponentParty,Array(6).fill(false));restored.finished=true;
 }finally{f.battle.finished=true;}
});
test('Rift PvP sends each viewer only their opponent count, including permanently lost Pokémon',()=>{
 const f=fixture('pvp',[2,3]);try{assert.deepEqual(f.last(1),[true,true,true]);assert.deepEqual(f.last(2),[true,true]);f.a.equipe.pokemons[0].currentHp=0;f.battle.prune();f.battle.sync();assert.deepEqual(f.last(2),[true,false]);assert.deepEqual(f.last(1),[true,true,true]);}finally{f.battle.finished=true;}
});
test('wild encounters never expose a trainer ball row',()=>{const f=fixture('wild',[1,1]);try{assert.equal(f.last(1),null);}finally{f.battle.finished=true;}});

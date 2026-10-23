const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory');
const {AdventureExperience}=require('../server/game/battle/adventureExperience');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const codec=require('../server/game/drift/checkpointCodec');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const mon=(id=1)=>{const p=factory.create(id,30,true);p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=null;return p;};
const io={to:()=>({emit(){}})};
function fixture(mode='rift',type='trainer'){
 const team=[mon(),mon(7),mon(25)],foes=[mon(19),mon(19)],p={userId:1,socketId:'p',currentmap:'cave1',run:{mode},equipe:{pokemons:team},drifts:[],equipped:[],items:{hyperball:1},money:0},q={npc:true,equipe:{pokemons:foes},drifts:[],equipped:[]};
 const battle=new DriftBattle(p,q,{type,emit(){},random:()=>0,paceMs:0});return {p,q,battle,team:[...team],foes:[...foes]};
}

test('EVs belong to actual participants even with Multi Exp; complete yields, caps, KO and no replay',()=>{
 const a=mon(),b=mon(),bench=mon(),foe=mon(25),player={equipe:{pokemons:[a,b,bench]}};
 const tracker=new AdventureExperience({expShare:true});tracker.enter(a,foe);tracker.enter(b,foe);tracker.enter(a,foe);
 a.ev.speed=251;b.currentHp=0;foe.currentHp=0;tracker.reward(player,foe,1,io);
 assert.equal(a.ev.speed,252);assert.equal(b.ev.speed,2);assert.equal(b.currentHp,0);assert.equal(bench.ev.speed,0);assert(bench.experience>factory.create(1,30,true).experience,'Multi Exp XP remains independent');
 tracker.reward(player,foe,1,io);tracker.rewardEffort(player,foe);assert.equal(b.ev.speed,2);
 const second=mon(19);tracker.enter(a,second);a.ev={hp:252,attack:252,speed:5,defense:0,specialAttack:0,specialDefense:0};second.currentHp=0;tracker.reward(player,second,1,io);assert.equal(a.ev.speed,6);assert.equal(Object.values(a.ev).reduce((s,n)=>s+n),510);assert.equal(b.ev.speed,2);
});

test('capture rewards each entrant once, never the captured Pokémon or an untouched reserve',()=>{
 const a=mon(),b=mon(),bench=mon(),foe=mon(19),tracker=new AdventureExperience(),p={equipe:{pokemons:[a,b,bench,foe]}};
 tracker.enter(a,foe);tracker.enter(b,foe);tracker.rewardEffort(p,foe);tracker.rewardEffort(p,foe);
 assert.deepEqual([a,b,bench,foe].map(p=>p.ev.speed),[1,1,0,0]);
});

for(const mode of ['rift','colosseum'])test(`${mode}: real switches track each enemy separately, survive checkpoints and never award bench EVs`,()=>{
 let {p,battle,team,foes}=fixture(mode);const [a,b,bench]=team;
 assert(battle.action(p,{action:'change',number:1,turnId:battle.token}));
 // Enemy switch away/back retains its own participants, not a global battle list.
 switchPokemonByIndex(battle.b.equipe,1);battle.enter(1);switchPokemonByIndex(battle.b.equipe,1);battle.enter(1);
 const saved=codec.decode(codec.encode({battle}));battle=saved.battle;battle.emit=()=>{};p=battle.a;battle.resume(p);
 const byId=id=>p.equipe.pokemons.find(p=>p.uuid===id),first=battle.b.equipe.pokemons.find(p=>p.uuid===foes[0].uuid),second=battle.b.equipe.pokemons.find(p=>p.uuid===foes[1].uuid);
 first.currentHp=0;battle.reward(first);battle.reward(first);assert.deepEqual([a,b,bench].map(p=>byId(p.uuid).ev.speed),[1,1,0]);
 second.currentHp=0;battle.reward(second);assert.deepEqual([a,b,bench].map(p=>byId(p.uuid).ev.speed),[1,2,0]);
 const restored=codec.decode(codec.encode(battle));restored.emit=()=>{};restored.reward(first);assert.equal(restored.a.equipe.pokemons.find(p=>p.uuid===b.uuid).ev.speed,2);
});

for(const mode of ['rift','colosseum'])test(`${mode}: successful capture grants EVs to switched participants only`,()=>{
 const {p,battle,team,foes}=fixture(mode,'wild');battle.b.equipe.pokemons=[foes[0]];
 battle.action(p,{action:'change',number:1,turnId:battle.token});battle.tick();battle.action(p,{action:'bag',itemKey:'hyperball',turnId:battle.token});
 assert(battle.finished);assert.equal(battle.capturedPokemon.uuid,foes[0].uuid);assert.deepEqual([...team,foes[0]].map(p=>p.ev.speed),[1,1,0,0]);
});

test('PvP grants no EVs, and protected KOs stay KO while receiving earned training',()=>{
 const pvp=fixture('rift','pvp');pvp.battle.rewardEffort(pvp.foes[0]);assert(pvp.team.every(p=>p.ev.speed===0));
 const f=fixture();f.battle.action(f.p,{action:'change',number:1,turnId:f.battle.token});f.team[0].currentHp=0;f.team[0].riftFainted=true;f.foes[0].currentHp=0;f.battle.reward(f.foes[0]);assert.equal(f.team[0].ev.speed,1);assert.equal(f.team[0].currentHp,0);
});

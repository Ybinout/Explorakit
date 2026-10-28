const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {clearBattleTransientState,recoverLostHeldItems}=require('../server/game/battle/battleOutcome');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
const resources=require('../server/game/battle/battleResources');
function mon(id,moves){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);return p;}
function fixed(fn){const old=Math.random;Math.random=()=>.5;try{return fn();}finally{Math.random=old;}}
function cast(move,a,b,field=engine.createBattleState()){return fixed(()=>engine.useattack(move,a,b,{battleState:field,attackerSide:field.sides.player,defenderSide:field.sides.enemy}));}
function activate(holder,field){holder.maxHp=holder.currentHp=40;return cast('Seismic Toss',mon(68,['Seismic Toss']),holder,field);}

test('Focus Sash is unavailable after activation and does not reactivate after healing; cleanup restores it for the next encounter',()=>{
 const p=mon(143,['Splash']);p.heldItem='focus_sash';const field=engine.createBattleState();
 activate(p,field);assert.equal(p.currentHp,1);assert.equal(p.heldItem,null);assert.equal(p.__heldItemBeforeExchange,'focus_sash');
 activate(p,field);assert.equal(p.currentHp,0,'no second activation merely by healing during the same battle');
 clearBattleTransientState([p]);assert.equal(p.heldItem,'focus_sash');assert(!Object.hasOwn(p,'__heldItemConsumedForBattle'));
 clearBattleTransientState([p]);assert.equal(p.heldItem,'focus_sash');activate(p,engine.createBattleState());assert.equal(p.currentHp,1);
});

test('a multi-hit attack still knocks out the Focus Sash user before its item is restored',()=>{
 const p=mon(143,['Splash']),foe=mon(68,['Double Hit']);p.heldItem='focus_sash';p.maxHp=p.currentHp=40;foe.currentAttack=99999;
 cast('Double Hit',foe,p);assert.equal(p.currentHp,0);assert.equal(p.heldItem,null);clearBattleTransientState([p]);assert.equal(p.heldItem,'focus_sash');
});

test('Trick plus consumption restores the sash to its original owner, without keeping the other item',()=>{
 const owner=mon(65,['Trick']),receiver=mon(143,['Splash']);owner.heldItem='focus_sash';receiver.heldItem='rocky_helmet';
 const field=engine.createBattleState();cast('Trick',owner,receiver,field);assert.equal(receiver.heldItem,'focus_sash');assert.equal(owner.heldItem,'rocky_helmet');
 activate(receiver,field);assert.equal(receiver.heldItem,null);assert.equal(owner.__heldItemBeforeExchange,'focus_sash');
 clearBattleTransientState([receiver,owner]);assert.equal(owner.heldItem,'focus_sash');assert.equal(receiver.heldItem,'rocky_helmet');
});

test('berries remain consumed and ordinary Rocky Helmet remains equipped after cleanup',()=>{
 const berry=mon(143,['Splash']),helmet=mon(143,['Splash']);berry.heldItem='oran_berry';helmet.heldItem='rocky_helmet';berry.maxHp=400;berry.currentHp=20;
 engine.processEndOfRound(berry,helmet,engine.createSideState(),engine.createSideState(),engine.createBattleState());
 assert.equal(berry.heldItem,null);clearBattleTransientState([berry,helmet]);assert.equal(berry.heldItem,null);assert.equal(helmet.heldItem,'rocky_helmet');
});

for(const mode of ['rift','colosseum'])for(const ending of ['fled','timer','finished'])test(`${mode} ${ending}: a used sash survives checkpoint and returns to a surviving holder without a bag duplicate`,()=>{
 const lead=mon(143,['Splash']);lead.heldItem='focus_sash';const player={userId:1,currentmap:'route1',run:{mode,phase:'exploration'},equipe:{pokemons:[lead]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
 const npc={npc:true,equipe:{pokemons:[mon(19,['Splash'])]},drifts:[],equipped:[]};
 const b=new DriftBattle(player,npc,{type:'trainer',emit(){},paceMs:0});activate(lead,b.state);
 const saved=codec.decode(codec.encode(b));saved.emit=()=>{};assert.equal(saved.active(0).heldItem,null);
 saved.finish(ending==='finished'?saved.a:null,ending);assert.equal(saved.active(0).heldItem,'focus_sash');assert(!saved.a.items.focus_sash);
 saved.finish(saved.a,ending);assert(!saved.a.items.focus_sash);b.finished=true;
});

for(const mode of ['rift','colosseum'])test(`${mode}: a used sash returns to the bag exactly once when the holder is permanently lost`,()=>{
 const lead=mon(143,['Splash']);lead.heldItem='focus_sash';const player={userId:1,currentmap:'route1',run:{mode,phase:'exploration'},equipe:{pokemons:[lead]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
 const b=new DriftBattle(player,{npc:true,equipe:{pokemons:[mon(19,['Splash'])]},drifts:[],equipped:[]},{type:'trainer',emit(){},paceMs:0});
 activate(lead,b.state);lead.currentHp=0;b.finish(b.b,'finished');assert.equal(player.items.focus_sash,1);assert.equal(player.equipe.pokemons.length,0);
 assert.deepEqual(recoverLostHeldItems(player,[lead]),[]);assert.equal(player.items.focus_sash,1);
});

test('Pickup cannot duplicate the restored sash: it belongs to the original holder after battle',()=>{
 const owner=mon(143,['Splash']),picker=mon(52,['Splash']);owner.heldItem='focus_sash';picker.passiveAbility='Pickup';const field=engine.createBattleState();
 activate(owner,field);engine.processEndOfRound(owner,picker,field.sides.player,field.sides.enemy,field);assert.equal(picker.heldItem,'focus_sash');
 clearBattleTransientState([owner,picker]);assert.equal(owner.heldItem,'focus_sash');assert.equal(picker.heldItem,null);
});

test('Fling spends the sash during the battle and returns it after cleanup',()=>{
 const owner=mon(143,['Fling']),foe=mon(19,['Splash']);owner.heldItem='focus_sash';
 cast('Fling',owner,foe);assert.equal(owner.heldItem,null);clearBattleTransientState([owner]);assert.equal(owner.heldItem,'focus_sash');
});

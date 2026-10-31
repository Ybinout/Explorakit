const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { planHeldItemTransfer: plan } = require('../server/game/items/heldItemTransfer');
const { registerHeldItemTransferHandlers: register } = require('../server/realtime/handlers/heldItemTransferHandlers');
const team = () => [{uuid:'a',heldItem:'leftovers',currentHp:0}, {uuid:'b',heldItem:'choice_scarf'}, {uuid:'c',heldItem:null}];
const payload = (extra={}) => ({teamId:7,sourceUuid:'a',targetUuid:'b',sourceItem:'leftovers',targetItem:'choice_scarf',...extra});
test('held transfer plans a swap or a gift, including fainted teammates, without changing any input', () => {
    const pokemons=team(), before=structuredClone(pokemons);
    assert.deepEqual(plan(pokemons,payload()),[{pokemonUuid:'a',heldItem:'choice_scarf'},{pokemonUuid:'b',heldItem:'leftovers'}]);
    assert.deepEqual(plan(pokemons,payload({targetUuid:'c',targetItem:null})),[{pokemonUuid:'a',heldItem:null},{pokemonUuid:'c',heldItem:'leftovers'}]);
    assert.deepEqual(pokemons,before);
});
test('held transfer refuses stale, malformed, empty, foreign, egg and same-item slots', () => {
    for(const p of [null,{},payload({targetUuid:'a'}),payload({sourceUuid:'foreign'}),payload({targetUuid:'foreign'}),payload({sourceItem:'life_orb'}),payload({targetItem:null}),payload({targetItem:undefined}),payload({sourceItem:12}),payload({sourceUuid:[]}),payload({sourceUuid:'x'.repeat(65)}),payload({sourceUuid:'c',sourceItem:null})])assert.throws(()=>plan(team(),p));
    assert.throws(()=>plan([{uuid:'a',heldItem:'potion'},{uuid:'b'}],payload({sourceItem:'potion',targetItem:null})));
    assert.throws(()=>plan(team().map(p=>({...p,isEgg:p.uuid==='b'})),payload()));
    assert.throws(()=>plan(team().map(p=>({...p,heldItem:'leftovers'})),payload({targetItem:'leftovers'})));
});
function fixture(persist){
    const socket=new EventEmitter(),events=[],player={equipe:{pokemons:team()}},state={allowed:true,calls:0};
    socket.on('teamStateChanged',data=>events.push(data));
    register({socket,userId:3,getPlayer:()=>player,canUse:()=>state.allowed,persist:async(...args)=>{state.calls++;return persist(...args);}});
    return {player,state,events,send:p=>new Promise(resolve=>socket.emit('transferHeldItem',p,resolve))};
}
test('held transfer keeps memory unchanged while saving, serializes commands, and publishes only after commit', async () => {
    let finish;const f=fixture(async(_user,_team,p)=>{await new Promise(r=>finish=r);return plan(f.player.equipe.pokemons,p);});
    const before=structuredClone(f.player.equipe),pending=f.send(payload());assert.equal(f.player.inventoryBusy,true);assert.deepEqual(f.player.equipe,before);assert.equal(f.events.length,0);
    assert.equal((await f.send(payload())).success,false);finish();assert.equal((await pending).success,true);
    assert.deepEqual(f.player.equipe.pokemons.map(p=>p.heldItem),['choice_scarf','leftovers',null]);assert.equal(f.player.inventoryBusy,false);assert.equal(f.events[0].reason,'held-item-transfer');
    assert.equal((await f.send(payload())).success,false);assert.equal(f.state.calls,1);
});
test('held transfer rejects battle, inventory lock, tournament and restricted scenes without touching persistence', async () => {
    const f=fixture(async()=>{throw Error('must not be called');});
    for(const key of ['inbattle','inventoryBusy','superTournamentActive']){f.player[key]=true;assert.equal((await f.send(payload())).success,false);f.player[key]=false;}
    f.state.allowed=false;assert.equal((await f.send(payload())).success,false);assert.equal(f.state.calls,0);
});
test('held transfer leaves items and order intact after save failure, releases lock and returns an error', async () => {
    const f=fixture(async()=>{throw Error('simulated SQL failure');}),before=structuredClone(f.player.equipe);
    const result=await f.send(payload());assert.equal(result.success,false);assert.match(result.message,/SQL failure/);assert.deepEqual(f.player.equipe,before);assert.equal(f.player.inventoryBusy,false);assert.equal(f.events.length,0);
});

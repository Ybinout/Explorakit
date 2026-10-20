const test = require('node:test'), assert = require('node:assert/strict');
const { registerTeamOrderHandlers } = require('../server/realtime/handlers/teamOrderHandlers');
function setup(persist) {
    const handlers = {}, events = [], player = { equipe: { pokemons: [{uuid:'a'}, {uuid:'b'}] } };
    registerTeamOrderHandlers({socket:{on:(n,fn)=>handlers[n]=fn,emit:(n,p)=>events.push({n,p})},userId:42,getPlayer:()=>player,persist});
    return {player,events,send:async ids=>{let reply;await handlers.reorderTeam({orderedUuids:ids},r=>reply=r);return reply;}};
}
test('reorder publishes only after persistence and rejects concurrent mutations', async () => {
    let finish;
    const f=setup(async (id,team)=>{assert.equal(id,42);assert.deepEqual(team.pokemons.map(p=>p.uuid),['b','a']);await new Promise(resolve=>finish=resolve);});
    const pending=f.send(['b','a']);assert(f.player.inventoryBusy);assert.deepEqual(f.player.equipe.pokemons.map(p=>p.uuid),['a','b']);
    assert.equal((await f.send(['a','b'])).success,false);finish();assert.equal((await pending).success,true);
    assert.deepEqual(f.player.equipe.pokemons.map(p=>p.uuid),['b','a']);assert.equal(f.player.inventoryBusy,false);assert.equal(f.events[0].p.reason,'reorder');
});
test('invalid, foreign, duplicate, incomplete and in-battle orders cannot be saved', async () => {
    let saves=0;const f=setup(async()=>{saves++;});
    for(const ids of [[],['a'],['a','a'],['a','foreign'],['a',2],null])assert.equal((await f.send(ids)).success,false);
    f.player.inbattle=true;assert.equal((await f.send(['b','a'])).success,false);assert.equal(saves,0);
});
test('a failed save retains the authoritative order and releases the mutation lock', async () => {
    const f=setup(async()=>{throw Error('simulated failure');});
    assert.equal((await f.send(['b','a'])).success,false);assert.deepEqual(f.player.equipe.pokemons.map(p=>p.uuid),['a','b']);assert.equal(f.player.inventoryBusy,false);assert.equal(f.events.length,0);
});

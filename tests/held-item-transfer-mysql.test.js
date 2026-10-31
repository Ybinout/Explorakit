const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,items,factory,owner,other,record,foreign,pokemons;
test.before(async()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');
    db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');items=require('../server/persistence/itemRepository');factory=require('../server/game/drift/pokemonFactory');
    owner=await users.createUserWithStarter('held_'+randomUUID(),randomUUID(),{starterId:7});other=await users.createUserWithStarter('held_foreign_'+randomUUID(),randomUUID(),{starterId:7});
    record=await teams.getTeamRecord(owner.id);foreign=await teams.getTeamRecord(other.id);
});
test.after(async()=>{if(!db)return;for(const u of [owner,other])if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();});
test.beforeEach(async()=>{if(!enabled)return;pokemons=[9,94,26].map(id=>factory.create(id,30,true));pokemons[0].heldItem='leftovers';pokemons[1].heldItem='choice_scarf';pokemons[2].heldItem=null;await teams.editEquipe(owner.id,{pokemons});});
const request=(extra={})=>({sourceUuid:pokemons[0].uuid,targetUuid:pokemons[1].uuid,sourceItem:'leftovers',targetItem:'choice_scarf',...extra});
const held=async()=> (await teams.loadEquipe(owner.id)).pokemons.map(p=>p.heldItem);
test('SQL held transfer atomically swaps both slots and preserves bag, order, stats, HP, moves and training',{skip:!enabled},async()=>{
    const before=(await teams.loadEquipe(owner.id)).pokemons.map(p=>teams.pokemonToRow(p,record.id,0)),bag=await items.loadUserItems(owner.id);
    await items.transferHeldItem(owner.id,record.id,request());assert.deepEqual(await held(),['choice_scarf','leftovers',null]);
    const after=(await teams.loadEquipe(owner.id)).pokemons.map(p=>teams.pokemonToRow(p,record.id,0)),itemIndex=teams.POKEMON_COLUMNS.indexOf('held_item');
    for(let i=0;i<3;i++){after[i][itemIndex]=before[i][itemIndex];assert.deepEqual(after[i],before[i]);}assert.deepEqual(await items.loadUserItems(owner.id),bag);
});
test('SQL held transfer gifts to an empty slot, prevents replay and can move it back',{skip:!enabled},async()=>{
    const p=request({targetUuid:pokemons[2].uuid,targetItem:null});await items.transferHeldItem(owner.id,record.id,p);assert.deepEqual(await held(),[null,'choice_scarf','leftovers']);
    await assert.rejects(items.transferHeldItem(owner.id,record.id,p));assert.deepEqual(await held(),[null,'choice_scarf','leftovers']);
    await items.transferHeldItem(owner.id,record.id,{sourceUuid:pokemons[2].uuid,targetUuid:pokemons[0].uuid,sourceItem:'leftovers',targetItem:null});assert.deepEqual(await held(),['leftovers','choice_scarf',null]);
});
test('SQL held transfer refuses foreign teams, foreign Pokémon, stale and invalid items without mutation',{skip:!enabled},async()=>{
    const before=await held(),foreignPokemon=(await teams.loadEquipe(other.id)).pokemons[0];
    for(const [id,tid,p]of [[owner.id,foreign.id,request()],[other.id,record.id,request()],[owner.id,record.id,request({targetUuid:foreignPokemon.uuid})],[owner.id,record.id,request({sourceItem:'life_orb'})],[owner.id,record.id,request({targetUuid:pokemons[0].uuid})]])await assert.rejects(items.transferHeldItem(id,tid,p));
    assert.deepEqual(await held(),before);
});
test('SQL simultaneous stale drags commit exactly once, without duplicating or reversing the exchange',{skip:!enabled},async()=>{
    const r=await Promise.allSettled([items.transferHeldItem(owner.id,record.id,request()),items.transferHeldItem(owner.id,record.id,request())]);
    assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);assert.deepEqual(await held(),['choice_scarf','leftovers',null]);
});
test('SQL held transfer respects a live friend trade inventory lock',{skip:!enabled},async()=>{
    const locks=require('../server/game/social/tradeLocks'),token=randomUUID();locks.acquire([owner.id],token);
    try{await assert.rejects(items.transferHeldItem(owner.id,record.id,request()),/échange/);assert.deepEqual(await held(),['leftovers','choice_scarf',null]);}finally{locks.release([owner.id],token);}
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let dbPool, repository;
test.before(() => {
    if (!enabled) return;
    if (!/test/i.test(process.env.DB_NAME || '')) throw Error('Base de test requise.');
    ({dbPool}=require('../server/config/database'));
    repository=require('../server/persistence/colosseumRepository');
});
test.after(async()=>{if(dbPool)await dbPool.end();});
async function fixture() {
    const users=[];
    for(let i=0;i<2;i++){
        const username='colo_'+randomUUID();
        const [r]=await dbPool.execute('INSERT INTO users(username,password_hash,money) VALUES (?, ?, 321)',[username,'unused']);
        users.push({id:r.insertId,username});
    }
    return {users, async run(index,score,wins,finishedAt=Date.now(),durationMinutes=60) {
        const id=randomUUID(),run={id,players:[users[index]],finishedAt,durationMinutes};
        run.report={runId:id,mode:'colosseum',players:[],colosseum:{score,wins,wave:wins+1,lastTeam:[{uuid:'private-uuid',pokemonId:7,name:'Carapuce',level:20,currentHp:0,ivs:{hp:31}}]}};
        await repository.recordRunStarted(run);return run;
    },async cleanup(){for(const user of users)await dbPool.execute('DELETE FROM users WHERE id=?',[user.id]);}};
}
test('Colosseum SQL: immutable settlement, best score only, no Adventure/Rift changes', {skip:!enabled}, async()=>{
    const f=await fixture();
    try{
        const first=await f.run(0,300,1);
        const results=await Promise.all(Array.from({length:4},()=>repository.recordRunFinished(first)));
        assert.equal(results.filter(r=>r.recorded).length,1);
        const replay={...first,report:{...first.report,colosseum:{...first.report.colosseum,score:999999,wins:999}}};
        await repository.recordRunFinished(replay);
        let ranking=await repository.leaderboard(f.users[0].id);assert.equal(ranking.personal.score,300);
        const lower=await f.run(0,0,0),better=await f.run(0,760,2);
        await Promise.all([repository.recordRunFinished(lower),repository.recordRunFinished(better)]);
        ranking=await repository.leaderboard(f.users[0].id);assert.equal(ranking.personal.score,760);
        assert.equal(ranking.entries.filter(r=>r.userId===f.users[0].id).length,1);
        const [[user]]=await dbPool.execute('SELECT money FROM users WHERE id=?',[f.users[0].id]);assert.equal(user.money,321);
        const [profiles]=await dbPool.execute('SELECT * FROM rift_profiles WHERE user_id=?',[f.users[0].id]);assert.equal(profiles.length,0);
        const [teams]=await dbPool.execute('SELECT * FROM teams WHERE user_id=?',[f.users[0].id]);assert.equal(teams.length,0);
    }finally{await f.cleanup();}
});
test('Colosseum SQL: tie order, team allowlist, zero-win exclusion and ownership', {skip:!enabled}, async()=>{
    const f=await fixture();
    try{
        const first=await f.run(0,300,1,Date.now()-5000),second=await f.run(1,300,1);
        await repository.recordRunFinished(first);await repository.recordRunFinished(second);
        const ranking=await repository.leaderboard(f.users[1].id);
        const left=(await repository.leaderboard(f.users[0].id)).personal;
        assert(left.rank<ranking.personal.rank);
        assert.deepEqual(ranking.personal.team,[{pokemonId:7,name:'Carapuce',level:20,knockedOut:true}]);
        await assert.rejects(()=>repository.recordRunStarted({...first,players:[f.users[1]]}),/autre dresseur/);
        await assert.rejects(()=>repository.recordRunFinished({...first,players:[f.users[1]]}),/non enregistrée/);
        const [[count]]=await dbPool.execute('SELECT COUNT(*) AS n FROM colosseum_bests WHERE user_id IN (?,?)',f.users.map(u=>u.id));assert.equal(count.n,2);
    }finally{await f.cleanup();}
});
test('Colosseum SQL: committed receipt wins over an old running checkpoint', {skip:!enabled}, async()=>{
    const f=await fixture();
    try{
        const {createLobbyStore}=require('../server/game/drift/lobbyStore');
        const {createRunManager}=require('../server/game/drift/runManager');
        const {encode,decode}=require('../server/game/drift/checkpointCodec');
        const store=createLobbyStore(),runtime=createRunManager({ starterChoiceMs:0,store,namespace:{to:()=>({emit(){}})},colosseumRepository:repository});
        const user=f.users[0];store.connect(user,'test');await runtime.startColosseum(user);runtime.enter(user,{id:'test'});
        const before=encode({savedAt:Date.now(),lobbies:store.exportLobbies(),runs:runtime.runs});
        const p=runtime.playerFor(user);runtime.abandon(p);await p.run.settling;
        const saved=decode(before),nextStore=createLobbyStore(),next=createRunManager({ starterChoiceMs:0,store:nextStore,namespace:{to:()=>({emit(){}})},colosseumRepository:repository});
        nextStore.restoreLobbies(saved.lobbies);next.restore(saved.runs,saved.savedAt);await next.reconcileSettlements();
        const restored=next.playerFor(user);assert.equal(restored.run.phase,'results');assert.equal(restored.alive,false);
        assert.equal(restored.run.settlement.status,'complete');assert.equal(restored.run.recoveryWaiting,false);
        assert.equal((await repository.leaderboard(user.id)).personal,null);
    }finally{await f.cleanup();}
});

test('Colosseum SQL: independent records and ranks per format; launch format cannot change', {skip:!enabled}, async()=>{
    const f=await fixture();
    try{
        const express=await f.run(0,300,1,Date.now(),30),classic=await f.run(0,760,2);
        await assert.rejects(()=>repository.recordRunStarted({...express,durationMinutes:60}),/format.*fixé/);
        // Ranking uses the immutable launch format, not report metadata.
        express.report.rules={durationMinutes:60};
        await Promise.all([repository.recordRunFinished(express),repository.recordRunFinished(classic)]);
        assert.equal((await repository.leaderboard(f.users[0].id,30)).personal.score,300);
        assert.equal((await repository.leaderboard(f.users[0].id,60)).personal.score,760);
        assert.equal((await repository.leaderboard(f.users[0].id)).personal.score,760);
        const other=await f.run(1,760,2,Date.now(),30);await repository.recordRunFinished(other);
        assert((await repository.leaderboard(f.users[1].id,30)).personal.rank < (await repository.leaderboard(f.users[0].id,30)).personal.rank);
        assert.equal((await repository.leaderboard(f.users[1].id,60)).personal,null);
        await assert.rejects(()=>repository.leaderboard(f.users[0].id,45),/30 minutes ou 1 heure/);
    }finally{await f.cleanup();}
});

test('Colosseum record reset cannot resurrect finished results and preserves Rift ratings', {skip:!enabled}, async()=>{
    const f=await fixture();
    try {
        const user=f.users[0];
        await dbPool.execute('INSERT INTO rift_ratings(user_id,rating,games) VALUES (?,1424,12)',[user.id]);
        const first=await f.run(0,300,1,Date.now(),30),classic=await f.run(0,760,2);
        await repository.recordRunFinished(first);await repository.recordRunFinished(classic);
        // Same operation as the deployment reset, scoped to this test account.
        await dbPool.execute('DELETE FROM colosseum_bests WHERE user_id=?',[user.id]);
        assert.equal((await repository.leaderboard(user.id,30)).personal,null);
        assert.equal((await repository.leaderboard(user.id,60)).personal,null);
        await repository.recordRunFinished(first);await repository.recordRunFinished(classic);
        assert.equal((await repository.leaderboard(user.id,30)).personal,null);
        assert.equal((await repository.getFinishedRuns([first.id,classic.id])).length,2,'Recovery receipts must remain available');
        const profile=await require('../server/persistence/trainerRepository').profile(user.id,user.id);
        assert.equal(profile.rift.rating,1424);assert.equal(profile.rift.rank.label,'Or IV');assert.equal(profile.rift.rank.lp,48);
        assert(profile.colosseum.every(record=>record.rank.key==='unranked'&&record.team.length===0));
        const fresh=await f.run(0,300,1,Date.now(),30);await repository.recordRunFinished(fresh);
        assert.equal((await repository.leaderboard(user.id,30)).personal.league.label,'Bronze IV');
        assert.equal((await repository.leaderboard(user.id,60)).personal,null);
    } finally {await f.cleanup();}
});

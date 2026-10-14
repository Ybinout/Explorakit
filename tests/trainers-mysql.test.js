const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {once}=require('node:events');
const shouldRun=process.env.RUN_MYSQL_TESTS==='1';
let db,account,trainers,server,base;
test.before(async()=>{
    if(!shouldRun)return;
    if(!/test/i.test(process.env.DB_NAME || ''))throw Error('Test database required');
    db=require('../server/config/database').dbPool;account=require('../server/persistence/riftAccountRepository');trainers=require('../server/persistence/trainerRepository');
    const express=require('express');const app=express();app.use(express.json());app.use('/api',require('../server/http/routes'));server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api`;
});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));if(db)await db.end();});
async function fixture(count=4){
    const users=[],runs=[];const prefix='social_'+randomUUID().slice(0,12);
    for(let i=0;i<count;i++){const [r]=await db.execute('INSERT INTO users(username,password_hash,email,money) VALUES (?,?,?,?)',[prefix+'_'+i,'private-hash-'+i,prefix+i+'@private.invalid',99999]);users.push({id:r.insertId,username:prefix+'_'+i});}
    return {users,prefix,run(){const r={id:randomUUID(),players:users,explorationMs:1200000,winnerId:users[0].id,finishedAt:Date.now()};r.report={mode:'rift',runId:r.id,players:users,matches:[{round:1,status:'finished',players:[users[0].id,users[1].id],winnerId:users[0].id},{round:1,status:'finished',players:[users[2].id,users[3].id],winnerId:users[2].id},{round:2,status:'finished',players:[users[0].id,users[2].id],winnerId:users[0].id}]};runs.push(r.id);return r;},async cleanup(){for(const run of runs)await db.execute('DELETE FROM rift_runs WHERE id=?',[run]);for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}};
}
async function http(user,path,method='GET',body){const headers={};if(user)headers.Authorization='Bearer '+require('../server/config/auth').signAccessToken(user);if(body)headers['Content-Type']='application/json';const response=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,headers:response.headers,data:await response.json()};}
test('rank SQL: atomic replay, overlapping settlements, persisted report and restart receipt', {skip:!shouldRun},async()=>{
    const f=await fixture();try{
        assert.equal((await trainers.profile(f.users[0].id,f.users[0].id)).rift.rank.key,'unranked');
        const run=f.run();await account.recordRunStarted(run);
        const result=await Promise.all(Array.from({length:6},()=>account.recordRunFinished(run)));
        assert.equal(result.filter(r=>r.recorded).length,1);
        for(const r of result)assert.deepEqual(r.ratings,result[0].ratings);
        assert.equal(result[0].ratings.reduce((s,p)=>s+p.delta,0),0);
        const winner=result[0].ratings.find(p=>p.userId===f.users[0].id);assert.equal(winner.delta,24);
        assert.deepEqual(result[0].ratings.filter(p=>[f.users[1].id,f.users[3].id].includes(p.userId)).map(p=>p.place),[3,3]);
        const profile=await trainers.profile(f.users[0].id,f.users[0].id);assert.equal(profile.rift.ratedGames,1);assert.equal(profile.rift.rating,1024);
        const receipts=await account.getFinishedRuns([run.id]);assert.deepEqual(receipts[0].ratings,result[0].ratings);assert.deepEqual(receipts[0].report.ratingChanges,result[0].ratings);
        const history=await require('../server/persistence/riftCollectionRepository').history(f.users[0].id);assert.deepEqual(history[0].ratingChanges,result[0].ratings);
        const others=[f.run(),f.run()];for(const next of others)await account.recordRunStarted(next);await Promise.all(others.map(r=>account.recordRunFinished(r)));
        const p=await trainers.profile(f.users[0].id,f.users[0].id);assert.equal(p.rift.ratedGames,3);assert(p.rift.rating>1024);
        const ranking=await trainers.leaderboard(f.users[0].id);assert.equal(ranking.personal.id,f.users[0].id);assert.equal(ranking.personal.rift.rating,p.rift.rating);
        const [[original]]=await db.execute('SELECT money FROM users WHERE id=?',[f.users[0].id]);assert.equal(Number(original.money),99999);
    }finally{await f.cleanup();}
});
test('friend SQL/HTTP: reciprocal requests require consent, authorization, removal and private DTOs', {skip:!shouldRun},async()=>{
    const f=await fixture();const [a,b,c]=f.users;try{
        assert.equal((await http(null,'/community/profiles/'+a.id)).status,401);
        const path='/community/friends/'+b.id;
        assert.equal((await http(a,'/community/friends/'+a.id,'POST',{action:'request'})).status,400);
        await Promise.all([trainers.friendAction(a.id,b.id,'request'),trainers.friendAction(b.id,a.id,'request')]);
        let fa=await trainers.friends(a.id),fb=await trainers.friends(b.id);
        assert.equal(fa.accepted.length+fb.accepted.length,0);assert.equal(fa.incoming.length+fa.outgoing.length,1);
        const recipient=fa.incoming.length?a:b,sender=recipient===a?b:a;
        assert.equal((await http(sender,'/community/friends/'+recipient.id,'POST',{action:'accept'})).status,403);
        assert.equal((await http(c,'/community/friends/'+sender.id,'POST',{action:'accept',userId:recipient.id})).status,403);
        assert.equal((await http(recipient,'/community/friends/'+sender.id,'POST',{action:'accept'})).status,200);
        assert.equal((await trainers.friends(a.id)).accepted[0].id,b.id);assert.equal((await trainers.friends(b.id)).accepted[0].id,a.id);
        assert.equal((await trainers.friends(c.id)).accepted.length,0);
        assert.equal((await http(a,path,'POST',{action:'cancel'})).status,403);
        const profile=await http(a,'/community/profiles/'+b.id);assert.equal(profile.status,200);assert.equal(profile.headers.get('cache-control'),'no-store');assert.equal(profile.data.relationship,'friends');
        assert.deepEqual(Object.keys(profile.data).sort(),['colosseum','frame','id','relationship','rift','sprite','title','username']);
        assert(!JSON.stringify(profile.data).includes('private'));assert(!('coins' in profile.data.rift));
        assert.equal((await http(a,'/community/profiles/1abc')).status,400);
        const search=await http(a,'/community/search?q='+encodeURIComponent(f.prefix));assert.equal(search.data.entries.length,4);
        assert.equal((await http(a,'/community/search?q=%25%25')).data.entries.length,0);
        assert.equal((await http(a,'/community/search?q=a')).status,400);
        assert.equal((await http(a,path,'POST',{action:'remove'})).status,200);assert.equal((await trainers.friends(b.id)).accepted.length,0);
        await trainers.friendAction(a.id,b.id,'request');await trainers.friendAction(b.id,a.id,'decline');assert.equal((await trainers.friends(a.id)).outgoing.length,0);
        await trainers.friendAction(a.id,b.id,'request');await trainers.friendAction(a.id,b.id,'cancel');assert.equal((await trainers.friends(b.id)).incoming.length,0);
        await trainers.friendAction(a.id,b.id,'request');await db.execute('DELETE FROM users WHERE id=?',[b.id]);assert.equal((await trainers.friends(a.id)).outgoing.length,0);
    }finally{await f.cleanup();}
});
test('profile SQL: Colosseum ranks and public record teams are separate for 30/60', {skip:!shouldRun},async()=>{
    const f=await fixture();const u=f.users[0];const colosseum=require('../server/persistence/colosseumRepository');try{
        for(const minutes of [30,60]){const run={id:randomUUID(),players:[u],durationMinutes:minutes,finishedAt:Date.now()};await colosseum.recordRunStarted(run);const score=minutes===30?require('../server/game/social/ranks').colosseumThresholds[2]:300;run.report={runId:run.id,colosseum:{score,wins:minutes===30?20:1,lastTeam:[{pokemonId:7,name:'Carapuce',level:12,currentHp:3,uuid:'private-uuid',iv:'private-iv'}]}};await colosseum.recordRunFinished(run);}
        const profile=await trainers.profile(f.users[1].id,u.id);assert.equal(profile.colosseum[0].rank.key,'gold');assert.equal(profile.colosseum[1].rank.key,'bronze');assert.equal(profile.rift.ratedGames,0);assert(!JSON.stringify(profile).includes('private-'));
        assert.equal((await colosseum.leaderboard(u.id,30)).personal.league.key,'gold');
    }finally{await f.cleanup();}
});

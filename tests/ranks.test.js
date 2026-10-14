const test=require('node:test');
const assert=require('node:assert/strict');
const ranks=require('../server/game/social/ranks');
test('ranks: Bronze to Diamond boundaries and separate Colosseum score progression',()=>{
    assert.equal(ranks.riftRank(1000,0).key,'unranked');
    const keys=['bronze','silver','gold','platinum','diamond'];
    for(let i=0;i<5;i++){
        assert.equal(ranks.riftRank(ranks.eloThresholds[i],1).key,keys[i]);
        assert.equal(ranks.colosseumRank(ranks.colosseumThresholds[i],1).key,keys[i]);
        if(i){assert.equal(ranks.riftRank(ranks.eloThresholds[i]-1,1).key,keys[i-1]);assert.equal(ranks.colosseumRank(ranks.colosseumThresholds[i]-1,1).key,keys[i-1]);}
    }
    assert.equal(ranks.colosseumRank().key,'unranked');
    assert.equal(ranks.riftRank(1900,2).progress,100);
});
test('Elo: equal duels transfer 24, upsets pay more, ties and sixteen players stay bounded',()=>{
    const make=(ratings,places)=>ratings.map((rating,i)=>({userId:i+1,rating,place:places[i]}));
    assert.deepEqual(ranks.calculateRatings(make([1000,1000],[1,2])).map(p=>p.delta),[24,-24]);
    assert(ranks.calculateRatings(make([800,1200],[1,2]))[0].delta>24);
    assert.deepEqual(ranks.calculateRatings(make([1000,1000],[1,1])).map(p=>p.delta),[0,0]);
    for(let n=2;n<=16;n++){
        const result=ranks.calculateRatings(make(Array.from({length:n},(_,i)=>800+i*80),Array.from({length:n},(_,i)=>i+1)));
        assert.equal(result.reduce((n,p)=>n+p.delta,0),0);
        assert(result.every(p=>Math.abs(p.delta)<=48 && p.after===p.before+p.delta));
        assert.deepEqual(ranks.calculateRatings(make(Array.from({length:n},(_,i)=>800+i*80),Array.from({length:n},(_,i)=>i+1)).reverse()).sort((a,b)=>a.userId-b.userId),result);
    }
    assert(ranks.calculateRatings(make([0,0],[1,2])).every(p=>p.after>=0));
});
test('placement: shared elimination rounds, winner, bye, early quitter and no survival-time bonus',()=>{
    const report={mode:'rift',players:[1,2,3,4,5].map(id=>({id,endedAt:id*1000})),matches:[
        {players:[1,2],round:2,status:'finished',winnerId:1},
        {players:[1,3],round:1,status:'finished',winnerId:1},
        {players:[2,4],round:1,status:'finished',winnerId:2}]};
    assert.deepEqual(ranks.placements([1,2,3,4,5],report,1).map(p=>p.place),[1,2,3,3,5]);
    report.players.reverse();assert.deepEqual(ranks.placements([1,2,3,4,5],report,1).map(p=>p.place),[1,2,3,3,5]);
    assert.equal(ranks.placements([1,2],report,1),null);
    assert.equal(ranks.placements([1,2,3,4,5],{...report,mode:'colosseum'},1),null);
    assert.throws(()=>ranks.calculateRatings([{userId:1,rating:1000,place:1}]),/invalide/);
});

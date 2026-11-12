const {dbPool,withTransaction}=require('../config/database');
async function recover(){await dbPool.execute("UPDATE whitepeak_tournaments SET phase='cancelled',snapshot=JSON_SET(snapshot,'$.phase','cancelled') WHERE phase IN ('waiting','running')");}
async function inspect(ids,config){return withTransaction(async c=>{const snapshots=await require('./whitepeakRepository')._duelStorage.snapshots(ids,c);for(const s of snapshots){require('../game/whitepeak/rules').validateTeam(s.team,{...config,uniqueItems:false,legendaryLimit:false});if(s.user.money<config.money)require('../game/whitepeak/rules').fail(`${s.user.username} n’a pas la mise nécessaire pour son premier duel.`);}return true;});}
async function save(t){
 const snapshot={id:t.id,hostId:t.hostId,config:t.config,phase:t.phase,ids:t.ids,names:t.names,rounds:t.rounds||[],winnerId:t.winnerId||null,createdAt:t.createdAt,finishedAt:t.finishedAt||null};
 await dbPool.execute('INSERT INTO whitepeak_tournaments(id,host_id,phase,revision,snapshot) VALUES(?,?,?,1,?) ON DUPLICATE KEY UPDATE phase=VALUES(phase),revision=revision+1,snapshot=VALUES(snapshot)',[t.id,t.hostId,t.phase,JSON.stringify(snapshot)]);
}
module.exports={recover,inspect,save};

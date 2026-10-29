const test=require('node:test'),assert=require('node:assert/strict');
const {rewardText}=require('../server/game/battle/rewardText');
test('reward reading moves to capable clients without delaying the authoritative reward; legacy readers retain their original pacing',async()=>{
 const emitted=[],waits=[],player={id:'owner'},sockets=new Map(),io={sockets:{sockets},to:id=>({emit:(event,data)=>emitted.push({id,event,data})})};
 sockets.set('other',{handshake:{auth:{rewardPlayback:true}}});
 await rewardText(player,io,'Gain déjà attribué',ms=>waits.push(ms),1300);
 assert.deepEqual(waits,[1300]);assert.deepEqual(emitted[0],{id:'owner',event:'battleText',data:{message:'Gain déjà attribué'}});
 sockets.set('owner',{handshake:{auth:{rewardPlayback:true}}});
 await rewardText(player,io,'Réserve : +10 XP',()=>{throw Error('No server pacing for this client');});
 assert.deepEqual(emitted[1],{id:'owner',event:'battleText',data:{message:'Réserve : +10 XP',reward:true,readMs:900}});
 sockets.get('owner').handshake.auth.rewardPlayback='true';
 await rewardText(player,io,'Lecture ancienne',ms=>waits.push(ms));assert.deepEqual(waits,[1300,900]);
});

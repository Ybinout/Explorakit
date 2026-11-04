const test=require('node:test'),assert=require('node:assert/strict');
const {observeBattlePresence}=require('../server/realtime/battlePresence');
const {toPublicPlayer}=require('../server/realtime/playerState');
function fixture(player={id:'owner',currentmap:'start',inbattle:false}){
 const packets=[];let current=true;const io={to:room=>({emit:(event,payload)=>packets.push({room,event,payload})})};observeBattlePresence(io,player,()=>current);return{player,packets,retire(){current=false;}};
}
test('battle status changes publish immediately without movement, and identical assignments send nothing',()=>{
 const f=fixture();assert.equal(f.packets.length,0);f.player.inbattle=true;f.player.inbattle=true;f.player.inbattle=false;f.player.inbattle=false;
 assert.deepEqual(f.packets.map(p=>p.payload.inbattle),[true,false]);assert(f.packets.every(p=>p.room==='adventure-map:start'&&p.event==='playerBattleStatus'));
 assert.equal(JSON.parse(JSON.stringify(f.player)).inbattle,false);assert.equal(toPublicPlayer(f.player).inbattle,false);
});
test('public status is isolated to the current world/floor and contains no private combat data',()=>{
 const f=fixture({id:'owner',currentmap:'super_tournament_room',superTournamentActive:true,superTournamentRoom:16,inbattle:false,equipe:{secret:true},opponent:{secret:true}});f.player.inbattle=true;
 assert.equal(f.packets[0].room,'adventure-map:super_tournament_room:floor:16');assert.deepEqual(f.packets[0].payload,{id:'owner',currentmap:'super_tournament_room',inbattle:true});
 f.player.currentmap='centre';f.player.inbattle=false;assert.equal(f.packets[1].room,'adventure-map:centre');
});
test('restored battles keep their initial flag; retired/disconnected player objects cannot emit ghost status',()=>{
 const f=fixture({id:'owner',currentmap:'jungle9',inbattle:true});assert.equal(toPublicPlayer(f.player).inbattle,true);assert.equal(f.packets.length,0);f.retire();f.player.inbattle=false;assert.equal(f.player.inbattle,false);assert.equal(f.packets.length,0);
});
test('client status updates preserve position, ignore stale/foreign/unknown players, and remove the point at battle end',async()=>{
 const {applyPlayerBattleStatus}=await import('../vue-explorakit/src/services/playerBattlePresence.js');const p={x:80,y:208,currentmap:'start',inbattle:false},players={owner:p};
 for(const payload of[{id:'missing',currentmap:'start',inbattle:true},{id:'owner',currentmap:'route1',inbattle:true},{id:'owner',currentmap:'start',inbattle:'true'}])assert.equal(applyPlayerBattleStatus(players,'start',payload),false);
 assert(applyPlayerBattleStatus(players,'start',{id:'owner',currentmap:'start',inbattle:true}));assert.deepEqual(p,{x:80,y:208,currentmap:'start',inbattle:true});assert(applyPlayerBattleStatus(players,'start',{id:'owner',currentmap:'start',inbattle:false}));assert.equal(p.inbattle,false);
});
test('the small red point uses the interpolated head position, clears friend nameplates and preserves canvas state',async()=>{
 const {drawPlayerBattleIndicator}=await import('../vue-explorakit/src/services/playerBattlePresence.js');const events=[],c={save:()=>events.push('save'),restore:()=>events.push('restore'),beginPath(){},arc:(...a)=>events.push(a),fill(){}};
 assert(drawPlayerBattleIndicator(c,{x:80.3,y:208.7}));assert.deepEqual(events[2].slice(0,3),[80,160,3]);assert.equal(c.fillStyle,'#ed5261');assert.equal(events.at(-1),'restore');events.length=0;
 assert(drawPlayerBattleIndicator(c,{x:80,y:208},true));assert.deepEqual(events[1].slice(0,3),[80,143,4.5]);const before=events.length;assert.equal(drawPlayerBattleIndicator(c,{x:NaN,y:208}),false);assert.equal(events.length,before);
});

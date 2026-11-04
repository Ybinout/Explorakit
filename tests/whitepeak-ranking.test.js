const test=require('node:test'),assert=require('node:assert/strict');
const logic=require('../server/game/whitepeak/rankings');
test('ranking history keeps the exact legacy score and never fabricates an old party',()=>{
 const rows=[{user_a:1,user_b:2,phase:'finished',offers_json:{config:{}},result_json:{winnerId:1,reason:'finished',refunded:false}}];
 const result=logic.history(rows,[{user_id:1,wins:1,losses:0,draws:0,points:30},{user_id:2,wins:0,losses:1,draws:0,points:0}]);
 assert.deepEqual(result.map(r=>[r.mode,r.userId,r.points]),[['1v1',1,30],['1v1',2,0]]);assert(result.every(r=>!Object.hasOwn(r,'team')));
});
test('collaborative history assigns the result to every ally and isolates each mode, excluding PvE and cancelled duels',()=>{
 const make=(mode,phase='finished')=>({phase,user_a:1,user_b:2,offers_json:{houseVersion:1,ids:[1,2,3],config:{mode}},result_json:{winnerId:2,winners:[2,3],reason:'finished',refunded:false}});
 const rows=logic.history([make('2v1'),make('2v2'),make('pve'),make('2v1','cancelled')],[]);
 assert.equal(rows.length,6);assert(rows.filter(r=>r.userId===2).every(r=>r.wins===1&&r.points===30));assert(rows.filter(r=>r.userId===1).every(r=>r.losses===1&&r.points===0));
});
test('last team snapshots contain only ordered species, with an explicit maximum of twelve',()=>{
 assert.deepEqual(logic.teamIds([{data:{id:94}},{data:{id:9}}]),[94,9]);assert.equal(logic.teamIds(Array(15).fill({data:{id:25}})).length,12);
});

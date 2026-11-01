const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createClub}=require('../server/realtime/whitepeakClub');
test('a burst is rejected before enqueueing behind a slow SQL operation',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),handlers=new Map(),answers=[];
 const repo={recoverDuels:async()=>{},rouletteState:async()=>null,leaderboard:async()=>{calls++;await gate;return[];}};
 const club=createClub({to:()=>({emit(){}})},{repository:repo,now:()=>100000,tickMs:0});await club.ready;
 const socket=new EventEmitter();socket.connected=true;socket.use=()=>{};socket.id='rate-test';
 club.attach({id:7,username:'Test',socket,account:{active:()=>true,on:(name,fn)=>handlers.set(name,fn)},getPlayer:()=>({currentmap:'ville5_maison1'}),canUse:()=>true});
 const work=[];for(let i=0;i<1000;i++){const result=handlers.get('whitepeak:board')({},r=>answers.push(r));if(result instanceof Promise)work.push(result);}
 assert.equal(work.length,35);assert.equal(answers.filter(r=>!r.success).length,965);release();await Promise.all(work);assert.equal(calls,35);assert.equal(answers.filter(r=>r.success).length,35);club.close();
});

const test=require('node:test'),assert=require('node:assert/strict');
const api=()=>import('../vue-explorakit/src/services/worldMovement.js');
const player=()=>({x:100,y:100,currentmap:'start',direction:'right',isMoving:true});
test('visual poses never mutate authoritative positions or exceed a confirmed destination',async()=>{
 const {WorldMovement}=await api(),r=new WorldMovement(),p=player(),copy={...p};r.seed('me',p,0);r.receive('me',p,{...p,x:132},10);assert.deepEqual(p,copy);
 let previous=100;for(let t=10;t<=400;t+=8){const pos=r.sample('me',p,t);assert(pos.x>=previous&&pos.x<=132);previous=pos.x;}assert.equal(previous,132);assert.equal(p.x,100);
});
test('walking frames progress across multiple packets, including expeditions with isMoving false',async()=>{
 const {WorldMovement}=await api(),r=new WorldMovement(),p=player(),frames=new Set();r.seed('me',p,0);
 for(let step=0;step<8;step++){const next={...p,x:p.x+32,isMoving:false};r.receive('me',p,next,step*150);Object.assign(p,next);for(let dt=0;dt<150;dt+=16)frames.add(Math.floor(r.sample('me',p,step*150+dt,true).frame)%4);}
 assert.deepEqual([...frames].sort(),[0,1,2,3]);assert.equal(r.sample('me',p,1800).x,p.x);
});
test('turns remain continuous while teleports, new maps and authoritative corrections snap',async()=>{
 const {WorldMovement}=await api(),r=new WorldMovement(),p=player();r.seed('me',p,0);const right={...p,x:132};r.receive('me',p,right,0);Object.assign(p,right);const middle=r.sample('me',p,75).x;
 r.receive('me',p,{...p,y:132,direction:'down'},75);const turned=r.sample('me',p,75);assert.equal(turned.x,middle);assert.equal(turned.direction,'down');
 r.receive('me',p,{...p,x:700},100);assert.equal(r.sample('me',p,100).x,700);
 r.receive('me',p,{...p,x:132,y:132},110,true);assert.equal(r.sample('me',p,110).y,132);
 const mapped={...p,currentmap:'route1',x:16};assert.equal(r.sample('me',mapped,120).x,16);r.remove('me');assert.equal(r.poses.size,0);r.seed('other',p,130);r.clear();assert.equal(r.poses.size,0);
});
test('rapid changes of direction wait for the next input slot instead of emitting a rejected burst',async()=>{
 const {movementInputWait}=await api();assert.equal(movementInputWait(undefined,100),0);assert.equal(movementInputWait(100,120),130);assert.equal(movementInputWait(100,250),0);assert.equal(movementInputWait(100,700),0);
});

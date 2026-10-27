const test=require('node:test'),assert=require('node:assert/strict');
const moduleUnderTest=()=>import('../vue-explorakit/src/services/wandaArena.js');
test('floating decorations stay at the sides, inside the hall and away from its central approach',async()=>{
 const {WANDA_STONES,WANDA_CRYSTALS,wandaFloatPose}=await moduleUnderTest();
 const props=[...WANDA_STONES,...WANDA_CRYSTALS];assert(props.length<=16);
 for(const p of props)for(let t=0;t<=30000;t+=250){const pose=wandaFloatPose(p,t);
  assert(Number.isInteger(pose.x)&&Number.isInteger(pose.y));assert(pose.x-p.w/2>12&&pose.x+p.w/2<436);assert(pose.y-p.h>50&&pose.y<275);
  assert(pose.x+p.w/2<185||pose.x-p.w/2>263,'the carpet and approach must stay clear');
  assert(pose.shadowY-pose.y>=6,'a visible gap separates the floating body and its shadow');
  assert(pose.glow>=.09&&pose.glow<=.15,'crystal light remains soft, without flashes');
 }
});
test('Wanda speaking freezes the floating clock briefly, resumes during speech and can trigger again',async()=>{
 const {WandaArenaRenderer,WANDA_PAUSE_MS}=await moduleUnderTest(),r=new WandaArenaRenderer();
 r.advance(0,true,false);r.advance(500,true,false);const before=r.floatTime;
 r.advance(550,true,true);assert.equal(r.floatTime,before);
 for(let t=600;t<=550+WANDA_PAUSE_MS;t+=50){r.advance(t,true,true);assert.equal(r.floatTime,before);}
 r.advance(1750,true,true);assert(r.floatTime>before);const resumed=r.floatTime;r.advance(1800,true,true);assert(r.floatTime>resumed,'the pause is not renewed by each frame');
 r.advance(1850,true,false);const second=r.floatTime;r.advance(1900,true,true);r.advance(2300,true,true);assert.equal(r.floatTime,second);
});
test('disabled motion and long frame gaps do not accumulate a sudden floating jump',async()=>{
 const {WandaArenaRenderer}=await moduleUnderTest(),r=new WandaArenaRenderer();
 r.advance(0,true,false);r.advance(50,true,false);const before=r.floatTime;
 r.advance(50000,false,false);assert.equal(r.floatTime,before);r.advance(50050,true,false);assert.equal(r.floatTime,before+50);
 r.advance(100000,true,false);assert(r.floatTime<=before+250);
});

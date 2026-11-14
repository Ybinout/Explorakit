const test=require('node:test'),assert=require('node:assert/strict'),{RaidBattle}=require('../server/game/raids/RaidBattle'),content=require('../server/game/raids/content'),motion=require('../server/game/raids/worldMotion'),codec=require('../server/game/drift/checkpointCodec');
const{make}=require('../scripts/calibrateCorruptionRaids');
function raid(){const party=Array.from({length:4},()=>({ownerId:1,ownerName:'Test',pokemon:make(9,100,4,['Splash'],'Keen Eye')}));return new RaidBattle(party,make(143,100,4,['Splash'],'Keen Eye'),{now:()=>1000,seed:[1,2,3,4]});}
test('HP never locks at 30% during the two vulnerable turns; second shield is eligible afterwards',()=>{
 const b=raid(),s=b.sim,p=b.bossPokemon,a=s.p1.active[0],move=s.dex.moves.get('tackle');s.damage(p.maxhp,p,a,move);assert.equal(p.hp,Math.ceil(p.maxhp*.7));assert.equal(s.raid.shieldsUsed,1);
 s.damage(s.raid.shield.hp+1,p,a,move);assert.equal(s.raid.shield.hp,0);const until=s.raid.vulnerableUntil;
 p.hp=Math.ceil(p.maxhp*.3);s.turn=until-1;let hp=p.hp;s.damage(100,p,a,move);assert.equal(p.hp,hp-100);assert.equal(s.raid.shieldsUsed,1);
 s.turn=until;hp=p.hp;s.damage(50,p,a,move);assert.equal(p.hp,hp-50);assert.equal(s.raid.shieldsUsed,1);
 s.turn=until+1;hp=p.hp;s.damage(100,p,a,move);assert.equal(s.raid.shieldsUsed,2);assert.equal(p.hp,hp-25);assert.equal(s.raid.shield.hp,s.raid.shield.max-100);
 s.damage(s.raid.shield.hp+1,p,a,move);assert.equal(s.raid.shield.hp,0);s.damage(p.maxhp*10,p,a,move);assert.equal(p.hp,0);assert(b.won);
});
test('a legacy snapshot stalled at the threshold resumes and can lose HP immediately',()=>{
 const b=raid(),s=b.sim,p=b.bossPokemon;s.raid.shieldsUsed=1;s.raid.shield={hp:0,max:Math.ceil(p.maxhp*.14)};s.raid.vulnerableUntil=s.turn+2;p.hp=Math.ceil(p.maxhp*.3);
 const r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000),before=r.bossPokemon.hp;r.sim.damage(27,r.bossPokemon,r.sim.p1.active[0],r.sim.dex.moves.get('tackle'));assert.equal(r.bossPokemon.hp,before-27);
});
test('a vulnerable boss may be knocked out; no phantom shield resurrects it or consumes a third phase',()=>{
 const b=raid(),s=b.sim,p=b.bossPokemon;s.raid.shieldsUsed=1;s.raid.shield={hp:0,max:500};s.raid.vulnerableUntil=s.turn+2;p.hp=50;s.damage(100,p,s.p1.active[0],s.dex.moves.get('tackle'));assert.equal(p.hp,0);assert.equal(s.raid.shieldsUsed,1);assert(!s.raid.events.some(e=>e.kind==='shield'));
});
test('each victory adds exactly the three existing crystals, retaining money, plates and pearl rates',()=>{
 const plates=require('../data/game/items.json').items.filter(i=>i.plateType);
 for(const difficulty of content.DIFFICULTIES.filter(d=>!d.id.startsWith('dc2-'))){for(const roll of [0,.99]){const r=content.rewards(difficulty.id,()=>roll);assert.equal(r.money,difficulty.reward);for(const[key,quantity]of [['crystal_shard',101],['clear_crystal',31],['aurora_prism',7]]){assert.equal(r.items.filter(i=>i.key===key).length,1);assert.equal(r.items.find(i=>i.key===key).quantity,quantity);}
 assert.equal(r.items.filter(i=>plates.some(p=>p.key===i.key)).length,roll===0||difficulty.id==='extreme'?plates.length:0);assert.equal(r.items.some(i=>i.key==='potential_pearl'),roll===0&&difficulty.pearl>0);}}
});
test('world rifts move faster, stop only within two tiles, and resume the remaining collision-safe segment',()=>{
 const r={map:'jungle1',x:16,y:16,from:{x:16,y:16},to:{x:48,y:16},movedAt:0,nextMove:1900,moveDurationMs:1400},choices=()=>[{x:80,y:16}];
 assert.deepEqual(motion.position(r,700),{x:32,y:16});assert.equal(motion.step(r,700,[{currentmap:'jungle1',x:160,y:16}],choices,()=>0),false);assert.equal(r.to.x,48,'players four tiles away do not stop the rift');
 assert(motion.step(r,700,[{currentmap:'jungle1',x:80,y:16}],choices,()=>0));assert.deepEqual(r.from,r.to);assert.equal(r.from.x,32);assert.equal(r.resumeTo.x,48);
 assert(motion.step(r,1200,[],choices,()=>0));assert.equal(r.to.x,48,'finish the interrupted corridor before turning');assert.equal(r.moveDurationMs,225);assert.deepEqual(motion.position(r,1312.5),{x:40,y:16});
 const replica=JSON.parse(JSON.stringify(r));for(const now of [1200,1350,1700,1900])assert.deepEqual(motion.position(replica,now),motion.position(r,now));
 assert(motion.step(r,2400,[{currentmap:'jungle2',x:48,y:16}],choices,()=>0));assert.equal(r.to.x,80);assert.equal(r.moveDurationMs,450);assert.equal(r.nextMove,2970);
});
test('rift client interpolation matches the server and its aura continues animating while stopped',async()=>{
 const{drawRaidRifts}=await import('../vue-explorakit/src/services/raidRifts.js'),calls=[],gradient={addColorStop(){}};
 const c=new Proxy({createRadialGradient:()=>gradient},{get:(o,k)=>o[k]||((...a)=>calls.push([k,...a])),set:(o,k,v)=>(o[k]=v,true)}),old=global.document;global.document={createElement:()=>({getContext:()=>c})};
 try{const r={from:{x:16,y:16},to:{x:48,y:16},movedAt:0,moveDurationMs:1400};drawRaidRifts(c,{rifts:[r]},700);assert(calls.some(a=>a[0]==='translate'&&a[1]===32&&a[2]===16));
 r.from=r.to={x:48,y:16};calls.length=0;drawRaidRifts(c,{rifts:[r]},800);const first=calls.find(a=>a[0]==='scale');calls.length=0;drawRaidRifts(c,{rifts:[r]},1600);assert.notDeepEqual(calls.find(a=>a[0]==='scale'),first,'pulse is independent of translation');assert(calls.some(a=>a[0]==='translate'&&a[1]===48&&a[2]===16));}finally{global.document=old;}
});
test('rage telemetry follows native damage, healing and redirection without changing its formulas',()=>{
 const b=raid(),s=b.sim,p=s.p1.active[0],other=s.p1.active[1];s.damage(100,b.bossPokemon,p,s.dex.moves.get('tackle'));let e=s.raid.events.filter(e=>e.kind==='aggro').at(-1);assert.equal(e.slot,0);assert.equal(e.value,100);assert.equal(e.shares.reduce((a,b)=>a+b,0),100);other.hp-=100;s.heal(50,other,p,s.dex.moves.get('healpulse'));e=s.raid.events.filter(e=>e.kind==='aggro').at(-1);assert.equal(e.value,100);assert.equal(e.shares.reduce((a,b)=>a+b,0),100);p.moveThisTurnResult=true;require('../server/game/raids/ruleset').format.onAfterMove.call(s,p,b.bossPokemon,s.dex.moves.get('followme'));assert.equal(s.raid.events.filter(e=>e.kind==='aggro').at(-1).value,100);
});
test('one authoritative rift movement is broadcast identically to two connected viewers and resumes beyond two tiles',async()=>{
 const {createRaidManager}=require('../server/realtime/raidManager'),terrain=require('../server/game/world/mapRepository');let now=Date.parse('2026-11-07T12:00:00Z');let world=content.createDay(now),r=world.rifts[0];const a=content.tiles(r.map)[0],grid=terrain.loadCollisionData(r.map),ports=terrain.changeMapData(r.map),x=Math.floor(a.x/32),y=Math.floor(a.y/32),d=[[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy])=>grid[y+dy]?.[x+dx]===0&&!ports[y+dy]?.[x+dx]&&!content.blockedByNpc(r.map,x+dx,y+dy)),b={x:a.x+d[0]*32,y:a.y+d[1]*32};
 for(const f of world.rifts)f.nextMove=now+3600000;Object.assign(r,a,{from:{...a},to:b,movedAt:now,moveDurationMs:1400,nextMove:now+1900});
 const manager=createRaidManager({now:()=>now,tickMs:0,store:{async world(){return world;},async saveWorld(v){world=v;},async loadActive(){return[];},async tutorialSeen(){return true;}}}),packets=[[],[]],players=[{currentmap:r.map,x:a.x+128,y:a.y},{currentmap:r.map,x:4000,y:4000}];
 try{await manager.ready;for(let i=0;i<2;i++)await manager.attach({id:i+1,username:'Viewer'+i,supported:true,getPlayer:()=>players[i],canUse:()=>true,socket:{connected:true,emit:(event,data)=>{if(event==='raid:world')packets[i].push(JSON.parse(JSON.stringify(data)));}}});
 now+=700;const mid=motion.position(r,now);players[0].x=mid.x+64;players[0].y=mid.y;await manager.tick();r=world.rifts[0];assert.deepEqual(r.from,r.to);assert.deepEqual(packets[0].at(-1).rifts,packets[1].at(-1).rifts);
 players[0].x=mid.x+128;now+=500;await manager.tick();r=world.rifts[0];assert.notDeepEqual(r.from,r.to);assert.equal(r.moveDurationMs,225);assert.deepEqual(packets[0].at(-1).rifts,packets[1].at(-1).rifts);
 const pos=motion.position(r,now);players[0].x=pos.x+32;players[0].y=pos.y;assert.equal(manager.nearby(1).id,r.id);
 }finally{await manager.stop();}
});

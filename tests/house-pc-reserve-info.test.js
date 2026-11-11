const test=require('node:test'),assert=require('node:assert/strict');
const computer=require('../server/game/world/pokemonComputer'),maps=require('../server/game/world/mapRepository');
const {make}=require('../scripts/calibrateCorruptionRaids');
for(const [map,terminal]of [['ville5_maison1',computer.HOUSE_TERMINAL],['whitepeak_club',computer.HOUSE_TERMINAL],['super_tournament_lobby',computer.TOURNAMENT_TERMINAL]])test(map+': PC visible near entrance, accessible without obstructing the room',()=>{
 const {x,y}=terminal,c=maps.loadCollisionData(map);assert.equal(c[y][x],1);
 const todo=[[14,17]],seen=new Set(['14,17']);for(let i=0;i<todo.length;i++){const[a,b]=todo[i];for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=a+dx,ny=b+dy,k=nx+','+ny;if(c[ny]?.[nx]===0&&!seen.has(k)){seen.add(k);todo.push([nx,ny]);}}}
 for(const[a,b]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){assert(seen.has(a+','+b));const p={currentmap:map,x:a*32+16,y:b*32+16};assert(computer.isNearComputer(p));assert.doesNotThrow(()=>computer.requireComputer(p));assert.throws(()=>computer.requireComputer({...p,inbattle:true}));}
 assert(!computer.isNearComputer({currentmap:map,x:14*32,y:17*32}));assert(!computer.isNearComputer({currentmap:'route1',x:(x+1)*32,y:y*32}));
 for(const k of terminal===computer.HOUSE_TERMINAL?['8,8','19,8','13,5','20,4','13,19']:['13,8','20,7','14,15','23,15','13,18'])assert(seen.has(k),k);
 assert.deepEqual(computer.devicesForMap(map),{map,devices:[terminal]});assert(Math.abs(x-14)<=2&&Math.abs(y-17)<=3);
 if(terminal===computer.HOUSE_TERMINAL)assert.equal(c[4][3],0,'Old corner is unblocked');
});
test('Doubles expose complete moves and PP only to their own camp, never spectators or opponents',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle');const players=[0,1].map(i=>({id:String(i),username:'Test'+i,equipe:{pokemons:[9,6,3].map(n=>make(n,100,4,['Tackle','Protect'],'Keen Eye'))}}));
 const b=new DoublesBattle(...players,{emit:()=>{}});const state=b.state(0);assert.equal(state.team.length,3);assert(!state.team[2].active);assert.deepEqual(state.team[2].moves.map(m=>m.name),['Tackle','Protect']);assert(state.team[2].moves.every(m=>m.pp>0&&m.maxpp>0));
 assert(state.active[1].every(p=>!('moves'in p)&&!('passiveAbility'in p)));const spectator=b.state(0,{spectator:true});assert.deepEqual(spectator.team,[]);assert(spectator.active.flat().every(p=>!('moves'in p)));b.sim.destroy();
});
test('Raids keep inspection separate from actionable moves and private to the owner, including KO allies',()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle');const b=new RaidBattle([1,1,2,2].map(ownerId=>({ownerId,ownerName:'Test'+ownerId,pokemon:make(9,100,4,['Tackle','Protect'],'Keen Eye')})),make(143,100,4,['Tackle'],'Keen Eye'),{now:()=>1000,seed:[1,2,3,4]});
 let v=b.view(1);assert.deepEqual(v.allies[1].inspectionMoves.map(m=>m.name),['Tackle','Protect']);assert.equal(v.allies[2].inspectionMoves,undefined);assert.equal(v.boss.inspectionMoves,undefined);
 b.sim.p1.active[0].hp=0;v=b.view(1);assert.deepEqual(v.allies[0].moves,[]);assert.equal(v.allies[0].inspectionMoves.length,2);b.sim.destroy();
});

test('Real Blanchecime door resolves a room with a PC, without substituting its decor name',()=>{
 const door=maps.getNextMap('ville5',3,16);assert.equal(door.nextMap,'ville5_maison1');assert.equal(maps.resolveMapSourceName(door.nextMap),'whitepeak_club');assert.deepEqual(computer.devicesForMap(door.nextMap),{map:door.nextMap,devices:[computer.HOUSE_TERMINAL]});
});

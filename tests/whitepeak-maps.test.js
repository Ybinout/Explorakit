const test=require('node:test'),assert=require('node:assert/strict');
const repo=require('../server/game/world/mapRepository'),rules=require('../server/game/whitepeak/rules');
function reachable(map,origin){const coll=repo.loadCollisionData(map),todo=[origin],seen=new Set([origin.join(',')]);for(let i=0;i<todo.length;i++){const[x,y]=todo[i];for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy,key=a+','+b;if(coll[b]?.[a]===0&&!seen.has(key)){seen.add(key);todo.push([a,b]);}}}return seen;}
test('both Whitepeak rooms have reachable exits, hosts, podiums and audience, with isolated collisions',()=>{
 const club=reachable(rules.HALL,[14,17]);for(const p of [...rules.PODIUMS,{x:13,y:5},{x:13,y:14},{x:20,y:4},{x:13,y:19}])assert(club.has(p.x+','+p.y),JSON.stringify(p));
 const casino=reachable(rules.CASINO,[14,17]);assert(casino.has('8,8'));assert(casino.has('13,19'));assert.equal(repo.loadCollisionData(rules.CASINO)[8][11],1);assert.equal(repo.loadCollisionData(rules.HALL)[8][8],0);
 for(const map of [rules.HALL,rules.CASINO])for(const x of [13,14]){assert(repo.changeMapData(map)[19][x]);assert.equal(repo.getNextMap(map,x,19).nextMap,'ville5');}
});
test('casino enters through its painted blue door, not either annex window',()=>{
 const coll=repo.loadCollisionData('ville5'),change=repo.changeMapData('ville5');
 assert.equal(coll[15][20],0);assert.equal(coll[16][23],21001);assert(change[15][20]);assert.equal(change[16][23],0);
 assert(reachable('ville5',[20,17]).has('20,15'));
 assert.equal(repo.getNextMap('ville5',20,15).nextMap,rules.CASINO);assert.equal(repo.getNextMap('ville5',3,16).nextMap,rules.HALL);
 for(const x of[13,14]){const point=repo.getNextMap(rules.CASINO,x,19);assert.equal(point.nextX,656);assert.equal(point.nextY,528);}
});
test('club walls and railing block walking, while every floor cushion and audience tile is passable',()=>{
 const coll=repo.loadCollisionData(rules.HALL),free=reachable(rules.HALL,[14,17]);
 for(let y=3;y<17;y++)for(const x of[0,1,26,27])assert.equal(coll[y][x],1);
 for(const y of[11,12])for(const x of[2,8,11,16,19,25])assert.equal(coll[y][x],1);
 for(const y of[13,14,15])for(let x=2;x<=25;x++){assert.equal(coll[y][x],0);assert(free.has(x+','+y));}
 for(let x=2;x<=25;x++)assert(free.has(x+',14'));
 for(const x of[2,4,7,10,11,16,17,20,23,25])assert(free.has(x+',13'),`Audience aisle ${x}`);
 for(const x of[13,14])for(let y=5;y<20;y++)assert(free.has(x+','+y));
});

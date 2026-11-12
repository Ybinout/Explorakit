const test=require('node:test'),assert=require('node:assert/strict');
const master=require('../server/game/berries/master'),rules=require('../server/game/berries/rules');
test('master teaches real, distinct native recipes, skipping known combinations and preferring unknown families',()=>{
 assert.equal(master.recipes.length,rules.catalog.families.length);
 assert.equal(new Set(master.recipes.map(r=>r.key)).size,master.recipes.length);
 const known=new Map();
 for(const expected of master.recipes){
  const recipe=master.choose(known,()=>0);assert.equal(recipe.key,expected.key);
  assert.deepEqual(rules.recipe(recipe.ingredients),recipe);
  for(const roll of[0,25,50,75,95])assert.equal(rules.mutate(recipe.ingredients,roll).family,recipe.family);
  known.set(recipe.key,recipe.family);
 }
 assert.equal(master.choose(known,()=>{throw Error('No random draw when exhausted');}),null);
 const existing=master.recipes[0];
 const next=master.choose(new Map([['another-combination',existing.family]]),()=>0);
 assert.notEqual(next.family,existing.family);
 assert.equal(master.choose(new Map(),n=>n-1).key,master.recipes.at(-1).key);
});
test('short teaching text follows growth/cost and explains ingredients, chance, risks, consumption and notebook',()=>{
 const result={status:'learned',recipe:master.recipes[0]},pages=master.pages(result),text=pages.map(p=>p.text).join(' ');
 assert.equal(pages.length,5);assert(pages.every(p=>p.text.length<340));
 for(const word of['10 Éclats fissurés','15 minutes','ingrédient','trois','aléatoire','échouer','bonus et un malus','Tous les Pokémon','consommée à l’entrée','carnet du Mutateur'])assert(text.includes(word),word);
 for(const key of result.recipe.ingredients)assert(text.includes(rules.catalog.classic.find(b=>'corrupted_'+b.key===key).name));
 assert(master.pages({...result,status:'already'}).some(p=>p.text.includes('Reviens demain')));
 assert(master.pages({status:'exhausted'}).some(p=>p.text.includes('toutes mes recettes')));
});
test('master is reachable on the arrival island, avoids exits/services and uses native interaction/body blocking',()=>{
 const island=require('../server/game/magicIsland/rules'),maps=require('../server/game/world/mapRepository');
 const actor=island.actors('ile2_04').find(a=>a.name===master.NAME);assert(actor);
 assert.equal(actor.spriteFrame.index,master.FRAME.index);
 const c=maps.loadCollisionData(actor.map),changes=maps.changeMapData(actor.map);
 for(const y of[actor.y-1,actor.y]){assert.equal(c[y][actor.x],0);assert.equal(changes[y][actor.x],0);}
 const store=island.scopedStore({getPnjsForMap:()=>[],getPnjAtTile:()=>null,isPnjBlockingTile:()=>false});
 assert(store.isPnjBlockingTile(actor.map,actor.x,actor.y));
 const p={currentmap:actor.map,x:(actor.x+1)*32+16,y:actor.y*32+16};
 assert.equal(island.near(p)?.name,master.NAME);
 assert(!island.near({...p,x:actor.x*32+32*5}));
 // Both sides of the street remain connected around the new two-cell body.
 const seen=new Set(),todo=[[5,10]];
 while(todo.length){const[x,y]=todo.pop(),key=x+','+y;if(seen.has(key)||c[y]?.[x]!==0||store.isPnjBlockingTile(actor.map,x,y))continue;seen.add(key);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])todo.push([x+dx,y+dy]);}
 assert(seen.has('13,8'));assert(seen.has('2,12'));
});

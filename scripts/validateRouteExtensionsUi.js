const assert=require('node:assert/strict');
const maps=require('../server/game/world/mapRepository');
const {getPnjsForMap}=require('../server/game/world/pnjStore');
// Only route along real walkable ground; no fixture teleport, grass encounter suppression or client movement override.
async function validateRouteExtensions(page,{step,capture,prefix=''}){
 async function position(){return page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return {map:v.map,x:Math.floor(p.x/32),y:Math.floor(p.y/32)};});}
 async function walk(x,y){
  const start=await position(),c=maps.loadCollisionData(start.map),t=maps.changeMapData(start.map),b=maps.battleMapData(start.map),residents=getPnjsForMap(start.map),key=(x,y)=>`${x}:${y}`,q=[[start.x,start.y]],parents=new Map([[key(start.x,start.y),null]]),target=key(x,y);
  for(let i=0;i<q.length&&!parents.has(target);i++){
   const [cx,cy]=q[i];for(const [dx,dy,action]of [[1,0,'move_d'],[-1,0,'move_q'],[0,1,'move_s'],[0,-1,'move_z']]){const nx=cx+dx,ny=cy+dy,k=key(nx,ny);if(parents.has(k)||c[ny]?.[nx]!==0||t[ny]?.[nx]||b[ny]?.[nx]||residents.some(p=>p.block!==false&&p.x===nx&&(p.y===ny||p.y-1===ny)))continue;parents.set(k,{previous:key(cx,cy),x:nx,y:ny,action});q.push([nx,ny]);}
  }
  assert(parents.has(target),`${start.map}: no safe path to ${target}`);const path=[];for(let k=target;parents.get(k);k=parents.get(k).previous)path.unshift(parents.get(k));
  for(const p of path){await page.waitForTimeout(160);await page.evaluate(a=>window.cityVm.socket.emit('playerAction',a),p.action);await page.waitForFunction(p=>{const v=window.cityVm,a=v.players[v.socket.id];return Math.floor(a.x/32)===p.x&&Math.floor(a.y/32)===p.y;},p);assert.equal(await page.evaluate(()=>window.cityVm.battle),false);}
 }
 await step('move_s','gen_route7');assert.match(await page.locator('.location-name').innerText(),/Route 9/);await capture(prefix+'route9');
 await walk(6,18);await step('move_s','gen_route6');assert.match(await page.locator('.location-name').innerText(),/Route 10/);await capture(prefix+'route10');
 await walk(20,8);await step('move_z','gen_shop_route10');assert.match(await page.locator('.location-name').innerText(),/Route 10/);await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.waitForFunction(()=>!window.cityVm.shop.loading);
 const before=await page.evaluate(()=>{const v=window.cityVm;return {item:v.shop.catalog.find(i=>i.key==='pokeball'),money:v.shop.money,quantity:v.bagItems.find(i=>i.key==='pokeball')?.quantity||0};});assert(before.item);assert(before.money>=before.item.price);
 await page.locator('.shop-item').filter({has:page.getByText(before.item.name,{exact:true})}).locator('.shop-buy-controls button').click();
 await page.waitForFunction(q=>{const v=window.cityVm;return !v.shop.loading&&!v.shop.error&&(v.bagItems.find(i=>i.key==='pokeball')?.quantity||0)===q+1;},before.quantity);assert.equal(await page.evaluate(()=>window.cityVm.shop.money),before.money-before.item.price);await page.locator('.shop-close').click();
 await step('move_s','gen_route6');assert.deepEqual(await position(),{map:'gen_route6',x:20,y:8});
 await walk(14,18);const city=await require('./validateClairfontaineUi').validateClairfontaine(page,{walk,step,capture,prefix});
 if(!await page.evaluate(()=>window.cityVm.isDrift))assert((await page.evaluate(()=>new Promise(r=>window.cityVm.socket.emit('requestGameSave',r)))).success);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.cityVm=v;return true;});assert.deepEqual(await position(),{map:'gen_route6',x:14,y:18});
 await walk(6,1);await step('move_z','gen_route7');assert.deepEqual(await position(),{map:'gen_route7',x:6,y:18});await walk(23,1);await step('move_z','gen_ville5');assert.deepEqual(await position(),{map:'gen_ville5',x:23,y:18});
 return {walkedBothRoads:true,shopPurchase:true,city,reconnected:true,returnedToOcreville:true};
}
module.exports={validateRouteExtensions};

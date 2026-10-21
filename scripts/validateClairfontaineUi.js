const assert=require('node:assert/strict');
async function validateClairfontaine(page,{walk,step,capture,prefix=''}){
 async function position(){return page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return {map:v.map,x:Math.floor(p.x/32),y:Math.floor(p.y/32)};});}
 async function talk(name){await page.evaluate(()=>{const v=window.cityVm;v.preferences.textSpeed=10000;v.socket.emit('Space');});await page.waitForFunction(n=>window.cityVm.endSentences===n&&window.cityVm.textImageSequence.length>0,name);await page.evaluate(()=>window.cityVm.clearSequence());await page.waitForFunction(()=>window.cityVm.textImageSequence.length===0);}
 await step('move_s','ville3');assert.deepEqual(await position(),{map:'ville3',x:14,y:1});assert.match(await page.locator('.location-name').innerText(),/Clairfontaine/);await walk(9,12);await capture(prefix+'clairfontaine');
 const doors=[[23,6,'centre'],[5,8,'ville3_arene'],[22,13,'ville3_shop'],[5,16,'ville3_maison1'],[15,16,'ville3_maison2']];
 for(const [x,y,map]of doors){
  await walk(x,y+1);await step('move_z',map);
  if(map==='centre'){
   await walk(9,10);await page.evaluate(()=>{window.clairfontaineHealed=null;window.cityVm.socket.once('teamStateChanged',s=>window.clairfontaineHealed=s);});await talk('centre');await page.waitForFunction(()=>window.clairfontaineHealed?.equipe?.pokemons?.every(p=>p.currentHp===p.maxHp&&p.status==='normal'));
   await walk(17,9);await page.setViewportSize({width:393,height:852});await page.evaluate(()=>window.cityVm.showMobileControls=true);await page.locator('.mobile-action-a').click();await page.locator('.pc-terminal').waitFor();assert.equal(await page.locator('.pc-box-slot').count(),30);await page.locator('.pc-close').click();
  }else if(map==='ville3_shop'){
   await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.waitForFunction(()=>!window.cityVm.shop.loading);const before=await page.evaluate(()=>{const v=window.cityVm;return {item:v.shop.catalog.find(i=>i.key==='pokeball'),money:v.shop.money,quantity:v.bagItems.find(i=>i.key==='pokeball')?.quantity||0};});assert(before.item&&before.money>=before.item.price);await page.locator('.shop-item').filter({has:page.getByText(before.item.name,{exact:true})}).locator('.shop-buy-controls button').click();await page.waitForFunction(q=>!window.cityVm.shop.loading&&!window.cityVm.shop.error&&(window.cityVm.bagItems.find(i=>i.key==='pokeball')?.quantity||0)===q+1,before.quantity);assert.equal(await page.evaluate(()=>window.cityVm.shop.money),before.money-before.item.price);await page.locator('.shop-close').click();
  }else{
   const name=map==='ville3_arene'?'clairfontaine_accueil_arene':map==='ville3_maison1'?'clairfontaine_habitant1':'clairfontaine_habitant2';await walk(13,map==='ville3_arene'?8:9);await talk(name);assert.equal(await page.evaluate(()=>window.cityVm.battle),false);
  }
  await walk(13,map==='centre'?14:16);await step('move_s','ville3');assert.deepEqual(await position(),{map:'ville3',x,y:y+1});
 }
 if(!await page.evaluate(()=>window.cityVm.isDrift))assert((await page.evaluate(()=>new Promise(r=>window.cityVm.socket.emit('requestGameSave',r)))).success);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.cityVm=v;return true;});assert.deepEqual(await position(),{map:'ville3',x:15,y:17});
 await walk(1,16);await step('move_q','ville3');await page.waitForFunction(()=>{const v=window.cityVm,p=v.players[v.socket.id];return v.interactionNotice.includes('ouest')&&Math.floor(p.x/32)===0;});assert.deepEqual(await position(),{map:'ville3',x:0,y:16});await page.waitForTimeout(160);await page.evaluate(()=>window.cityVm.socket.emit('playerAction','move_q'));await page.waitForTimeout(200);assert.deepEqual(await position(),{map:'ville3',x:0,y:16});await walk(1,16);await walk(14,1);await step('move_z','gen_route6');assert.deepEqual(await position(),{map:'gen_route6',x:14,y:18});
 return {fiveDoorsAndReturns:true,centerHeal:true,centerPcViaA:true,shopPurchase:true,houseAndGymDialogues:true,reconnectedInCity:true,westClosed:true,returnedToRoute10:true};
}
module.exports={validateClairfontaine};

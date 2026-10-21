const assert=require('node:assert/strict'),path=require('node:path');
// Browser-only catalogue fixture; real use/persistence are exercised by release/strategy.
async function validateBagUi(page,output,width){
 const fixture=[['potion','medicine',3],['antidote','medicine',2],['drift_potion','heal',4],['pokeball','ball',12],['superball','ball',4],['repel','field',2],['oran_berry','held',3],['leftovers','held',1],['thunder_stone','evolution',1],['clara_registry','key',1],['unknown_supply','future',1],['zero_supply','medicine',0]].map(([key,category,quantity])=>({key,category,quantity,name:{potion:'Potion',antidote:'Antidote',pokeball:'Poké Ball',superball:'Super Ball',oran_berry:'Baie Oran',leftovers:'Restes',thunder_stone:'Pierre Foudre',clara_registry:'Registre des refuges',unknown_supply:'Équipement de voyage'}[key]||key,description:'Un objet à emporter pour la suite de ton voyage.'}));
 await page.evaluate(items=>{const v=window.journalTestVm;window.bagOriginalItems=v.bagItems;v.bagItems=items;},fixture);
 const expectations={medicine:['potion','antidote','drift_potion'],balls:['pokeball','superball'],field:['repel'],berries:['oran_berry'],held:['leftovers'],evolution:['thunder_stone'],key:['clara_registry'],other:['unknown_supply']};
 for(const [pocket,keys]of Object.entries(expectations)){
  await page.locator(`[data-bag-pocket="${pocket}"]`).click();
  for(const tab of await page.locator('[data-bag-pocket]').all())assert((await tab.boundingBox()).height>=44);
  assert.deepEqual(await page.locator('.bag-item-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.itemKey)),keys);
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-bag-pocket'),pocket);
  for(const key of keys){await page.locator(`[data-item-key="${key}"] .bag-item-select`).click();assert.equal(await page.locator('.bag-item-detail').count(),1);assert(await page.locator(`[data-item-key="${key}"] .bag-item-description`).isVisible());}
  assert(await page.locator('.bag-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  assert(await page.locator('.pack-pockets').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
 }
 await page.locator('[data-bag-pocket="medicine"]').click();await page.locator('[data-item-key="antidote"] .bag-item-select').click();
 await page.evaluate(()=>{const v=window.journalTestVm;v.bagItems=v.bagItems.map(i=>i.key==='antidote'?{...i,quantity:0}:i);});
 await page.locator('[data-item-key="antidote"]').waitFor({state:'hidden'});assert.equal(await page.locator('[data-item-key="potion"] .bag-item-select').getAttribute('aria-expanded'),'true');
 // Theme surfaces and all compartments, including the readable empty state.
 for(const mode of ['light','dark']){
  await page.evaluate(mode=>document.documentElement.setAttribute('data-game-theme-mode',mode),mode);
  for(const pocket of ['medicine','balls','field','berries','held','evolution','key']){await page.locator(`[data-bag-pocket="${pocket}"]`).click();await page.screenshot({path:path.join(output,`bag-${pocket}-${mode}-${width}.png`)});}
 }
 await page.evaluate(()=>document.documentElement.setAttribute('data-game-theme-mode','light'));
 await page.locator('[data-bag-pocket="field"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-bag-pocket="berries"]').getAttribute('aria-selected'),'true');assert(await page.locator('[data-bag-pocket="berries"]').evaluate(n=>n===document.activeElement));
 await page.keyboard.press('Home');assert.equal(await page.locator('[data-bag-pocket="medicine"]').getAttribute('aria-selected'),'true');
 await page.locator('.bag-panel .panel-close').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('.bag-panel').evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Tab');assert(await page.locator('.bag-panel .panel-close').evaluate(n=>n===document.activeElement));
 await page.evaluate(()=>{window.journalTestVm.bagItems=[];});await page.locator('.pack-empty strong').waitFor();assert.equal(await page.locator('.bag-item-row').count(),0);assert.equal(await page.locator('[data-bag-pocket="other"]').count(),0);await page.screenshot({path:path.join(output,`bag-empty-${width}.png`)});
 await page.evaluate(()=>{window.journalTestVm.bagItems=window.bagOriginalItems;delete window.bagOriginalItems;});
 return {pockets:8,themeModes:2,quantitiesAndDepletion:true,unknownAndEmptyItems:true,keyboardAndFocus:true};
}
module.exports={validateBagUi};

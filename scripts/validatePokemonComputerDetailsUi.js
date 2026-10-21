const assert=require('node:assert/strict'),path=require('node:path');
async function validateComputerDetails(page,output,expected,{source='box',fullCapture=false}={}){
 const originalState=await page.evaluate(()=>JSON.stringify(window.pcVm.pc.state));
 const before=await page.evaluate(()=>({count:window.pcVm.pc.state.count,team:window.pcVm.pc.state.team.map(p=>p.uuid),entries:window.pcVm.pc.state.entries.map(e=>e.pokemon.uuid)}));
 await page.locator('[data-pc-details]').click();await page.locator('.companion-sheet').waitFor();
 assert(await page.locator('.pc-backdrop').evaluate(n=>n.inert));assert.equal(await page.locator('.companion-evolutions').count(),0);assert.match(await page.locator('.companion-kicker').innerText(),source==='box'?/PC · BOÎTE/:/PC · TON ÉQUIPE/);
 assert.equal(await page.locator('[data-companion-move]').count(),expected.moves.length);
 for(const move of expected.moveDetails)assert.equal(await page.locator(`[data-companion-move="${move.name}"] dd`).last().innerText(),`${move.pp} / ${move.maxPp}`);
 if(expected.nature==='Modest')assert.match(await page.locator('.companion-traits').innerText(),/Modeste/);
 for(const tab of ['stats','iv','ev']){
  await page.locator(`#companion-tab-${tab}`).click();
  const keys=['hp','attack','defense','speed','specialDefense','specialAttack'];const values=keys.map(k=>tab==='stats'?Number(k==='hp'?expected.maxHp:expected.stats[k]):Number(expected[tab][k]));
  assert.deepEqual(await page.locator('.companion-stat-lines strong').evaluateAll(nodes=>nodes.map(n=>Number(n.firstChild.textContent.trim()))),values);
 }
 assert(await page.locator('.companion-close').evaluate(n=>n===document.activeElement || document.querySelector('.companion-sheet').contains(document.activeElement)));
 if(fullCapture){
  for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
   await page.setViewportSize({width,height});for(const mode of ['light','dark']){
    await page.evaluate(mode=>document.documentElement.setAttribute('data-game-theme-mode',mode),mode);
    assert(await page.locator('.companion-sheet').evaluate(n=>n.scrollWidth<=n.clientWidth+1));assert(await page.locator('.companion-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.locator('.companion-heading').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`pc-details-${mode}-${width}.png`)});
   }
  }
  await page.evaluate(()=>document.documentElement.setAttribute('data-game-theme-mode','light'));await page.setViewportSize({width:393,height:852});
 }
 const next=page.locator('.companion-footer button').last();if(await next.isEnabled()){
  const previousTitle=await page.locator('.companion-heading h2').innerText();await next.click();assert.notEqual(await page.locator('.companion-heading h2').innerText(),previousTitle);assert.equal(await page.locator('#companion-tab-ev').getAttribute('aria-selected'),'true');await page.locator('.companion-footer button').first().click();assert.equal(await page.locator('.companion-heading h2').innerText(),previousTitle);
 }
 await page.locator('.companion-close').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('.companion-sheet').evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Escape');await page.locator('.companion-sheet').waitFor({state:'hidden'});assert(await page.locator('.pc-terminal').isVisible());assert(await page.locator('[data-pc-details]').evaluate(n=>n===document.activeElement));
 assert.deepEqual(await page.evaluate(()=>({count:window.pcVm.pc.state.count,team:window.pcVm.pc.state.team.map(p=>p.uuid),entries:window.pcVm.pc.state.entries.map(e=>e.pokemon.uuid)})),before);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.pcVm.pc.state)),originalState);
 return {statsIvEv:true,readOnly:true,movePp:true,navigation:true,focusRestored:true};
}
module.exports={validateComputerDetails};

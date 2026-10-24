const assert=require('node:assert/strict'),path=require('node:path');
async function validateArenaEntranceUi(page,output){
 const maps=['ville1_arene','ville_safe1_arene','gen_arene5','ville3_arene','ville4_arene','ville5_arene'];
 const names=['Mounir','Hoze','Raph','Ana','Wanda','7p'];
 const originalMap=await page.evaluate(()=>window.combatVm.map);
 async function start(map,kind='arena',portraitSuffix=''){
  await page.evaluate(async({map,kind,portraitSuffix})=>{
   const vm=window.combatVm,b=vm.$refs.battleOverlay;
   vm.map=map;await vm.$nextTick();
   vm.socket.listeners('battletrigger').forEach(fn=>fn({musicKind:kind,battleType:kind}));
   if(portraitSuffix&&b.entranceChampion)b.entranceChampion.src+=portraitSuffix;
   const mon=(uuid,id)=>({uuid,name:uuid,data:{id},level:20,k:2,currentHp:40,maxHp:40,experience:1000,abilities:['Tackle'],movePp:[35]});
   window.arenaStartedAt=performance.now();
   vm.socket.listeners('introAnimation').forEach(fn=>fn({player:{equipe:{pokemons:[mon('ally',7)]}},wildPokemon:mon('enemy',19)}));
   vm.socket.listeners('requestAction').forEach(fn=>fn({message:'Choisis ton action.'}));
  },{map,kind,portraitSuffix});
 }
 async function ready(){await page.locator('[data-battle-entrance]').waitFor({state:'hidden'});await page.locator('.action-attack:enabled').waitFor();}
 try{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.combatVm.preferences.animationsEnabled=true);
  for(let i=0;i<maps.length;i++)for(const [width,height]of [[393,852],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(w=>window.combatVm.showMobileControls=w<=920,width);
   await start(maps[i]);await page.locator('.portrait-ready').waitFor();
   assert.equal(await page.locator('[data-arena-intro] h2').innerText(),names[i]);
   assert(await page.locator('.entrance-portrait').evaluate(img=>img.complete&&img.naturalWidth>=1000));
   assert(await page.locator('.action-attack').isDisabled());
   assert(await page.locator('.battle-action-shell').evaluate(el=>el.inert));
   await page.waitForTimeout(800);await page.screenshot({path:path.join(output,`champion-${i}-${width}.png`)});
   await ready();assert(await page.evaluate(()=>performance.now()-window.arenaStartedAt>=2700));
  }
  for(const [width,height]of [[320,568],[844,390]]){
   await page.setViewportSize({width,height});await start('ville_safe1_arene');await page.locator('.portrait-ready').waitFor();
   const b=await page.locator('[data-arena-intro]').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1);
   await page.waitForTimeout(850);await page.screenshot({path:path.join(output,`champion-small-${width}.png`)});await ready();
  }
  for(const kind of ['wild','pvp','colosseum']){
   await start('ville1_arene',kind);assert.equal(await page.locator('[data-arena-intro]').count(),0);await ready();
  }
  // Failed illustration falls back to champion text, never a broken image or blocked turn.
  await page.route('**/*arena-art=broken',route=>route.fulfill({status:200,contentType:'image/png',body:'invalid image'}));
  await start('ville_safe1_arene','arena','?arena-art=broken');await page.locator('[data-arena-intro]').waitFor();await ready();
  await page.unroute('**/*arena-art=broken');
  // Portrait arriving just after the 2.4 s asset deadline must still be readable.
  await page.route('**/*arena-art=late',async route=>{await new Promise(r=>setTimeout(r,2600));await route.continue();});
  await start('ville_safe1_arene','arena','?arena-art=late');await page.locator('.portrait-ready').waitFor();
  await page.waitForTimeout(700);assert.equal(await page.locator('[data-battle-entrance]').getAttribute('data-phase'),'holding');
  await ready();assert(await page.evaluate(()=>performance.now()-window.arenaStartedAt>=4000));await page.unroute('**/*arena-art=late');
  // A stalled image is bounded, and a cancelled reveal cannot affect a new battle.
  let release;await page.route('**/*arena-art=slow',async route=>{await new Promise(r=>{release=r;});await route.continue().catch(()=>{});});
  await start('ville_safe1_arene','arena','?arena-art=slow');await page.waitForTimeout(700);
  assert(await page.locator('.action-attack').isDisabled());await ready();release?.();await page.unroute('**/*arena-art=slow');
  await start('ville1_arene');await page.locator('[data-arena-intro]').waitFor();await start('ville_safe1_arene','wild');await ready();assert.equal(await page.locator('[data-arena-intro]').count(),0);
  for(const system of [true,false]){
   await page.emulateMedia({reducedMotion:system?'reduce':'no-preference'});await page.evaluate(system=>window.combatVm.preferences.animationsEnabled=system,system);
   await start('ville4_arene');await page.locator('.portrait-ready').waitFor();
   assert.equal(await page.locator('.entrance-portrait').evaluate(el=>getComputedStyle(el).animationName),'none');await ready();
  }
  return {champions:6,viewports:4,decodedArt:true,commandsQueued:true,boundedFailure:true,latePortraitReadable:true,cancellation:true,reducedMotion:true,otherEncountersUnchanged:true};
 }finally{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(map=>{const vm=window.combatVm;vm.$refs.battleOverlay.resetBattleUi();vm.battle=false;vm.lock=false;vm.map=map;vm.preferences.animationsEnabled=true;},originalMap);
 }
}
module.exports={validateArenaEntranceUi};

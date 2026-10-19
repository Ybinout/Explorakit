const assert=require('node:assert/strict'),path=require('node:path');
async function validateBattleConditions(page,output){
 const results=[];
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});
  await page.evaluate(async()=>{const vm=window.battleTestVm;vm.showMobileControls=innerWidth<1000;await vm.$nextTick();const b=vm.$refs.battleOverlay;b.clearAllTimers();b.resultFx.visible=false;for(const m of [b.currentPokemon,b.opponent])delete m.__battle;await b.$nextTick();});
  const before=await page.locator('.battle-main-actions').boundingBox();
  const check=await page.evaluate(async()=>{
   const b=window.battleTestVm.$refs.battleOverlay;
   const state={player:structuredClone(JSON.parse(JSON.stringify(b.player))),wildPokemon:JSON.parse(JSON.stringify(b.opponent))};
   for(const m of [state.player.equipe.pokemons[0],state.wildPokemon])m.__battle={statStages:{attack:2,defense:-1,specialAttack:3,specialDefense:-2,speed:2,accuracy:1,evasion:-1},substituteHp:15,confusionTurns:2};
   b.presentEvent('updateBattleState',state);await b.$nextTick();await new Promise(r=>setTimeout(r,30));
   const kinds=b.conditionFx.player.map(e=>e.kind);if(!kinds.includes('up')||!kinds.includes('down')||!kinds.includes('shield')||!kinds.includes('status'))throw Error('Missing resolved effects');
   if(!document.querySelector('.battle-condition-notice'))throw Error('Missing readable condition notice');
   await b._presentation.drain();
   const row=document.querySelector('.battle-status-player .battle-conditions');
   if(!row.textContent.includes('VIT +2')||row.scrollWidth<=row.clientWidth)throw Error('Badges missing or not scrollable');
   row.scrollLeft=row.scrollWidth;if(!row.scrollLeft)throw Error('Cannot reveal later effects');row.scrollLeft=0;
   b.playMoveAnimation({actor:'player',damageClass:'status',moveTarget:'opponent'});const target=b.getSpriteGeometry('wild');if(b.movePath.startX!==target.centerX)throw Error('Status move affects wrong Pokémon');b.clearMoveFx();
   b.playMoveResult({actor:'player',success:true,hits:5,effectiveness:1});await b.$nextTick();if(document.querySelectorAll('.condition-hit').length!==5)throw Error('Multi-hit impacts missing');
   return {badges:row.children.length,kinds};
  });
  if(width===393){
   const row=page.locator('.battle-status-player .battle-conditions'),r=await row.boundingBox(),touch=await page.context().newCDPSession(page);
   const x=r.x+r.width-5,y=r.y+r.height/2;
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=5;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*(r.width-10)/5,y}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForFunction(()=>document.querySelector('.battle-status-player .battle-conditions').scrollLeft>0);
   await touch.detach();
  }
  const after=await page.locator('.battle-main-actions').boundingBox();if(width<1000)for(const k of ['x','y','width','height'])assert(Math.abs(before[k]-after[k])<1,'Effects moved action buttons');
  const cards=await page.locator('.battle-status').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  assert(!(cards[0].right>cards[1].x&&cards[0].bottom>cards[1].y),'Cards overlap with all effects');
  await require('./validateBattleFeedback').validateBattleLabels(page,width,height,output);
  await page.screenshot({path:path.join(output,`battle-conditions-${width}.png`)});results.push({width,...check});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(async()=>{const b=window.battleTestVm.$refs.battleOverlay;b.clearAllTimers();const state={player:JSON.parse(JSON.stringify(b.player)),wildPokemon:JSON.parse(JSON.stringify(b.opponent))};state.player.equipe.pokemons[0].__battle.statStages.speed=-2;await b.presentEvent('updateBattleState',state);if(b.conditionFx.player.length)throw Error('Reduced motion ignored');if(!document.querySelector('.battle-status-player .battle-conditions').textContent.includes('VIT -2'))throw Error('Reduced motion hides information');b.clearAllTimers();for(const m of [b.currentPokemon,b.opponent])delete m.__battle;await b.$nextTick();});
 await page.emulateMedia({reducedMotion:'no-preference'});return results;
}
module.exports={validateBattleConditions};

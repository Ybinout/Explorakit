const assert=require('node:assert/strict'),path=require('node:path');
async function validateMoveLibraryUi(page,output){
 const results=[];
 for(const width of [393,1365]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(width=>{
   const root=window.combatVm;root.battle=true;root.showMobileControls=width<920;
   const b=root.$refs.battleOverlay;b.resetBattleUi();b.entrancePhase='ready';b.finishing=false;
   window.moveFixture={own:{uuid:'visual-own',name:'Bulbizarre',data:{id:1},currentHp:60,maxHp:100,level:20,abilities:['Tackle'],__battle:{}},enemy:{uuid:'visual-enemy',name:'Salamèche',data:{id:4},currentHp:100,maxHp:100,level:20,abilities:['Tackle'],__battle:{}}};
   window.moveState=()=>({player:{equipe:{pokemons:[structuredClone(window.moveFixture.own)]}},wildPokemon:structuredClone(window.moveFixture.enemy)});
   b.updateBattleState(window.moveState());
  },width);
  await page.waitForFunction(()=>[...document.querySelectorAll('.battle-sprite')].every(i=>i.complete&&i.naturalWidth));
  for(const [moveName,family] of [['Crunch','bite'],['Slash','claw'],['Fire Punch','punch'],['Tackle','charge'],['Ice Beam','beam'],['Shadow Ball','projectile'],['Giga Drain','drain'],['Earthquake','zone']]){
   await page.evaluate(async ({moveName,family})=>{
    const b=window.combatVm.$refs.battleOverlay;b.resetBattleUi();b.entrancePhase='ready';
    window.moveFixture.own.currentHp=60;window.moveFixture.enemy.currentHp=100;b.updateBattleState(window.moveState());
    await b.$nextTick();
    for(const [side,anchor] of [['wild',b.$refs.opponentAnchor],['player',b.$refs.playerAnchor]]){const img=anchor.querySelector('img');if(img.complete)b.calibrateBattleSprite({currentTarget:img},side);}
    await b.$nextTick();
    window.moveCheck=[];const original=b.transitionWait.bind(b);b.transitionWait=async ms=>{
     window.moveCheck.push({phase:b.battleMoveFx.stage,own:b.currentPokemon.currentHp,enemy:b.opponent.currentHp});await original(ms);
    };
    b.presentEvent('playMoveAnimation',{actor:'player',moveName,moveType:family==='drain'?'Grass':'Water',damageClass:['beam','projectile','drain','zone'].includes(family)?'special':'physical'});
    b.presentEvent('playMoveResult',{actor:'player',damage:30,effectiveness:1});
    window.moveFixture.enemy.currentHp=70;if(family==='drain')window.moveFixture.own.currentHp=80;
    window.moveDone=b.presentEvent('updateBattleState',window.moveState()).finally(()=>{b.transitionWait=original;});
   },{moveName,family});
   await page.waitForFunction(family=>{const b=window.combatVm.$refs.battleOverlay;return b.battleMoveFx.stage==='impact'&&b.opponent.currentHp===70&&b.battleMoveFx.family===family;},family);
   await page.waitForTimeout(80);
   if(width===393)await page.screenshot({path:path.join(output,`move-${family}-${width}.png`)});
   const check=await page.evaluate(async()=>{await window.moveDone;return window.moveCheck;});
   assert(check.some(e=>e.phase==='travel'&&e.enemy===100),`${family}: HP lost before arrival`);
   if(family==='drain')assert(check.some(e=>e.phase==='drain'&&e.own===60&&e.enemy===70),'Drain must travel back before heal');
   results.push({width,family,hpSynchronized:true});
  }
  await page.evaluate(async()=>{
   const b=window.combatVm.$refs.battleOverlay;
   await b.presentEvent('playMoveAnimation',{actor:'opponent',moveName:'Shadow Ball',moveType:'Ghost',damageClass:'special'});
   if(b.movePath.startX <= b.movePath.targetX)throw Error('Enemy projectile has incorrect direction');
   await b.presentEvent('playMoveResult',{actor:'opponent',damage:25,effectiveness:1});
   window.moveFixture.own.currentHp=35;await b.presentEvent('updateBattleState',window.moveState());
   if(b.currentPokemon.currentHp!==35)throw Error('Enemy projectile hit wrong side');
   window.moveFixture.enemy.__battle={protect:true,substituteHp:25};await b.presentEvent('updateBattleState',window.moveState());
  });
  assert.equal(await page.locator('[data-battle-shield]').count(),1);assert.equal(await page.locator('[data-battle-clone]').count(),1);
  await page.screenshot({path:path.join(output,`move-persistent-${width}.png`)});
  await page.evaluate(async()=>{
   const b=window.combatVm.$refs.battleOverlay;
   await b.presentEvent('playMoveAnimation',{actor:'player',moveName:'Shadow Ball',moveType:'Ghost',damageClass:'special'});
   await b.presentEvent('playMoveResult',{actor:'player',blocked:true,damage:0});
   await b.presentEvent('updateBattleState',window.moveState());
   if(b.opponent.currentHp!==70)throw Error('Blocked projectile changed HP');
   window.moveFixture.enemy.__battle={};await b.presentEvent('updateBattleState',window.moveState());
  });
  assert.equal(await page.locator('[data-battle-clone]').count(),0);
  assert.equal(await page.locator('[data-battle-shield]').count(),0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(async()=>{
  const b=window.combatVm.$refs.battleOverlay;
  await b.presentEvent('playMoveAnimation',{actor:'opponent',moveName:'Ice Beam',damageClass:'special'});
  if(b.battleMoveFx.visible)throw Error('Reduced motion emitted a move effect');
  b.resetBattleUi();window.combatVm.battle=false;
 });
 await page.emulateMedia({reducedMotion:'no-preference'});
 return {families:results,persistent:true,reducedMotion:true};
}
module.exports={validateMoveLibraryUi};

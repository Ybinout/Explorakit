const assert=require('node:assert/strict'),path=require('node:path');
// All changes use the real owner-bound PC RPC, then restore the fixture's exact slots.
async function validateComputerDragUi(page,output,{privateMode=false}={}) {
 const read=()=>page.evaluate(()=>window.pcVm.pc.state);
 const initial=await read(),context=page.context(),cdp=await context.newCDPSession(page);
 async function choose(box){await page.locator('.pc-box-label select').selectOption(String(box));}
 const stored=uuid=>`[data-pc-pokemon="${uuid}"]`,party=uuid=>`[data-pc-team="${uuid}"]`,slot=n=>`.pc-box-slot[data-pc-slot="${n}"]`;
 async function idle(){await page.waitForFunction(()=>!window.pcVm.pc.busy);assert.equal(await page.locator('.pc-feedback-error').count(),0);}
 const point=async selector=>{const b=await page.locator(selector).boundingBox();assert(b,selector);return{x:b.x+b.width/2,y:b.y+b.height/2};};
 async function gesture(source,target,{touch=false,hover=false,cancel=false}={}){
  await page.locator(source).scrollIntoViewIfNeeded();const a=await point(source),b=await point(target);
  if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
  else{await page.mouse.move(a.x,a.y);await page.mouse.down();}
  for(let i=1;i<=12;i++){const p={x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12};if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});else await page.mouse.move(p.x,p.y);}
  await page.locator('[data-pc-drag-ghost]').waitFor();
  const ghost=await page.locator('[data-pc-drag-ghost]').boundingBox();assert(Math.abs(ghost.x+ghost.width/2-b.x)<2&&Math.abs(ghost.y+ghost.height*.85-b.y)<2,'PC drag preview must follow viewport pointer coordinates');
  if(touch)await page.screenshot({path:path.join(output,`pc-drag-active-${privateMode?'private':'adventure'}.png`)});
  if(hover)await page.waitForTimeout(750);
  if(cancel){await page.keyboard.press('Escape');}
  if(touch)await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});else await page.mouse.up();
  await page.locator('[data-pc-drag-ghost]').waitFor({state:'hidden'});await idle();
 }
 async function restore(){
  const send=async data=>{const result=await page.evaluate(async data=>{await window.pcVm.useComputer(data);return{success:!window.pcVm.pc.error,message:window.pcVm.pc.error};},data);assert(result?.success,JSON.stringify(result));await idle();};
  for(const [index,p]of initial.team.entries()){
   const state=await read(),current=state.team.findIndex(n=>n.uuid===p.uuid),entry=state.entries.find(e=>e.pokemon.uuid===p.uuid);
   if(current===index)continue;
   await send({action:'move',pokemonUuid:p.uuid,from:current>=0?{kind:'team',index:current}:{kind:'box',box:entry.box,slot:entry.slot},to:{kind:'team',index,uuid:state.team[index]?.uuid || null}});
  }
  for(const entry of initial.entries){const state=await read(),current=state.entries.find(e=>e.pokemon.uuid===entry.pokemon.uuid);if(current.box===entry.box&&current.slot===entry.slot)continue;await send({action:'move',pokemonUuid:entry.pokemon.uuid,from:{kind:'box',box:current.box,slot:current.slot},to:{kind:'box',box:entry.box,slot:entry.slot,uuid:state.entries.find(e=>e.box===entry.box&&e.slot===entry.slot)?.pokemon.uuid || null}});}
  const after=await read();assert.deepEqual(after.team,initial.team);assert.deepEqual([...after.entries].sort((a,b)=>a.box-b.box||a.slot-b.slot),[...initial.entries].sort((a,b)=>a.box-b.box||a.slot-b.slot));await choose(0);
 }
 const first=initial.entries[0].pokemon;
 if(!privateMode){
  await page.setViewportSize({width:1365,height:900});await page.waitForTimeout(300);await page.evaluate(()=>window.pcVm.showMobileControls=false);await page.waitForFunction(()=>{const panel=document.querySelector('.pc-terminal').getBoundingClientRect(),game=document.querySelector('.game-stage').getBoundingClientRect();return Math.abs(panel.x+panel.width/2-(game.left+game.right)/2)<2&&Math.abs(panel.y+panel.height/2-(Math.max(0,game.top)+Math.min(innerHeight,game.bottom))/2)<2;});await choose(0);await gesture(stored(first.uuid),slot(17));assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).slot,17);
  const second=initial.entries[1].pokemon;await gesture(stored(first.uuid),stored(second.uuid));assert.equal((await read()).entries.find(e=>e.pokemon.uuid===second.uuid).slot,17);
  await gesture(party(initial.team[1].uuid),slot(25));assert.equal((await read()).team.length,5);
  await gesture(stored(initial.team[1].uuid),'.pc-team-empty');assert.equal((await read()).team.at(-1).uuid,initial.team[1].uuid);
  await gesture(party(initial.team[1].uuid),party(initial.team[0].uuid));assert.equal((await read()).team[0].uuid,initial.team[1].uuid);
  const before=await read();await gesture(stored(first.uuid),slot(20),{cancel:true});assert.deepEqual(await read(),before);await restore();
 }
 await page.setViewportSize({width:393,height:852});await page.locator('.pc-body').evaluate(el=>el.scrollTop=0);await choose(0);
 await gesture(stored(first.uuid),slot(14),{touch:true});assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).slot,14);
 // Hold the Pokémon on the next-box arrow, keeping the same touch and pointer capture.
 await page.locator('.pc-body').evaluate(el=>el.scrollTop=0);const a=await point(stored(first.uuid)),arrow=await point('[data-pc-box-step="1"]');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...arrow,id:1}]});await page.locator('[data-pc-drag-ghost]').waitFor();await page.waitForFunction(()=>document.querySelector('.pc-box-label select').value==='1');const b=await point(slot(8));await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...b,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).box,1);assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).slot,8);
 await page.screenshot({path:path.join(output,`pc-touch-drop-${privateMode?'private':'adventure'}.png`)});await restore();
 if(!privateMode){
  await page.setViewportSize({width:320,height:480});await page.locator(stored(first.uuid)).scrollIntoViewIfNeeded();
  const start=await point(stored(first.uuid)),edge=await page.locator('.pc-body').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:edge.x+edge.width/2,y:edge.y+edge.height-10,id:1}]});
  await page.waitForFunction(()=>{const cell=document.querySelector('[data-pc-slot="29"]').getBoundingClientRect(),body=document.querySelector('.pc-body').getBoundingClientRect();return cell.top>=body.top&&cell.bottom<=body.bottom-2;},{},{timeout:5000});
  const end=await point(slot(29));await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...end,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).slot,29);await restore();
 }

 // A tap remains a selection and opens the existing actions/details.
 await page.waitForTimeout(550);await page.locator(stored(first.uuid)).tap();await page.locator('[data-pc-details]').waitFor();assert.equal((await read()).entries.find(e=>e.pokemon.uuid===first.uuid).slot,initial.entries[0].slot);
 await cdp.detach();return{mouse:!privateMode,touch:true,exactSlots:true,exchanges:!privateMode,partyOrder:!privateMode,cancel:!privateMode,crossBoxWhileDragging:true,autoScroll:!privateMode,tapStillSelects:true,restored:true};
}
module.exports={validateComputerDragUi};

// Actual page gestures and authenticated Adventure on an isolated test server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
if (process.env.DB_TEST_NAME !== 'explorakit_test') throw Error('Dedicated test database required');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), playwright = require('playwright');
const { dbPool: db } = require('../server/config/database');
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-mobile-zoom-dist';
const out = '/tmp/riftmon-mobile-zoom-' + engine;
fs.mkdirSync(out, { recursive:true });
fs.rmSync(path.join(out, 'report.json'), { force:true });
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json());
app.use('/api', require('../server/http/routes'));
app.use(express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);
let browser, page, user, success = false;
const errors = [], checks = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function touchSession(context, target) {
  const cdp = await context.newCDPSession(target);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:3,radiusY:3,force:1}))
  });
  return { cdp, send };
}
async function pinch(send, x, y) {
  await send('touchStart', [[1,x-35,y],[2,x+35,y]]);
  for (const d of [45,55,65,75,90]) {
    await send('touchMove', [[1,x-d,y],[2,x+d,y]]);
    await pause(40);
  }
  await send('touchEnd', []);
  await pause(250);
}
async function pageScale() { return page.evaluate(()=>window.visualViewport.scale); }
async function ready() {
  await page.waitForFunction(()=>{
    const v=document.querySelector('.game-root')?.__vue__;
    if(v?.socket?.connected&&!v.mapLoading&&v.players[v.socket.id]){window.v=v;return true;}
  });
}
async function gestureCancellation() {
  return page.evaluate(()=>['gesturestart','gesturechange'].map(type=>{
    const event=new Event(type,{bubbles:true,cancelable:true});
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }));
}
(async()=>{try {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'zoom_'+randomUUID(),password:randomUUID(),starterId:7})});
  assert.equal(response.status,201); user=await response.json();
  await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id]);
  browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
  const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
  if(engine==='chromium') {
    // Positive control: prove this exact gesture really zooms an unrestricted page.
    const control=await context.newPage();
    await control.goto('data:text/html,<meta name="viewport" content="width=device-width,initial-scale=1"><body style="height:1800px;background:linear-gradient(red,blue)">Pinch control</body>');
    const {cdp,send}=await touchSession(context,control);
    await pinch(send,196,300);
    checks.unrestrictedControlScale=await control.evaluate(()=>visualViewport.scale);
    assert(checks.unrestrictedControlScale>1.2,'Native pinch control must zoom');
    await cdp.detach(); await control.close();
  }
  page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/connexion'); await page.locator('input').first().waitFor();
  assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'),/maximum-scale=1(?:\.0)?,user-scalable=no/);
  assert.deepEqual(await gestureCancellation(),[true,true]);
  assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).touchAction),'pan-x pan-y');
  for(const input of await page.locator('input').all()) assert(await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  await page.locator('input').first().fill('zoom-check');
  assert.equal(await page.locator('input').first().inputValue(),'zoom-check');
  if(engine==='chromium') {
    const {cdp,send}=await touchSession(context,page);
    await pinch(send,196,350); assert.equal(await pageScale(),1);
    for(let i=0;i<2;i++){await send('touchStart',[[1,20,120]]);await send('touchEnd',[]);await pause(90);}
    await pause(300); assert.equal(await pageScale(),1);
    checks.nativePinchAndDoubleTapBlocked=true; await cdp.detach();
  }
  await page.screenshot({path:path.join(out,'login.png')});
  await page.evaluate(u=>localStorage.setItem('explorakit.user',JSON.stringify(u)),{...user.user,token:user.token});
  await page.goto(base+'/game'); await ready();
  await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
  await page.setViewportSize({width:320,height:480});
  await page.locator('.menu-toggle-btn').click();
  const menu=page.locator('.menu-dropdown');
  assert(await menu.evaluate(el=>el.scrollHeight>el.clientHeight));
  if(engine==='chromium') {
    const {cdp,send}=await touchSession(context,page),r=await menu.boundingBox(),x=r.x+r.width/2,y=r.y+r.height-25;
    await send('touchStart',[[1,x,y]]);
    for(let step=1;step<=8;step++){await send('touchMove',[[1,x,y-step*22]]);await pause(25);}
    await send('touchEnd',[]);await pause(150);
    assert(await menu.evaluate(el=>el.scrollTop>40),'One-finger menu scroll remains native');
    checks.nativeMenuScrollPreserved=true;await cdp.detach();
  } else {await menu.evaluate(el=>el.scrollTop=100);assert(await menu.evaluate(el=>el.scrollTop>0));checks.menuScrollLayoutPreserved=true;}
  await page.locator('.menu-toggle-btn').click();
  await page.setViewportSize({width:393,height:852});
  await page.locator('[data-world-chat-toggle]').click();
  const chat=page.locator('[data-world-chat-input]');await chat.fill('Écriture tactile');
  assert.equal(await chat.inputValue(),'Écriture tactile');
  assert(await chat.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));assert.equal(await pageScale(),1);
  await page.getByRole('button',{name:'Fermer le chat',exact:true}).click();
  await page.evaluate(()=>v.handleMenuAction('minimap'));await page.locator('.region-art').waitFor();
  await page.locator('[data-map-zoom="in"]').click();assert.equal(await page.locator('.map-zoom-level').innerText(),'125 %');
  await page.locator('[data-map-zoom="reset"]').click();
  if(engine==='chromium') {
    const {cdp,send}=await touchSession(context,page),r=await page.locator('.map-scroll').boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
    await pinch(send,x,y);assert(parseInt(await page.locator('.map-zoom-level').innerText())>180);
    assert.equal(await pageScale(),1);checks.customMinimapPinchPreserved=true;await cdp.detach();
  }
  await page.screenshot({path:path.join(out,'minimap.png')});
  await page.locator('.region-close').click();
  checks.mobileFormsAndChatEditable=true;checks.minimapZoomButtonsPreserved=true;
  await context.close();
  const desktop=await browser.newContext({viewport:{width:1365,height:900},hasTouch:false});
  page=await desktop.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/connexion');await page.locator('input').first().waitFor();
  assert.deepEqual(await gestureCancellation(),[false,false]);
  checks.desktopGesturesNotCancelled=true;
  assert.deepEqual(errors,[]);assert.equal(require('../data/game/modeAvailability.json').expeditionsAvailable,false);
  const report={success:true,engine,checks,errors,physicalDevice:false,webkitNativePinchTested:false,closedModesPreserved:true};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));success=true;console.log(JSON.stringify(report));
} finally {
  if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  await browser?.close();await new Promise(resolve=>io.close(resolve));
  await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

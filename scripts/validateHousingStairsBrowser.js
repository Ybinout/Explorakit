// Real compiled client, authenticated sockets and disposable MySQL accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const dist=process.env.RELEASE_DIST_DIR,engine=process.env.PRESENTATION_BROWSER||'chromium',out='/tmp/riftmon-housing-stairs-'+engine;
assert(fs.existsSync(dist+'/index.html'));fs.mkdirSync(out,{recursive:true});
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),repo=require('../server/persistence/housingRepository'),rules=require('../server/game/housing/rules'),entries=require('../server/game/housing/entries');
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const manager=require('../server/realtime/housing').getHousingManager(io),accounts=[],errors=[],checks=[],views=[];let browser,page,success=false;
const request=(h,p)=>({...p,revision:h.revision,requestId:randomUUID()});
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.players[v.socket.id]&&v.housingState){window.v=v;return true;}return false;});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');browser=await require('playwright')[engine].launch({headless:true});
 const models=[...rules.models.keys()];
 for(let i=0;i<3;i++){
  const u=await users.createUserWithStarter('StairsUI_'+randomUUID().slice(0,8),randomUUID());accounts.push(u);
  await db.execute("UPDATE users SET money=20000000 WHERE id=?",[u.id]);
  for(const[k,val]of Object.entries({adventure_opening:'complete',early_game_tutorial:JSON.stringify({version:1,phase:'complete',metWayne:true})}))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[u.id,k,val]);
  await require('../server/persistence/patchNotesRepository').acknowledge(u.id,require('../data/game/latest_patch.json').version);
  let h=await repo.read(u.id);h=(await repo.purchase(u.id,request(h,{model:models[i*2],entryKey:entries.entries[0].key}))).home;
  h=(await repo.addFloor(u.id,request(h,{model:models[i*2+1]}))).home;h=(await repo.addFloor(u.id,request(h,{model:models[i*2]}))).home;
  await repo.enter(u.id,u.id,0,entries.outside(entries.entries[0]));
  const context=await browser.newContext({viewport:{width:1365,height:900},hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(auth=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(auth));},{...u,token:require('../server/config/auth').signAccessToken(u)});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.mode-card.adventure').click();await ready();
  await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:false}));
  for(let floor=0;floor<3;floor++){
   const f=h.floors[floor],m=rules.model(f.model);
   for(const s of Object.values(f.stairs).filter(Boolean)){assert.equal(s.x,m.x-2);assert(!rules.stairTrigger(s,Math.floor(rules.stairArrival(s).x/32),Math.floor(rules.stairArrival(s).y/32)));}
   await page.locator('[data-housing-manage]').click();await page.locator('[data-housing-editor]').waitFor();
   assert.equal(await page.getByText('Déplacer les escaliers',{exact:true}).count(),0);
   assert((await page.locator('[data-housing-editor]').innerText()).includes('Les escaliers sont fixes à gauche'));
   for(const[w,height]of[[1365,900],[393,852],[320,568]]){
    await page.setViewportSize({width:w,height});await page.waitForTimeout(180);
    const bounds=await page.locator('[data-housing-editor]').evaluate(el=>{const e=el.__vue__,r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,page:document.documentElement.scrollWidth,canvasX:e.bounds.x};});
    assert(bounds.left>=-1&&bounds.right<=w+1&&bounds.top>=-1&&bounds.bottom<=height+1&&bounds.page<=w+1,JSON.stringify(bounds));assert(bounds.canvasX<=m.x-2);
    const name=`${f.model}-${floor}-${w}`;await page.screenshot({path:out+'/'+name+'.png'});views.push(name);
   }
   await page.locator('[data-housing-panel] .housing-close').count().then(async n=>{if(n)await page.locator('[data-housing-panel] .housing-close').click();else await page.evaluate(()=>v.closeHousingPanel());});
   await page.waitForFunction(()=>!v.housingPanel);
   const actor=manager.contexts.get(u.id),stair=f.stairs.up||f.stairs.down;await actor.travel({map:'housing_'+f.model,...rules.stairArrival(stair)});await ready();await page.waitForTimeout(150);const worldName=`world-${f.model}-${floor}`;await page.screenshot({path:out+'/'+worldName+'.png'});views.push(worldName);
   if(floor<2){
    const s=f.stairs.up,c=manager.contexts.get(u.id);await c.travel({map:'housing_'+f.model,...rules.stairArrival(s)});await ready();
    await page.evaluate(()=>v.socket.emit('playerAction','move_q'));await page.waitForFunction(index=>v.housingState?.floor===index&&!v.mapLoading,floor+1);await page.waitForTimeout(160);
    assert.equal((await repo.visit(u.id)).floor,floor+1);
    await page.evaluate(()=>v.socket.emit('playerAction','move_q'));await page.waitForTimeout(180);assert.equal((await repo.visit(u.id)).floor,floor+1,'held Left must not bounce back');
   }
  }
  // Return down twice and ensure the landing does not trigger a second transition.
  for(let floor=2;floor>0;floor--){const c=manager.contexts.get(u.id),s=h.floors[floor].stairs.down;await c.travel({map:'housing_'+h.floors[floor].model,...rules.stairArrival(s)});await ready();for(const action of ['move_d','move_q']){await page.evaluate(action=>v.socket.emit('playerAction',action),action);await page.waitForTimeout(180);}await page.evaluate(()=>v.socket.emit('playerAction','move_q'));await page.waitForFunction(index=>v.housingState?.floor===index&&!v.mapLoading,floor-1);await page.waitForTimeout(180);assert.equal((await repo.visit(u.id)).floor,floor-1);}
  await page.reload();await ready();assert.equal(await page.evaluate(()=>v.housingState.floor),0);
  checks.push(`${models[i*2]}/${models[i*2+1]}: fixed left stairs, desktop/mobile editor, two ascents, two descents, stable landings and reconnect`);
  await context.close();
 }
 assert.deepEqual(errors,[]);success=true;
}catch(e){console.error(e.stack);if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();manager.stop();await require('../server/realtime/casinoSlots').getSlotsManager(io).stop();await require('../server/realtime/raidManager').getRaidManager(io).stop();await require('../server/realtime/draftManager').getDraftManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);for(const u of accounts)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();const report={success,engine,checks,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex')};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();

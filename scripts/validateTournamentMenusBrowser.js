// Real lobby interactions and scrollable menus, using disposable test accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository');
const factory=require('../server/game/drift/pokemonFactory'),repo=require('../server/persistence/superTournamentRepository');
const engine=process.env.PRESENTATION_BROWSER||'chromium';
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-menu-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-menu-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,base,user,id,success=false;
const errors=[],views=[],checks=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function command(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(8000).emit(event,data,(error,r)=>error?reject(error):resolve(r))),{event,data});}
async function locate(x,y){
  if(await page.locator('.game-root').count())await page.evaluate(()=>v.socket.disconnect());
  await page.goto('about:blank');await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  await db.execute("UPDATE users SET map='super_tournament_lobby',x=?,y=? WHERE id=?",[x*32+16,y*32+16,id]);
  await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
}
async function bounds(selector){
  const r=await page.locator(selector).boundingBox(),size=page.viewportSize();assert(r,selector);
  assert(r.x>=-1&&r.y>=-1&&r.x+r.width<=size.width+1&&r.y+r.height<=size.height+1,selector+': '+JSON.stringify(r));
}
async function scrollContent(){
  const content=page.locator('.tournament-content');
  const needed=await content.evaluate(n=>n.scrollHeight>n.clientHeight+1);
  if(needed){
    assert.equal(await content.evaluate(n=>getComputedStyle(n).touchAction),'pan-y');
    if(engine==='chromium'&&page.viewportSize().width<1000){
      const b=await content.boundingBox(),session=await context.newCDPSession(page),x=b.x+b.width/2,start=b.y+b.height*.8;
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});
      for(let i=1;i<=6;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start-i*b.height*.1}]});await page.waitForTimeout(30);}
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
    }else if(engine==='webkit'&&page.viewportSize().width<1000){
      // Playwright does not expose a trusted swipe/wheel on mobile WebKit.
      await content.evaluate(n=>n.scrollTop=n.scrollHeight);
    }else{const b=await content.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.wheel(0,1800);}
    await page.waitForTimeout(150);assert(await content.evaluate(n=>n.scrollTop>0),'content must scroll');
  }
}
(async()=>{try{
  assert(fs.existsSync(path.join(dist,'index.html')),'Build must complete first');
  server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'menus_'+randomUUID(),password:randomUUID(),starterId:7})});
  assert.equal(response.status,201);user=await response.json();id=user.user.id;
  await teams.editEquipe(id,{pokemons:[9,94,212,248,445,121].map(species=>factory.create(species,100,true))});
  for(const[key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);
  await repo.grantPass(id);await repo.save(id,null,0,{score:750,rooms:2});
  browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
  for(const[width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
    context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});
    await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await locate(13,8);
    // The whole dropdown, including its last action, stays reachable.
    await page.locator('.menu-toggle-btn').click();await bounds('.menu-dropdown');
    await page.locator('[data-menu-action="quit"]').scrollIntoViewIfNeeded();await bounds('[data-menu-action="quit"]');
    assert(await page.locator('.menu-dropdown').evaluate(n=>n.scrollTop>0||n.scrollHeight<=n.clientHeight+1));
    await page.screenshot({path:path.join(out,`dropdown-${width}.png`)});await page.locator('.menu-toggle-btn').click();
    await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="entry"]').waitFor();
    assert.equal(await page.locator('.tournament-panel nav,.tournament-panel .rankings').count(),0);
    assert.equal(await page.locator('.registered-team>div').count(),6);
    assert.equal((await command('superTournament:register',{offerId:'forged'})).success,false);
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);
      await bounds('.tournament-panel');await bounds('.tournament-panel .close');await bounds('.tournament-panel footer .primary');
      assert(await page.locator('.tournament-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      await scrollContent();await page.screenshot({path:path.join(out,`entry-${width}-${theme}.png`)});views.push({width,height,theme});
    }
    await page.locator('.tournament-panel .close').click();await locate(23,8);
    await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="ranking"]').waitFor();
    assert.equal(await page.locator('.tournament-panel nav,.rules,.registered-team,.tournament-panel .primary').count(),0);
    assert.match(await page.locator('.personal').innerText(),/750/);
    // Display-only long-table fixture; the actual wall response above is real.
    await page.evaluate(()=>{v.tournamentPanel.leaderboard.rows=Array.from({length:50},(_,i)=>({id:i+1,rank:i+1,username:'UnPseudoTrèsLongPourVérifierLeClassement'+i,score:999999999-i,rooms:50,self:false}));});
    await bounds('.tournament-panel');await bounds('.tournament-panel footer button');
    assert(await page.locator('.tournament-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    await scrollContent();await page.screenshot({path:path.join(out,`ranking-${width}.png`)});
    // A new payload changes the view even if the component is already open.
    await page.evaluate(()=>v.tournamentPanel={tab:'abandon'});await page.locator('[data-tournament-view="abandon"]').waitFor();
    await bounds('.tournament-panel');await bounds('.tournament-panel footer .primary');
    await page.locator('.tournament-panel .close').click();
    await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  }
  checks.push('Dropdown stays inside the screen and last action is reachable at four sizes');
  checks.push('Host opens registration only; wall opens leaderboard only, with real personal score');
  checks.push('Six-member entry and 50-row long-name leaderboard scroll; close and footer controls stay visible');
  checks.push('Light/dark, mobile portrait/landscape, desktop and live payload changes verified');
  // Actual enrollment is still authorized by the hostess offer, then returns.
  context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
  await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await locate(13,8);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="entry"]').waitFor();
  await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);
  assert.equal((await repo.load(id)).run.phase,'sas');assert.equal((await command('superTournament:abandon')).success,true);
  await page.waitForFunction(()=>v.map==='super_tournament_lobby'&&!v.superTournament.active);checks.push('Actual registration and abandonment still work; forged offer rejected');
  assert.deepEqual(errors,[]);success=true;
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,checks,errors}));
}finally{
  if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({text:document.body.innerText.slice(-2500),map:window.v?.map})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
  await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

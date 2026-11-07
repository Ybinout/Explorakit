// Compiled client, authenticated local server, dedicated SQL and disposable owner.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository');
const keys=['death_orb','corrupted_choice_band','corrupted_choice_scarf','corrupted_choice_specs','corrupted_leftovers'],catalog=require('../data/game/items.json').items;
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR,out='/tmp/riftmon-corrupted-items-'+engine;
assert(dist&&fs.existsSync(dist+'/index.html'));fs.mkdirSync(out,{recursive:true});fs.rmSync(out+'/report.json',{force:true});
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let user,browser,page,success=false;const checks=[],views=[],errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.players[v.socket.id]){window.v=v;return true;}});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 user=await require('../server/persistence/userRepository').createUserWithStarter('Balance_'+randomUUID().slice(0,8),randomUUID());
 const team=await teams.loadEquipe(user.id),normal=team.pokemons[0],mutant=require('./calibrateCorruptionRaids').make(9,100,4,['Surf','Protect','Splash','Recover'],'Keen Eye');
 mutant.heldItem=null;mutant.corruption={version:1,revision:1,permanent:true,modules:{}};team.pokemons.push(mutant);await teams.editEquipe(user.id,team);
 for(const key of keys)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,2)',[user.id,key]);
 for(const [key,value]of [['adventure_opening','complete'],['early_tutorial_phase','complete']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,key,value]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
 const token=require('../server/config/auth').signAccessToken(user),[[owned]]=await db.execute('SELECT id FROM teams WHERE user_id=?',[user.id]);
 const refused=await fetch(base+'/api/teams/'+owned.id+'/pokemons/'+normal.uuid+'/held-item',{method:'PUT',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({itemKey:'corrupted_leftovers'})});
 assert.equal(refused.status,400);assert.match((await refused.json()).message,/corrompu/);checks.push('server-refuses-corrupted-item-on-normal-owned-Pokemon');
 browser=await require('playwright')[engine].launch({headless:true});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(auth=>localStorage.setItem('explorakit.user',JSON.stringify(auth)),{...user,token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));await page.evaluate(()=>v.handleMenuAction('bag'));await page.locator('[data-bag-pocket="held"]').click();await page.waitForFunction(()=>!v.bagLoading);
 for(const [width,height]of [[393,852],[1280,900]])for(const themeMode of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(t=>v.updatePreferences({...v.preferences,themeMode:t}),themeMode);
  for(const key of keys){const row=page.locator('[data-item-key="'+key+'"]');await row.scrollIntoViewIfNeeded();const button=row.locator('.bag-item-select');if(await button.getAttribute('aria-expanded')!=='true')await button.click();assert((await row.locator('.bag-item-detail').innerText()).includes(catalog.find(i=>i.key===key).description),key);}
  const box=await page.locator('.bag-panel').evaluate(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:n.scrollWidth-n.clientWidth};});assert(box.left>=-1&&box.right<=width+1&&box.top>=-1&&box.bottom<=height+1&&box.overflow<=1);
  await page.screenshot({path:path.join(out,'bag-'+width+'-'+themeMode+'.png')});views.push({width,height,themeMode});
 }
 checks.push('all-five-updated-descriptions-render-in-real-bag-on-desktop-mobile-light-dark');
 const row=page.locator('[data-item-key="corrupted_leftovers"]');await row.scrollIntoViewIfNeeded();await row.locator('[data-bag-held-target]').selectOption(mutant.uuid);await row.locator('[data-bag-give-held]').click();await page.waitForFunction(uuid=>!v.teamSaving&&v.teamPokemons.some(p=>p.uuid===uuid&&p.heldItem==='corrupted_leftovers'),mutant.uuid);
 assert.equal((await teams.loadEquipe(user.id)).pokemons.find(p=>p.uuid===mutant.uuid).heldItem,'corrupted_leftovers');const [[count]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[user.id,'corrupted_leftovers']);assert.equal(count.quantity,1);
 await page.reload();await ready();assert.equal((await teams.loadEquipe(user.id)).pokemons.find(p=>p.uuid===mutant.uuid).heldItem,'corrupted_leftovers');checks.push('actual-bag-equipment-persists-on-reconnect-with-one-inventory-debit');
 assert.deepEqual(errors,[]);success=true;
}finally{
 if(!success&&page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await browser?.close();await require('../server/realtime/raidManager').getRaidManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();
 const report={success,engine,checks,views,errors,testOwnerDeleted:true,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex')};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

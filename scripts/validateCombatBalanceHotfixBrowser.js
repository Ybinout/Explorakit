// Compiled Vue client + real authenticated sockets + disposable test account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const dist=process.env.RELEASE_DIST_DIR,engine=process.env.PRESENTATION_BROWSER||'chromium';assert(fs.existsSync(dist+'/index.html'));
const out='/tmp/riftmon-combat-balance-'+engine;fs.mkdirSync(out,{recursive:true});
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository');
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,success=false;const errors=[],checks=[],shots=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}return false;});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');user=await users.createUserWithStarter('BalanceUI_'+randomUUID().slice(0,8),randomUUID());
 const factory=require('../server/game/drift/pokemonFactory'),team=[257,255,256,213,68,292].map(id=>factory.create(id,100,true));
 for(const p of team){p.abilities=['Tackle','Tail Whip','Water Gun','Withdraw'];p.movePp=[2,3,4,5];p.heldItem=null;}
 team[3].passiveAbility='Sturdy';team[4].passiveAbility='Guts';await teams.editEquipe(user.id,{pokemons:team});
 await db.execute("UPDATE users SET map='start',x=112,y=336 WHERE id=?",[user.id]);
 for(const[k,value]of Object.entries({adventure_opening:'complete',early_game_tutorial:JSON.stringify({version:1,phase:'complete',metWayne:true})}))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,k,value]);
 for(const key of['cs_drain_punch','ability_capsule'])await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[user.id,key]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
 browser=await require('playwright')[engine].launch({headless:true});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(auth=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(auth));},{...user,token:require('../server/config/auth').signAccessToken(user)});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.mode-card.adventure').click();await ready();
 await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 await page.evaluate(()=>v.openPokemonDetails(v.teamPokemons.find(p=>p.id===213||p.pokemonId===213||p.data?.id===213)));
 await page.locator('.overview-ability').waitFor();assert((await page.locator('.overview-ability').innerText()).includes('tous ses PV'));
 await page.screenshot({path:path.join(out,'sturdy-description.png')});shots.push('sturdy-description');await page.keyboard.press('Escape');await page.waitForFunction(()=>!v.selectedPokemonUuid);checks.push('compiled Sturdy description keeps normal full-HP protection');
 await page.evaluate(()=>v.openPokemonDetails(v.teamPokemons.find(p=>p.data?.id===292||p.spriteId===292)));await page.locator('[data-companion-page-button="corruption"]').click();assert((await page.locator('.companion-corruption').innerText()).includes('Cette espèce ne peut pas être corrompue'));assert.equal(await page.locator('[data-corruption-open]').count(),0);await page.screenshot({path:path.join(out,'shedinja-restriction.png')});shots.push('shedinja-restriction');await page.keyboard.press('Escape');await page.waitForFunction(()=>!v.selectedPokemonUuid);checks.push('Shedinja UI blocks module installation');
 await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="machines"]').click();
 const row=page.locator('[data-item-key="cs_drain_punch"]');await row.waitFor();if(await row.locator('.bag-item-select').getAttribute('aria-expanded')!=='true')await row.locator('.bag-item-select').click();
 for(const i of[1,2])assert(await row.locator(`option[value="${team[i].uuid}"]`).evaluate(o=>o.disabled),'Earlier evolutions stay incompatible');
 assert(!(await row.locator(`option[value="${team[0].uuid}"]`).evaluate(o=>o.disabled)),'Blaziken selectable');
 await row.locator('[data-machine-target]').selectOption(team[0].uuid);await row.locator('[data-machine-slot="0"]').click();assert(await row.locator('[data-machine-confirm]').isEnabled());
 for(const[w,h]of[[393,852],[320,568],[1365,900]]){
  await page.setViewportSize({width:w,height:h});await row.locator('[data-machine-confirm]').scrollIntoViewIfNeeded();assert(await row.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:path.join(out,'cs-'+w+'.png')});shots.push('cs-'+w);
 }
 await row.locator('[data-machine-confirm]').click();await page.waitForFunction(()=>!v.medicineBusy&&v.teamPokemons.some(p=>p.abilities.includes('Drain Punch')));
 const saved=(await teams.loadEquipe(user.id)).pokemons[0];assert.equal(saved.abilities[0],'Drain Punch');assert.equal(saved.movePp[0],10);assert(!saved.corruption);
 assert.equal(Number((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='cs_drain_punch'",[user.id]))[0][0].quantity),0);
 const choices=await page.evaluate(uuid=>v.bagItems.find(i=>i.key==='ability_capsule').abilityOptions[uuid],team[4].uuid);assert(!choices.includes('No Guard'));checks.push('real CS teaching consumes one, saves full PP and respects species compatibility');checks.push('server capsule options exclude No Guard');
 await page.reload();await ready();assert.equal((await page.evaluate(()=>v.teamPokemons[0].abilities))[0],'Drain Punch');assert.equal(errors.length,0,JSON.stringify(errors));checks.push('learned move survives reconnect');success=true;console.log(JSON.stringify({success,engine,checks,shots}));
}catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
finally{await browser?.close();io.close();await new Promise(r=>server.close(r));if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,checks,shots,errors},null,2));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

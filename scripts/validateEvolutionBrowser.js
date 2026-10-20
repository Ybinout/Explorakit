// Isolated SQL accounts and game server. No fixture endpoints are exposed in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required.');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-six-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-release-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
let browser,page,userId,secondId,success=false;const errors=[];
async function openTeam(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="pokemon"]').click();await page.locator('.team-row').first().waitFor();}
async function dismissEvolution(expected) {
 await page.locator('.evolution-sheet').waitFor();
 if(expected) await page.locator('#evolution-description').filter({hasText:expected}).waitFor();
 await page.locator('[data-evolution-continue]').click();
}
async function deferLearning(){if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'evolution_'+randomUUID(),password:randomUUID(),starterId:7})});assert(response.ok);const fixture=await response.json();userId=fixture.user.id;
 const eevee=factory.create(133,30),charmander=factory.create(4,50);eevee.currentHp-=8;eevee.heldItem='leftovers';await teams.editEquipe(userId,{pokemons:[eevee,charmander]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await openTeam();await page.locator('.team-row-name').first().click();await page.locator('[data-evolution-target="197"] button:enabled').waitFor();
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-evolution-target="197"]').scrollIntoViewIfNeeded();for(const button of await page.locator('.companion-evolutions button').all()){const rect=await button.boundingBox();assert(rect.height>=44);}await page.screenshot({path:path.join(output,`evolution-choice-${w}.png`)});}
 await page.locator('[data-evolution-target="197"] button').click();
 await page.locator('.evolution-sheet').waitFor();
 for(const [w,h] of [[320,480],[393,852],[844,390],[1365,900]]) { await page.setViewportSize({width:w,height:h});await page.locator('[data-evolution-continue]').scrollIntoViewIfNeeded();const rect=await page.locator('[data-evolution-continue]').boundingBox();assert(rect.height>=44&&rect.y>=0&&rect.y+rect.height<=h+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`evolution-animation-${w}.png`)}); }
 await page.keyboard.press('Tab');assert(await page.locator('[data-evolution-continue]').evaluate(el=>el===document.activeElement));
 await dismissEvolution('Noctali');
 const saved=(await teams.loadEquipe(userId)).pokemons[0];assert.equal(saved.data.id,197);assert.equal(saved.uuid,eevee.uuid);assert.equal(saved.experience,eevee.experience);assert.equal(saved.maxHp-saved.currentHp,8);assert.equal(saved.heldItem,'leftovers');
 await page.getByRole('button',{name:'Suivant ›',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-evolution-target="5"] button:enabled').click();await page.locator('.evolution-sheet.still.revealed').waitFor();await dismissEvolution('Reptincel');await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-evolution-target="6"] button:enabled').click();await page.locator('.evolution-sheet').waitFor();await page.keyboard.press('Escape');await page.locator('.evolution-sheet.revealed').waitFor();await dismissEvolution('Dracaufeu');await page.locator('.evolution-success').filter({hasText:'Dracaufeu'}).waitFor();
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.evolution-sheet').count(),0);await deferLearning();await openTeam();await page.locator('.team-row-name').filter({hasText:'Noctali'}).waitFor();await page.locator('.team-row-name').filter({hasText:'Dracaufeu'}).waitFor();
 assert.deepEqual((await teams.loadEquipe(userId)).pokemons.map(p=>p.data.id),[197,6]);
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-format="30"]').click();await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 const p=cleanup.runtime.playerFor({id:userId}),active=factory.create(4,15),reserve=factory.create(1,15),target=factory.create(19,1);
 active.experience=active.getNextLevelExpForLevel(16)-1;reserve.experience=reserve.getNextLevelExpForLevel(16)-1;active.abilities=['Tackle'];active.movePp=[35];active.passiveAbility=target.passiveAbility=null;target.currentHp=1;p.equipe.pokemons=[active,reserve];cleanup.runtime.send(p);await page.waitForFunction(()=>{const vm=document.querySelector('.game-root').__vue__;return vm.teamPokemons[0]?.data?.id===4;});
 cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();
 assert.equal(await page.locator('.evolution-sheet').count(),0);await page.locator('[data-battle-result-continue]').click();await dismissEvolution('Reptincel');await dismissEvolution('Herbizarre');await deferLearning();assert.equal(active.data.id,5);assert.equal(reserve.data.id,2);
 await cleanup.checkpoint();const savedRun=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id);assert.deepEqual(savedRun.players.get(userId).equipe.pokemons.map(p=>p.data.id),[5,2]);
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.evolution-sheet').count(),0);await deferLearning();await openTeam();await page.locator('.team-row-name').filter({hasText:'Reptincel'}).waitFor();await page.locator('.team-row-name').filter({hasText:'Herbizarre'}).waitFor();
 // A genuine Rift run also presents chained server evolutions outside battle.
 cleanup.runtime.abandon(p);store.leave({id:userId});
 const secondResponse=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'evop_'+randomUUID(),password:randomUUID(),starterId:7})});assert(secondResponse.ok);const second=await secondResponse.json();secondId=second.user.id;
 store.connect(fixture.user,'fixture-host');store.connect(second.user,'fixture-partner');
 const lobby=store.create(fixture.user,{capacity:2,durationMinutes:30});store.join(second.user,lobby.code);store.ready(fixture.user,true);store.ready(second.user,true);await cleanup.runtime.start(fixture.user);
 const rift=cleanup.runtime.playerFor(fixture.user),partner=cleanup.runtime.playerFor(second.user);
 cleanup.runtime.chooseStarter(rift,rift.starterChoices[0].uuid);cleanup.runtime.chooseStarter(partner,partner.starterChoices[0].uuid);
 const chain=factory.create(4,15);rift.equipe.pokemons=[chain];await page.goto(base+'/drift/game',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('.game-root').__vue__.teamPokemons[0]?.data?.id===4);
 await page.emulateMedia({reducedMotion:'reduce'});chain.gainExperience(chain.getNextLevelExpForLevel(36)-chain.experience);assert.equal(chain.data.id,6);cleanup.runtime.send(rift);
 await page.locator('.evolution-sheet.still.revealed').waitFor();await dismissEvolution('Reptincel');await dismissEvolution('Dracaufeu');await deferLearning();
 cleanup.runtime.send(rift);await page.waitForFunction(()=>document.querySelector('.game-root').__vue__.evolutionQueue.length===0);assert.equal(await page.locator('.evolution-sheet').count(),0);
 assert.deepEqual((await teams.loadEquipe(userId)).pokemons.map(p=>p.data.id),[197,6]);assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventureBranchChoice:true,legacyCatchup:true,sqlReload:true,colosseumCombatEvolution:true,reserveEvolution:true,riftChainedEvolution:true,reducedMotion:true,keyboardAndSkip:true,noReloadReplay:true,checkpoint:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'evolution-failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(resolve=>io.close(resolve));for(const id of [userId,secondId])if(id)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}})().catch(error=>{console.error(error);process.exitCode=1});

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
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
let browser,page,userId,success=false;const errors=[];
async function openTeam(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="pokemon"]').click();await page.locator('.team-row').first().waitFor();}
async function deferLearning(){if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'evolution_'+randomUUID(),password:randomUUID(),starterId:7})});assert(response.ok);const fixture=await response.json();userId=fixture.user.id;
 const eevee=factory.create(133,30),charmander=factory.create(4,50);eevee.currentHp-=8;eevee.heldItem='leftovers';await teams.editEquipe(userId,{pokemons:[eevee,charmander]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await openTeam();await page.locator('.team-row-name').first().click();await page.locator('[data-evolution-target="197"] button:enabled').waitFor();
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-evolution-target="197"]').scrollIntoViewIfNeeded();for(const button of await page.locator('.companion-evolutions button').all()){const rect=await button.boundingBox();assert(rect.height>=44);}await page.screenshot({path:path.join(output,`evolution-choice-${w}.png`)});}
 await page.locator('[data-evolution-target="197"] button').click();await page.locator('.evolution-success').filter({hasText:'Noctali'}).waitFor();
 const saved=(await teams.loadEquipe(userId)).pokemons[0];assert.equal(saved.data.id,197);assert.equal(saved.uuid,eevee.uuid);assert.equal(saved.experience,eevee.experience);assert.equal(saved.maxHp-saved.currentHp,8);assert.equal(saved.heldItem,'leftovers');
 await page.getByRole('button',{name:'Suivant ›',exact:true}).click();await page.locator('[data-evolution-target="5"] button:enabled').click();await page.locator('[data-evolution-target="6"] button:enabled').click();await page.locator('.evolution-success').filter({hasText:'Dracaufeu'}).waitFor();
 await page.reload({waitUntil:'networkidle'});await deferLearning();await openTeam();await page.locator('.team-row-name').filter({hasText:'Noctali'}).waitFor();await page.locator('.team-row-name').filter({hasText:'Dracaufeu'}).waitFor();
 assert.deepEqual((await teams.loadEquipe(userId)).pokemons.map(p=>p.data.id),[197,6]);
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-format="30"]').click();await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 const p=cleanup.runtime.playerFor({id:userId}),active=factory.create(4,15),reserve=factory.create(1,15),target=factory.create(19,1);
 active.experience=active.getNextLevelExpForLevel(16)-1;reserve.experience=reserve.getNextLevelExpForLevel(16)-1;active.abilities=['Tackle'];active.movePp=[35];active.passiveAbility=target.passiveAbility=null;target.currentHp=1;p.equipe.pokemons=[active,reserve];
 cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();
 await page.locator('[data-battle-result-continue]').click();await deferLearning();assert.equal(active.data.id,5);assert.equal(reserve.data.id,2);
 await cleanup.checkpoint();const savedRun=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id);assert.deepEqual(savedRun.players.get(userId).equipe.pokemons.map(p=>p.data.id),[5,2]);
 await page.reload({waitUntil:'networkidle'});await deferLearning();await openTeam();await page.locator('.team-row-name').filter({hasText:'Reptincel'}).waitFor();await page.locator('.team-row-name').filter({hasText:'Herbizarre'}).waitFor();
 assert.deepEqual((await teams.loadEquipe(userId)).pokemons.map(p=>p.data.id),[197,6]);assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventureBranchChoice:true,legacyCatchup:true,sqlReload:true,colosseumCombatEvolution:true,reserveEvolution:true,checkpoint:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'evolution-failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(resolve=>io.close(resolve));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(error=>{console.error(error);process.exitCode=1});

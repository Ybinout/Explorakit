// Real Adventure encounter and expedition capture, using the unchanged compiled client.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),storage=require('../server/persistence/pokemonStorageRepository');
const factory=require('../server/game/drift/pokemonFactory');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-order-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-capture-xp-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0,random:()=>0}});
let browser,page,base,user,success=false;const users=[],errors=[],checks=[],random=Math.random;
const mon=id=>{const p=factory.create(id,10,true);p.experience=p.getNextLevelExpForLevel(11)-1;p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=null;p.heldItem=null;return p;};
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'capxp_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();users.push(u);return u;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function trace(){await page.evaluate(()=>{v.updatePreferences({...v.preferences,masterVolume:0});window.captureTrace={xp:[],result:null,frames:[]};v.socket.on('battleExperience',p=>captureTrace.xp.push(p));v.socket.on('introAnimation',p=>captureTrace.frames.push(p));v.socket.on('endbattle',p=>captureTrace.result=p);});}
async function capture(label){
 await page.locator('.action-bag:enabled').waitFor();await page.locator('.action-bag').click();await page.locator('.battle-choice-btn-bag').filter({hasText:'Hyperball'}).click();
 await page.waitForFunction(()=>v.$refs.battleOverlay?.experienceBusy&&v.$refs.battleOverlay.captureFx.state==='caught');
 const info=await page.evaluate(()=>({contained:v.$refs.battleOverlay.captureFx.targetContained,state:v.$refs.battleOverlay.captureFx.state,xp:captureTrace.xp.map(p=>p.xpGained),notice:document.querySelector('.experience-notice')?.textContent}));assert(info.contained);assert(info.xp.length&&info.xp.every(x=>x>0));assert(info.notice);
 assert.equal(await page.locator('[data-battle-result]').count(),0,'The result must wait for capture and XP playback');
 assert(Number(await page.locator('.battle-sprite-wild .battle-sprite').evaluate(n=>getComputedStyle(n).opacity))<.1,'Catch stays inside the Ball during XP');
 await page.screenshot({path:path.join(out,label+'-xp.png')});
 await page.evaluate(()=>{window.captureSkip=setInterval(()=>v.$refs.battleOverlay?.advanceExperience(),60);});await page.locator('[data-battle-result]').waitFor();await page.evaluate(()=>clearInterval(window.captureSkip));
 const result=await page.evaluate(()=>captureTrace.result);assert.equal(result.summary.outcome,'captured');assert(result.summary.experience.length>0);assert(!result.summary.experience.some(p=>p.uuid===result.summary.capturedPokemon.uuid));
 await page.screenshot({path:path.join(out,label+'-result.png')});return await page.evaluate(()=>captureTrace);
}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;user=await create();const guest=await create();
 const team={pokemons:[7,1,4,25,16,19].map(mon)};team.pokemons[0].heldItem='exp_share';await teams.editEquipe(user.user.id,team);const before=new Map(team.pokemons.map(p=>[p.uuid,p.experience]));
 await db.execute("UPDATE users SET map='route1',x=176,y=48,repel_steps=0 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game');await ready();await trace();Math.random=()=>0;await page.evaluate(()=>v.socket.emit('playerAction','move_d'));const adventure=await capture('adventure');
 const saved=(await teams.loadEquipe(user.user.id)).pokemons,entries=await storage.loadEntries(user.user.id);assert.equal(adventure.xp.length,6);assert.equal(entries.length,1);const caught=entries[0].pokemon;assert.equal(caught.uuid,adventure.result.summary.capturedPokemon.uuid);assert(!adventure.xp.some(p=>p.pokemon.uuid===caught.uuid));
 for(const award of adventure.xp)assert.equal(saved.find(p=>p.uuid===award.pokemon.uuid).experience-before.get(award.pokemon.uuid),award.xpGained);
 assert(adventure.result.summary.experience.some(p=>p.levelAfter>p.levelBefore || p.levelGrowth),'Capture can trigger a real level/stat recap');
 checks.push('Real Adventure capture into PC gives six persisted Multi Exp awards, level growth and no XP to the captured Pokémon');
 await page.goto(base+'/colosseum');await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await ready();await trace();
 let p=cleanup.runtime.playerFor(user.user);p.equipe.pokemons=[mon(7),mon(1)];p.equipe.pokemons[0].heldItem='exp_share';p.items.hyperball=2;cleanup.runtime.send(p);let enemy=mon(19),enemyXp=enemy.experience;
 cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]},'wild');const colosseum=await capture('colosseum');assert.equal(colosseum.xp.length,2);assert.equal(enemy.experience,enemyXp);assert(p.equipe.pokemons.includes(enemy));await page.evaluate(()=>v.dismissBattleResult());await page.evaluate(()=>v.leaveDrift());await page.locator('[data-colosseum-lobby]').waitFor();
 store.connect(user.user,'host');store.connect(guest.user,'guest');const lobby=store.create(user.user,{capacity:2,durationMinutes:30});store.join(guest.user,lobby.code);for(const u of[user,guest])store.ready(u.user,true);await cleanup.runtime.start(user.user);for(const u of[user,guest]){const player=cleanup.runtime.playerFor(u.user);cleanup.runtime.chooseStarter(player,player.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game');await ready();await trace();p=cleanup.runtime.playerFor(user.user);p.equipe.pokemons=[mon(7),mon(1)];p.equipe.pokemons[0].heldItem='exp_share';p.items.hyperball=2;cleanup.runtime.send(p);enemy=mon(19);enemyXp=enemy.experience;cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]},'wild');const rift=await capture('rift');assert.equal(rift.xp.length,2);assert.equal(enemy.experience,enemyXp);assert(p.equipe.pokemons.includes(enemy));
 checks.push('Real Colosseum and Rift captures award active/reserve XP with their normal scaling and keep the new teammate unchanged');
 checks.push('Capture animation finishes before the XP bar, caught sprite stays hidden, and results wait for all XP messages');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,checks,errors,viewport:{width:393,height:852},compiledClientChanged:false,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,checks,errors}));
}finally{
 Math.random=random;if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1400)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{cleanup();for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

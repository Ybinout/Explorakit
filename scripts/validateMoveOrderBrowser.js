// Real socket handlers, SQL persistence, PC and expedition checkpoints on test accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),storage=require('../server/persistence/pokemonStorageRepository');
const factory=require('../server/game/drift/pokemonFactory');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-move-order-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-move-order-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();let savedCheckpoint;
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(snapshot){savedCheckpoint=snapshot;}},runtimeOptions:{paceMs:0}});
let browser,page,context,base,user,success=false;const users=[],errors=[],views=[],checks=[];
const names=['Tackle','Protect','Water Gun','Bite'],pp=[0,3,7,11];
const mon=()=>Object.assign(factory.create(7,20,true),{abilities:[...names],movePp:[...pp],heldItem:'leftovers',pendingMoves:[]});
const request=p=>({pokemonUuid:p.uuid,expectedMoves:[...p.abilities],orderedIndexes:[1,0,2,3]});
const withoutMoves=p=>{const copy=JSON.parse(JSON.stringify(p));delete copy.abilities;delete copy.movePp;return copy;};
async function rawStored(uuid){const [[r]]=await db.execute('SELECT pokemon_data FROM pokemon_storage WHERE uuid=?',[uuid]);return typeof r.pokemon_data==='string'?JSON.parse(r.pokemon_data):r.pokemon_data;}
const withoutSlots=p=>Object.fromEntries(Object.entries(p).filter(([key])=>!/^ability[1-4]$|^move[1-4]_pp$/.test(key)));
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'move_order_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();users.push(u);return u;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&!v.flight&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function openContext(width=393,height=852){context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));}
async function closeContext(){await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
async function openDetails(){await page.locator('.team-toggle-btn').click();await page.locator('.team-detail-link').first().click();await page.locator('.companion-sheet').waitFor();}
async function order(expected,expectedPp){
 await page.waitForFunction(expected=>[...document.querySelectorAll('[data-companion-move]')].map(n=>n.dataset.companionMove).join('|')===expected.join('|'),expected);
 const actual=await page.locator('[data-companion-move]').evaluateAll(nodes=>nodes.map(n=>({name:n.dataset.companionMove,pp:n.querySelector('dl>div:last-child dd').textContent.trim()})));
 assert.deepEqual(actual.map(r=>r.pp.split(' / ')[0]),expectedPp.map(String));
 for(const selector of ['.companion-sheet','[data-companion-move]'])assert(await page.locator(selector).evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),selector+' overflows');
}
async function press(selector){const target=page.locator(selector);await target.scrollIntoViewIfNeeded();if(page.viewportSize().width<1000)await target.tap();else await target.click();await page.waitForFunction(()=>!v.moveOrderBusy&&!v.pc.busy);}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 user=await create();const foreign=await create(),lead=mon(),stored=mon();await teams.editEquipe(user.user.id,{pokemons:[lead]});await storage.storeCapturedPokemon(user.user.id,stored);
 const rawPcBefore={...await rawStored(stored.uuid),futureMetadata:{preserve:'opaque'}};await db.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE uuid=?',[JSON.stringify(rawPcBefore),stored.uuid]);
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 const foreignMon=(await teams.loadEquipe(foreign.user.id)).pokemons[0];
 const [[rawBefore]]=await db.execute('SELECT * FROM pokemons WHERE uuid=?',[lead.uuid]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height]of [[320,480],[393,852],[1365,900]]){
  await openContext(width,height);await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));await openDetails();
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await order(names,pp);
   assert(await page.locator('[data-move-up="0"]').isDisabled());assert(await page.locator('[data-move-down="3"]').isDisabled());
   await press('[data-move-down="0"]');await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);
   const saved=(await teams.loadEquipe(user.user.id)).pokemons[0];assert.deepEqual(saved.abilities,['Protect','Tackle','Water Gun','Bite']);assert.deepEqual(saved.movePp,[3,0,7,11]);
   await page.locator('[data-move-up="1"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`sheet-${width}-${theme}.png`)});
   await press('[data-move-up="1"]');await order(names,pp);views.push({width,height,theme});
  }
  await closeContext();
 }
 checks.push('Touch/mouse arrows, boundaries, descriptions and PP work in three sizes and both themes; each change is already in SQL');
 await openContext();await page.goto(base+'/game');await ready();await openDetails();await press('[data-move-down="0"]');
 // The move order must reach the next real combat, not only the sheet.
 await page.locator('.companion-close').click();await page.locator('.team-close').click();
 const team=await teams.loadEquipe(user.user.id),socketId=await page.evaluate(()=>v.socket.id);
 const a={socketId,userId:user.user.id,currentmap:'centre',equipe:team,drifts:[],equipped:[]},b={npc:true,equipe:{pokemons:[factory.create(19,20,true)]},drifts:[],equipped:[]};
 const battle=new(require('../server/game/drift/driftBattle').DriftBattle)(a,b,{emit:(p,e,d)=>io.to(p.socketId).emit(e,d),rules:{report:false,rewards:false}});
 await page.locator('.action-attack:enabled').waitFor();await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().waitFor();
 assert.match(await page.locator('.battle-move-choice').nth(0).innerText(),/Abri/);assert.match(await page.locator('.battle-move-choice').nth(1).innerText(),/Charge/);assert(await page.locator('.battle-move-choice').nth(1).isDisabled());battle.finish(null,'fled');
 await closeContext();await openContext();await page.goto(base+'/game');await ready();await openDetails();await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);
 const current=(await teams.loadEquipe(user.user.id)).pokemons[0],before=JSON.stringify(current);
 for(const data of [{...request(current),pokemonUuid:foreignMon.uuid},{...request(current),orderedIndexes:[0,0,2,3]},{...request(current),expectedMoves:names}])assert(!(await command('reorderMoves',data)).success);
 assert.equal(JSON.stringify((await teams.loadEquipe(user.user.id)).pokemons[0]),before);
 assert(!(await command('pc:action',{action:'reorderMoves',...request(foreignMon)})).success);
 await press('[data-move-up="1"]');await order(names,pp);await page.locator('.companion-close').click();await page.locator('.team-close').click();
 checks.push('Order persists across reconnect and drives the real combat buttons; exhausted PP stay at zero; forged/foreign/stale requests fail');
 // The stored Pokémon has its own editable sheet; no deposit/withdraw required.
 await page.evaluate(()=>v.espace());await page.locator('[data-pc-loading]').waitFor({state:'hidden'});await page.locator(`[data-pc-pokemon="${stored.uuid}"]`).click();await page.locator('[data-pc-details]').click();await order(names,pp);
 const storedBefore=withoutMoves((await storage.loadEntries(user.user.id))[0].pokemon);
 await press('[data-move-down="0"]');await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);await page.screenshot({path:path.join(out,'pc-sheet.png')});
 let saved=(await storage.loadEntries(user.user.id))[0];assert.equal(saved.pokemon.uuid,stored.uuid);assert.deepEqual(saved.pokemon.movePp,[3,0,7,11]);assert.deepEqual(withoutMoves(saved.pokemon),storedBefore);
 assert.deepEqual(withoutSlots(await rawStored(stored.uuid)),withoutSlots(rawPcBefore));
 await page.locator('.companion-close').click();await page.locator('.pc-close').click();await closeContext();await openContext();await page.goto(base+'/game');await ready();await page.evaluate(()=>v.espace());await page.locator('[data-pc-loading]').waitFor({state:'hidden'});await page.locator(`[data-pc-pokemon="${stored.uuid}"]`).click();await page.locator('[data-pc-details]').click();await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);await page.locator('.companion-close').click();await page.locator('.pc-close').click();
 const [[rawAfter]]=await db.execute('SELECT * FROM pokemons WHERE uuid=?',[lead.uuid]);assert.deepEqual(rawAfter,rawBefore);
 checks.push('PC box edits survive reconnect and retain identity, HP, stats, item, box and all other data; team SQL unchanged after round trip');
 // Exercise the real Colosseum command, publication and checkpoint boundary.
 await page.goto(base+'/colosseum');await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await ready();let player=cleanup.runtime.playerFor(user.user);player.equipe.pokemons=[mon()];cleanup.runtime.send(player);await openDetails();await order(names,pp);await press('[data-move-down="0"]');await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);assert(savedCheckpoint);assert.deepEqual(player.equipe.pokemons[0].movePp,[3,0,7,11]);await page.locator('.companion-close').click();await page.locator('.team-close').click();await page.evaluate(()=>v.leaveDrift());await page.locator('[data-colosseum-lobby]').waitFor();
 // A real Rift run uses the same command, without crossing Adventure inventories.
 store.connect(user.user,'host');store.connect(foreign.user,'guest');const lobby=store.create(user.user,{capacity:2,durationMinutes:30});store.join(foreign.user,lobby.code);for(const u of[user,foreign])store.ready(u.user,true);await cleanup.runtime.start(user.user);for(const u of[user,foreign]){const p=cleanup.runtime.playerFor(u.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game');await ready();player=cleanup.runtime.playerFor(user.user);player.equipe.pokemons=[mon()];cleanup.runtime.send(player);await openDetails();await press('[data-move-down="0"]');await order(['Protect','Tackle','Water Gun','Bite'],[3,0,7,11]);
 assert.deepEqual(player.equipe.pokemons[0].movePp,[3,0,7,11]);assert.deepEqual((await teams.loadEquipe(user.user.id)).pokemons[0].abilities,names);
 checks.push('Real Colosseum/Rift commands and publication preserve PP and checkpoint data without touching Adventure');
 await closeContext();cleanup.runtime.abandon(player);store.leave(user.user);
 const tournamentRepo=require('../server/persistence/superTournamentRepository');await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'mirror_stage','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[user.user.id]);assert(await tournamentRepo.grantPass(user.user.id));
 await db.execute("UPDATE users SET map='super_tournament_lobby',x=432,y=272 WHERE id=?",[user.user.id]);
 await openContext();await page.goto(base+'/game');await ready();await page.evaluate(()=>v.espace());await page.locator('.tournament-panel .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.mapLoading);await ready();
 await openDetails();const tournamentBefore=(await tournamentRepo.load(user.user.id)).run.player.equipe.pokemons[0],tournamentPp=[...tournamentBefore.movePp];
 await press('[data-move-down="0"]');await order(['Protect','Tackle','Water Gun','Bite'],[tournamentPp[1],tournamentPp[0],...tournamentPp.slice(2)]);
 const sealed=(await tournamentRepo.load(user.user.id)).run.player.equipe.pokemons[0];assert.equal(sealed.abilities[0],'Protect');assert.deepEqual((await teams.loadEquipe(user.user.id)).pokemons[0].abilities,names);
 assert(!(await command('reorderMoves',request(sealed))).success);
 await closeContext();await openContext();await page.goto(base+'/game');await ready();await openDetails();await order(sealed.abilities,sealed.movePp);await page.locator('.companion-close').click();await page.locator('.team-close').click();assert((await command('superTournament:abandon',{})).success);
 checks.push('Super Tournament changes only its sealed team, persists across reconnect, and blocks the ordinary Adventure mutation');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>document.body.innerText.slice(-1400)).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{cleanup();for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

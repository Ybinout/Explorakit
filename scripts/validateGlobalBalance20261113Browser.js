// Compiled UI, native sockets/simulator and disposable MySQL account only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto'),{once}=require('node:events');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const dist=process.env.RELEASE_DIST_DIR,engine=process.env.PRESENTATION_BROWSER||'chromium',out='/tmp/riftmon-global-20261113-'+engine;
assert(fs.existsSync(dist+'/index.html'));fs.mkdirSync(out,{recursive:true});
const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository');
const teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository');
const repo=require('../server/persistence/housingRepository'),factory=require('../server/game/drift/pokemonFactory');
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let user,browser,context,page,success=false;const checks=[],views=[],errors=[];
const request=(h,p)=>({...p,requestId:randomUUID(),revision:h.revision});
const rpc=(name,p={})=>page.evaluate(({name,p})=>new Promise((resolve,reject)=>v.socket.timeout(15000).emit(name,p,(e,r)=>e?reject(e):resolve(r))),{name,p});
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.players[v.socket.id]&&v.renderedMap===v.map){window.v=v;return true;}});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:false}));}
async function openPage(){page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/game');await ready();}
async function relocate(map,x,y){await page.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x,y,user.id]);await openPage();}
async function screenshot(name){await page.screenshot({path:out+'/'+name+'.png'});views.push(name);}
async function pcIdle(){await page.waitForFunction(()=>!v.pc.busy);assert.equal(await page.locator('.pc-feedback-error').count(),0);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 user=await users.createUserWithStarter('GlobalUI_'+randomUUID().slice(0,8),randomUUID());
 await db.execute('UPDATE users SET money=3000000 WHERE id=?',[user.id]);
 const outgoing=[9,6,3,94,143,26].map(id=>factory.create(id,40,true));await teams.editEquipe(user.id,{pokemons:outgoing});
 const incoming=[65,68,112,130,134,149].map(id=>factory.create(id,50,true));incoming[0].heldItem='leftovers';incoming[0].currentHp=3;incoming[0].movePp[0]=1;
 for(const p of incoming)await pc.storeCapturedPokemon(user.id,p);
 for(const[key,value]of[['adventure_opening','complete'],['early_game_tutorial',JSON.stringify({version:1,phase:'complete',metWayne:true})]])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,key,value]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
 let home=await repo.read(user.id);home=(await repo.purchase(user.id,request(home,{model:'nid',entryKey:require('../server/game/housing/entries').entries[0].key}))).home;
 home=(await repo.furniture(user.id,request(home,{key:'trash_bin',quantity:1}))).home;
 const trash=randomUUID();home=(await repo.saveFloor(user.id,request(home,{floor:0,layout:{...home.floors[0],placements:[{id:trash,key:'trash_bin',x:12,y:10,rotation:0}]}}))).home;
 await repo.enter(user.id,user.id,0,{map:'ville1',x:240,y:112});
 await db.execute("UPDATE users SET x=400,y=368 WHERE id=?",[user.id]);await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'potion',10)",[user.id]);
 browser=await require('playwright')[engine].launch({headless:true});context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(a=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(a));},{...user,token:require('../server/config/auth').signAccessToken(user)});await openPage();
 let a=await page.locator('.mobile-action-a').boundingBox();await page.touchscreen.tap(a.x+a.width/2,a.y+a.height/2);
 await page.locator('.trash-panel').waitFor();await page.waitForTimeout(600);assert(await page.locator('.trash-panel').isVisible());checks.push('native mobile A opens the trash once and it remains open after pointer release/click');
 const quantity=page.getByRole('spinbutton',{name:'Quantité à jeter : Potion'});await quantity.fill('4');await page.getByRole('button',{name:'Vérifier la sélection'}).click();await page.getByRole('button',{name:'Conserver',exact:true}).click();
 assert.equal(Number((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='potion'",[user.id]))[0][0].quantity),10);
 await page.getByRole('button',{name:'Vérifier la sélection'}).click();await page.getByRole('button',{name:'Supprimer 4 unité(s)'}).click();await page.waitForFunction(()=>!v.housingBusy&&v.housingNotice==='Objets supprimés définitivement.');
 assert.equal(Number((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='potion'",[user.id]))[0][0].quantity),6);checks.push('quantity, cancel and real confirmed trash removal update the bag, with six potions remaining');
 await screenshot('trash-mobile');await page.setViewportSize({width:1365,height:900});await screenshot('trash-desktop');await page.keyboard.press('Escape');assert.equal((await rpc('housing:exit')).success,true);await relocate('centre',560,304);
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.$refs.pokemonComputer&&!v.$refs.pokemonComputer.opening);
 const first=page.locator('[data-pc-slot="0"]');const r=await first.boundingBox();await first.dispatchEvent('pointerdown',{pointerId:80,pointerType:'touch',isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2});await page.waitForTimeout(600);
 await page.waitForFunction(()=>v.$refs.pokemonComputer.selectionMode&&v.$refs.pokemonComputer.groupIds.length===1);
 assert.equal(await first.evaluate(e=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});e.dispatchEvent(ev);return ev.defaultPrevented;}),true);
 const second=await page.locator('[data-pc-slot="1"]').boundingBox();await page.touchscreen.tap(second.x+second.width/2,second.y+second.height/2);
 assert.equal(await page.evaluate(()=>v.$refs.pokemonComputer.groupIds.length),2);checks.push('stationary touch hold enters multi-select; native context menu prevented; second touch adds a Pokémon');
 await page.locator('[data-pc-group-destination]').click();await page.locator('[data-pc-box-destination="1"]').click();await pcIdle();assert.equal((await pc.loadStorage(user.id)).entries.filter(e=>e.box===1).length,2);checks.push('two selected Pokémon move together into another box through real Socket/SQL');
 await page.locator('.pc-box-label select').selectOption('0');await page.locator('[data-pc-selection]').click();await page.locator('[data-pc-select-box]').click();await page.locator('.pc-box-label select').selectOption('1');await page.locator('[data-pc-select-box]').click();
 const chosen=await page.evaluate(()=>v.$refs.pokemonComputer.groupIds);assert.equal(chosen.length,6);await screenshot('pc-selection-mobile');await page.locator('[data-pc-swap-party]').click();await pcIdle();assert.deepEqual((await pc.loadStorage(user.id)).team.map(p=>p.uuid),chosen);checks.push('six selected across two boxes exchange with the full party atomically, in selected order');
 await page.setViewportSize({width:1365,height:900});await screenshot('pc-swapped-desktop');await page.keyboard.press('Escape');await page.reload();await ready();const saved=await pc.loadStorage(user.id);assert.deepEqual(saved.team.map(p=>p.uuid),chosen);assert.equal(saved.team.find(p=>p.uuid===incoming[0].uuid).heldItem,'leftovers');assert.equal(saved.team.find(p=>p.uuid===incoming[0].uuid).currentHp,3);checks.push('reconnect retains all twelve Pokémon, exact party order, HP and held item');
 await relocate('ville_safe1',816,272);assert.equal(Math.floor(await page.evaluate(()=>v.players[v.socket.id].y)/32),8);await page.evaluate(()=>v.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>Math.floor(v.players[v.socket.id].y/32)===9);await screenshot('mathilde-bench-removed');checks.push('the former bench lower cell is walkable; native floor replacement rendered in the village');
 await relocate('jungle3',112,240);await page.setViewportSize({width:393,height:852});a=await page.locator('.mobile-action-a').boundingBox();await page.touchscreen.tap(a.x+a.width/2,a.y+a.height/2);await page.waitForFunction(()=>v.magicPanel?.mode==='travel');await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>v.magicPanel?.mode),'travel');await screenshot('boat-popup-mobile');checks.push('Magic Island boat window survives a real mobile A tap without closing or confirming travel');
 const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('./calibrateCorruptionRaids');const party=Array.from({length:4},()=>({ownerId:user.id,ownerName:'Test',pokemon:make(9,100,4,['Tackle','Splash'],'Keen Eye')}));const boss=make(143,100,4,['Tackle'],'Keen Eye');const raid=new RaidBattle(party,boss,{seed:[1,2,3,4]});
 const lead=raid.sim.p1.active[0];lead.addVolatile('confusion',lead,raid.sim.dex.moves.get('confuseray'));lead.lastMove=raid.sim.dex.moves.get('tackle');lead.addVolatile('disable',raid.bossPokemon,raid.sim.dex.moves.get('disable'));
 await page.evaluate(frame=>{v.magicPanel=null;v.raidCommand=async()=>({success:true});v.raidState={id:'local-global-comfort',phase:'active',rift:{name:'Facile'},combat:frame};v.battle=true;},raid.view(user.id));
 await page.waitForFunction(()=>{const r=document.querySelector('[data-raid-battle]')?.__vue__;return r&&!r.loading&&!r.playing;});assert.match(await page.locator('[data-raid-volatiles]').innerText(),/Confus/);assert.match(await page.locator('[data-raid-volatiles]').innerText(),/Entrave.*Charge/);
 for(const [w,h]of[[393,852],[320,568],[1365,900]]){await page.setViewportSize({width:w,height:h});await screenshot('raid-status-'+w);assert(await page.locator('[data-raid-volatiles]').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.raid-card').getBoundingClientRect();return r.bottom<=p.bottom+1&&r.right<=p.right+1;}));}
 checks.push('native raid Confusion/Disable snapshot renders compact labels inside the ally card at 320, 393 and 1365px');assert.deepEqual(errors,[]);success=true;
 }catch(e){console.error(e.stack);if(page&&!page.isClosed())await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
 finally{await browser?.close();require('../server/realtime/housing').getHousingManager(io).stop();await require('../server/realtime/casinoSlots').getSlotsManager(io).stop();await require('../server/realtime/raidManager').getRaidManager(io).stop();await require('../server/realtime/draftManager').getDraftManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();const report={success,engine,checks,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),physicalHardware:false,productionWrites:false};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();

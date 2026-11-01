// Private SQL/Socket.IO recipe: no production users, debug endpoint or live run.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/superTournamentRepository'),teams=require('../server/persistence/teamRepository');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec'),resources=require('../server/game/battle/battleResources');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),original=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=original(options);controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-cycle-rules-dist',out='/tmp/riftmon-tournament-cycle-rules-'+engine;
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,success=false,base;const errors=[],views=[];
const c=()=>controllers.get(user.user.id),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&!v.flight&&v.renderedMap===v.map){window.v=v;return true;}});}
async function rpc(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(8000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(n){for(let i=0;i<n;i++){const before=await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y,map:v.map}));let moved=false;
 for(let attempt=0;attempt<4&&!moved;attempt++){await page.evaluate(()=>v.socket.emit('playerAction','move_z'));try{await page.waitForFunction(p=>v.map!==p.map||Math.abs(v.players[v.socket.id].x-p.x)+Math.abs(v.players[v.socket.id].y-p.y)>=31,before,{timeout:800});moved=true;}catch{}await pause(170);}assert(moved,JSON.stringify(before));}await ready();}
function party(ids=[9,94,212],items=['leftovers',null,null]){return{pokemons:ids.map((id,i)=>{const p=factory.create(id,100,true);p.heldItem=items[i];p.abilities=['Tackle','Protect'];p.movePp=[0,1];p.currentHp=1;p.status='poison';return p;})};}
async function visit(team){if(page.url().startsWith('http')){await page.evaluate(()=>v.socket.disconnect());await page.goto('about:blank');await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 await teams.editEquipe(user.user.id,team);await db.execute("UPDATE users SET map='super_tournament_lobby',x=432,y=272 WHERE id=?",[user.user.id]);await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="entry"]').waitFor();
}
async function layout(label){for(const[width,height]of[[320,480],[393,852],[844,390],[1365,900]])for(const theme of['light','dark']){
 await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await pause(100);
 const selector=label==='entry'?'.tournament-panel':'.team-panel';const node=page.locator(selector);await node.waitFor();assert(await node.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.screenshot({path:path.join(out,`${label}-${theme}-${width}.png`)});views.push({label,width,height,theme});
}}
function assertHealthy(run){for(const p of run.player.equipe.pokemons){assert.equal(p.currentHp,p.maxHp);assert.equal(p.status,'normal');assert.deepEqual(p.movePp,p.abilities.map(resources.getMaxMovePp));assert(!p.riftFainted);}}
async function seedCleared(room){await c().execute(()=>c().atomic(()=>{const r=c().run;r.room=room;r.cleared=room+1;r.score=(room+1)*300;r.phase='cleared';r.reward=null;
 for(const[i,p]of r.player.equipe.pokemons.entries()){p.currentHp=i===0?0:1;p.status='poison';p.movePp=p.abilities.map(()=>0);p.riftFainted=i===0;p.__battle={statStages:{attack:3}};}r.player.equipe.pokemons[0].heldItem=null;
}));}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'cycle_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);user=await response.json();
 for(const[key,value]of[['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.user.id,key,value]);
 await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'super_tournament_pass',1)",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const[kind,team,pattern]of[['species',party([9,9,212],[null,null,null]),/chaque espèce/],['items',party([9,94,212],['leftovers','leftovers',null]),/chaque objet tenu/]]){
  await visit(team);const before=codec.encode(await teams.loadEquipe(user.user.id));await page.locator('.tournament-panel footer .primary').click();await page.locator('.tournament-panel .error').waitFor();assert.match(await page.locator('.tournament-panel .error').innerText(),pattern);const alert=await page.locator('.tournament-panel .error').boundingBox(),footer=await page.locator('.tournament-panel footer').boundingBox();assert(alert.y>=0&&alert.y+alert.height<=footer.y+1);assert.equal(await page.evaluate(()=>v.map),'super_tournament_lobby');assert.equal(await page.evaluate(()=>v.flight),null);const bypass=await rpc('superTournament:register',{offerId:await page.evaluate(()=>v.tournamentPanel.offerId)});assert.equal(bypass.success,false);assert.match(bypass.message,pattern);
  assert.equal((await repo.load(user.user.id)).run,null);assert.equal((await repo.load(user.user.id)).version,0);assert.deepEqual(codec.encode(await teams.loadEquipe(user.user.id)),before);await page.screenshot({path:path.join(out,`rejected-${kind}.png`)});
 }
 await visit(party());const rules=await page.locator('.tournament-panel .rules').innerText();assert.match(rules,/une seule fois chaque espèce et chaque objet tenu/);assert.match(rules,/début de chaque nouveau cycle de 16 combats/);await layout('entry');
 await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);await ready();
 const adventure=codec.encode(await teams.loadEquipe(user.user.id));const[[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[user.user.id]);assertHealthy(c().run);
 await walk(11);assert.equal(c().run.room,0);assert.equal(c().run.phase,'ready');
 await seedCleared(0);const injured=codec.encode(c().run.player.equipe);await walk(12);assert.equal(c().run.room,1);assert.deepEqual(codec.encode(c().run.player.equipe),injured);
 await seedCleared(15);const identity=c().run.player.equipe.pokemons.map(p=>[p.uuid,p.experience,p.level,p.heldItem]);await walk(12);assert.equal(c().run.room,16);assertHealthy(c().run);assert.deepEqual(c().run.player.equipe.pokemons.map(p=>[p.uuid,p.experience,p.level,p.heldItem]),identity);
 await page.waitForFunction(()=>v.superTournament.cycle===2&&v.interactionNotice.includes('Cycle 2'));assertHealthy((await repo.load(user.user.id)).run);
 await page.locator('.team-toggle-btn').click();await page.locator('.team-row').first().waitFor();await layout('cycle-healed');await page.locator('.team-close').click();
 await c().execute(()=>c().atomic(()=>{c().run.player.equipe.pokemons[0].currentHp=1;}));await page.reload();await ready();assert.equal(c().run.phase,'ready');assert.equal(c().run.player.equipe.pokemons[0].currentHp,1);
 await seedCleared(31);await walk(12);assert.equal(c().run.room,32);assertHealthy(c().run);await page.waitForFunction(()=>v.superTournament.cycle===3&&v.interactionNotice.includes('Cycle 3'));
 assert.equal((await rpc('superTournament:abandon')).success,true);await page.waitForFunction(()=>!v.superTournament.active&&v.map==='centre');assert.deepEqual(codec.encode(await teams.loadEquipe(user.user.id)),adventure);
 const[[afterWallet]]=await db.execute('SELECT money FROM users WHERE id=?',[user.user.id]);assert.equal(Number(afterWallet.money),Number(wallet.money));assert.deepEqual(errors,[]);
 success=true;const report={success,engine,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),views,duplicateSpeciesRejected:true,duplicateItemsRejected:true,invalidPartyUnchanged:true,emptyItemSlotsAllowed:true,registrationHeals:true,ordinaryRoomsNoHeal:true,cycleHeals:[2,3],koRevived:true,ppRestored:true,consumedItemsNotRestored:true,reconnectNoFreeHeal:true,adventureUnchanged:true,moneyUnchanged:true,errors,physicalHardware:false};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({success,engine,views:views.length}));
}finally{
 if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
 await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

// Five real authenticated clients; authoritative test fixture placement/results
// stay inside this private server process, never in a public game endpoint.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),factory=require('../server/game/drift/pokemonFactory');
const clubModule=require('../server/realtime/whitepeakClub'),contexts=new Map(),hooks=new Map();let club,clock=Date.now();
clubModule.getClub=io=>{if(club)return club;club=clubModule.createClub(io,{now:()=>clock,tickMs:0});const attach=club.attach;club.attach=c=>{contexts.set(c.id,c);const h=attach(c);hooks.set(c.id,h);return h;};return club;};
const engine=process.env.PRESENTATION_BROWSER||'chromium';assert(['chromium','webkit'].includes(engine));
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-house-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-house-'+engine;fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,base,success=false;const accounts=[],pages=[],errors=[],views=[],checks=[];
async function ready(page){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(page,name,data={}){return page.evaluate(({name,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit('whitepeak:'+name,data,(error,result)=>error?reject(error):resolve(result))),{name,data});}
async function move(index,side){const id=accounts[index].user.id,p=contexts.get(id).getPlayer();p.x=(side===0?8:side===1?19:13)*32+16;p.y=(side<2?8:5)*32+16;await hooks.get(id).step();}
async function open(page){await page.evaluate(()=>{v.clubPanel={tab:'duel'};v.clubError='';});await page.locator('[data-battle-house-menu]').waitFor();}
async function layout(page,label,selector='[data-whitepeak-panel]'){
 for(const[width,height]of [[320,480],[393,852],[844,390],[1536,680]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await page.waitForTimeout(130);
  const box=await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:n.scrollWidth>n.clientWidth+1};});
  assert(box.left>=-1&&box.right<=width+1&&box.top>=-1&&box.bottom<=height+1&&!box.overflow,JSON.stringify({label,width,height,box}));
  if(selector==='[data-whitepeak-panel]'){const f=await page.locator(selector+' footer').last().evaluate(n=>{const r=n.getBoundingClientRect();return{top:r.top,bottom:r.bottom};});assert(f.top>=0&&f.bottom<=height+1,JSON.stringify({label,width,height,footer:f}));}
  const file=`${label}-${width}-${theme}.png`;await page.screenshot({path:path.join(out,file)});views.push({label,width,height,theme,file});
 }
 await page.setViewportSize({width:393,height:852});
}
async function finish(winningSide){
 const room=club.room;
 await club.execute(()=>{const loser=room.copies[1-winningSide];for(const p of loser.equipe.pokemons)p.currentHp=0;room.engine.prune();room.engine.checkEnd();});
 await club.tick();assert.equal(room.phase,'finished');
 for(const id of room.ids){const index=accounts.findIndex(a=>a.user.id===id),page=pages[index];await page.locator('[data-battle-result-continue]').waitFor({timeout:20000});await page.locator('[data-battle-result-continue]').click();await page.waitForFunction(()=>!v.battle&&!v.battleResult);await page.evaluate(()=>{v.clubPanel=null;});}
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;browser=await playwright[engine].launch({headless:true});
 for(let n=0;n<5;n++){
  const user=await require('../server/persistence/userRepository').createUserWithStarter('House_'+randomUUID().slice(0,10),randomUUID()),token=require('../server/config/auth').signAccessToken(user);accounts.push({user,token});
  const team={pokemons:[9,94,212,248,445,121].map((id,i)=>{const p=factory.create(id,70+i,true);p.abilities=['Splash','Tackle','Protect','Recover'];p.heldItem=null;return p;})};await teams.editEquipe(user.id,team);
  const reserve=factory.create(25,65,true);await pc.storeCapturedPokemon(user.id,reserve);
  await db.execute("UPDATE users SET map='ville5_maison1',x=432,y=208,money=100000 WHERE id=?",[user.id]);
  await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.id]);
  await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
  const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'});
  await context.addInitScript(u=>{if(!location.protocol.startsWith('http'))return;localStorage.setItem('explorakit.user',JSON.stringify(u));localStorage.setItem('explorakitGamePreferences',JSON.stringify({masterVolume:0,animationsEnabled:false,textSpeed:10000,themeMode:'light'}));},{...user,token});
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready(page);
 }
 const[a,b,c,d,spectator]=pages;
 await open(a);assert.equal(await a.locator('.house-modes [role=tab]').count(),4);await layout(a,'modes');
 await a.locator('#house-mode-2v1').click();await a.locator('[data-duel-money]').fill('1001');await a.locator('[data-create-duel]').click();await a.waitForFunction(()=>v.clubDuel?.phase==='waiting'||v.clubError);assert.equal(await a.evaluate(()=>v.clubError),'');assert.equal(club.room.config.mode,'2v1');
 await move(0,0);await move(1,1);await move(2,1);await b.locator('[data-house-preparation]').waitFor();
 assert.equal(club.room.phase,'preparation');assert.deepEqual(club.room.sides.map(s=>s.ids.length),[1,2]);
 assert.equal((await command(spectator,'create',{mode:'2v1'})).success,false);
 assert.equal((await command(spectator,'chat',{id:club.room.id,message:'not a participant'})).success,false);
 const allyIds=accounts.slice(1,3).map(a=>a.user.id);
 assert.deepEqual(await b.evaluate(()=>v.clubRosters.members.map(m=>m.ownerId)),allyIds);assert.equal(await a.evaluate(()=>v.clubRosters.members.length),1);
 await layout(b,'preparation');await b.locator('.prep-mobile-tabs button').filter({hasText:'Discussion'}).click();await b.locator('#house-chat-input').fill('On change le premier Pokémon ?');await b.locator('.prep-chat form button').click();
 await c.waitForFunction(()=>v.clubDuel.preparation.chat.length===1);assert.equal(await a.evaluate(()=>v.clubDuel.preparation.chat.length),0);checks.push('camp-private-chat-and-roster');
 await b.locator('.prep-mobile-tabs button').filter({hasText:'Équipe'}).click();await b.locator('[data-house-confirm]').click();await c.waitForFunction(()=>v.clubDuel.preparation.confirmed.length===1);
 await c.locator('.prep-slot-actions').first().locator('button').nth(1).click();await b.waitForFunction(()=>v.clubDuel.preparation.confirmed.length===0);checks.push('edit-resets-confirmations');
 // Inspect the shared PC pool through the authoritative private detail action.
 const reserve=(await pc.loadEntries(accounts[1].user.id))[0].pokemon;
 const detail=await command(b,'inspect',{id:club.room.id,ownerId:accounts[1].user.id,pokemonUuid:reserve.uuid});assert(detail.success&&detail.state.detail.uuid===reserve.uuid);
 assert.equal((await command(a,'inspect',{id:club.room.id,ownerId:accounts[1].user.id,pokemonUuid:reserve.uuid})).success,false);
 for(const page of [a,b,c])await page.locator('[data-house-confirm]').click();await a.waitForFunction(()=>v.battle&&v.clubControl);
 for(const page of [a,b,c])await page.waitForFunction(()=>!v.$refs.battleOverlay.entranceActive&&!v.$refs.battleOverlay.presentationBusy);
 const room=club.room,side=room.sides[1],ownerIndex=accounts.findIndex(a=>a.user.id===side.control.controllerId),partnerIndex=side.ids.map(id=>accounts.findIndex(a=>a.user.id===id)).find(i=>i!==ownerIndex),round=room.engine.round;
 await pages[ownerIndex].locator('[data-house-pass]').click();await pages[partnerIndex].waitForFunction(()=>v.clubControl.canControl);
 assert.equal(room.engine.round,round);assert.equal(room.engine.pending.size,0);assert.equal(room.sides[1].control.controllerId,accounts[partnerIndex].user.id);checks.push('relay-without-extra-turn');
 await pages[ownerIndex].evaluate(()=>v.socket.disconnect());await pages[partnerIndex].waitForFunction(()=>v.clubControl?.paused);await pages[ownerIndex].evaluate(()=>v.socket.connect());await ready(pages[ownerIndex]);await pages[partnerIndex].waitForFunction(()=>v.clubControl&&!v.clubControl.paused);assert.equal(room.sides[1].control.controllerId,accounts[partnerIndex].user.id);checks.push('browser-reconnect-same-controller');
 await layout(pages[partnerIndex],'relay','.battle');
 const active=side.control,solo=room.sides[0].control;
 assert.equal((await command(pages[ownerIndex],'action',{id:room.id,turnId:room.engine.token,controlRevision:active.revision,action:'attack',number:0})).success,false);
 assert((await command(pages[partnerIndex],'action',{id:room.id,turnId:room.engine.token,controlRevision:active.revision,action:'change',number:1})).success);
 assert((await command(a,'action',{id:room.id,turnId:room.engine.token,controlRevision:solo.revision,action:'attack',number:0})).success);
 const newOwner=room.owners.get(room.copies[1].equipe.pokemons[0].uuid);assert.equal(room.sides[1].control.controllerId,newOwner);checks.push('ownership-after-switch');
 const sp=contexts.get(accounts[4].user.id).getPlayer();sp.y=14*32+16;
 assert((await command(spectator,'watch')).success);await spectator.locator('[data-club-spectator]').waitFor();assert.equal(await spectator.locator('.battle-main-actions').count(),0);checks.push('live-read-only-spectator');
 await finish(1);await spectator.locator('[data-close-club-watch]').click();
 const[[money]]=await db.execute('SELECT money FROM users WHERE id=?',[accounts[0].user.id]);assert.equal(Number(money.money),98999);checks.push('durable-camp-stakes');

 // The same room now hosts a 12v12 match, with six contributions per owner.
 for(let n=0;n<4;n++)await move(n,2);await open(a);await a.locator('#house-mode-2v2').click();await a.locator('.house-formats button').filter({hasText:'12 contre 12'}).click();await a.locator('[data-create-duel]').click();await a.waitForFunction(()=>v.clubDuel?.phase==='waiting');
 for(let n=0;n<4;n++)await move(n,Math.floor(n/2));await a.locator('[data-house-preparation]').waitFor();assert.deepEqual(club.room.sides.map(s=>s.composition.length),[12,12]);await layout(a,'twelve');
 for(const page of [a,b,c,d])await page.locator('[data-house-confirm]').click();await a.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.opponentParty?.length===12);checks.push('twelve-per-camp-and-twelve-balls');
 await finish(0);

 // PvE gives exactly the player's party size at the matching levels and no XP.
 for(let n=0;n<4;n++)await move(n,2);await open(a);await a.locator('#house-mode-pve').click();await layout(a,'pve');await a.locator('[data-house-trainer=champion_wanda]').click();
 const before=(await teams.loadEquipe(accounts[0].user.id)).pokemons.map(pc.encodePokemon);
 await a.locator('[data-create-duel]').click();await a.waitForFunction(()=>v.battle&&v.clubControl);assert.equal(club.room.copies[1].equipe.pokemons.length,6);assert.deepEqual(club.room.copies[1].equipe.pokemons.map(p=>p.level),club.room.copies[0].equipe.pokemons.map(p=>p.level));
 const pveControl=club.room.sides[0].control;assert((await command(a,'action',{id:club.room.id,turnId:club.room.engine.token,controlRevision:pveControl.revision,action:'attack',number:0})).success);
 await finish(0);assert.deepEqual((await teams.loadEquipe(accounts[0].user.id)).pokemons.map(pc.encodePokemon),before);checks.push('pve-matching-levels-no-xp-no-progression-write');

 // Keep the original 1v1 engine, review screen and PC Pokemon wagers operational.
 for(let n=0;n<4;n++)await move(n,2);await open(a);await a.locator('#house-mode-1v1').click();await a.locator('[data-duel-money]').fill('1000');await a.locator('[data-duel-pokemon-stake]').check();await a.locator('[data-create-duel]').click();await a.waitForFunction(()=>v.clubDuel?.phase==='waiting');
 await move(0,0);await move(1,1);await a.waitForFunction(()=>v.clubDuel?.phase==='review');
 const stakes=[];for(const [index,page]of [a,b].entries()){
  const pokemon=(await pc.loadEntries(accounts[index].user.id))[0].pokemon;stakes.push(pokemon.uuid);
  await page.locator('.pokemon-filter select').selectOption('0');await page.locator(`[data-stake-pokemon="${pokemon.uuid}"]`).click();await page.waitForFunction(uuid=>v.clubDuel?.participants[v.clubDuel.you]?.pokemon?.uuid===uuid,pokemon.uuid);
 }
 await layout(a,'classic-review');const oldParties=await Promise.all(accounts.slice(0,2).map(async a=>(await teams.loadEquipe(a.user.id)).pokemons.map(pc.encodePokemon)));
 for(const page of [a,b])await page.locator('[data-confirm-duel]').click();for(const page of [a,b])await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction,{},{timeout:20000});
 await a.locator('.action-flee').click();await b.locator('.action-attack').click();await b.locator('.battle-grid-attacks button').first().click();
 for(const page of [a,b]){await page.locator('[data-battle-result-continue]').waitFor({timeout:20000});await page.locator('[data-battle-result-continue]').click();}
 await b.waitForFunction(()=>v.clubDuel?.phase==='finished');assert((await pc.loadEntries(accounts[1].user.id)).some(e=>e.pokemon.uuid===stakes[0]));
 for(const [index,a]of accounts.slice(0,2).entries())assert.deepEqual((await teams.loadEquipe(a.user.id)).pokemons.map(pc.encodePokemon),oldParties[index]);
 checks.push('classic-one-v-one-money-and-pc-wager-no-xp');
 success=true;
}finally{
 await browser?.close();club?.close();await new Promise(resolve=>io.close(resolve));await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 for(const a of accounts)await db.execute('DELETE FROM users WHERE id=?',[a.user.id]);await db.end();success=success&&!errors.length;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,views,checks,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')},null,2));
}
assert(success,JSON.stringify(errors));console.log(JSON.stringify({success,engine,views:views.length,checks}));})().catch(error=>{console.error(error.stack);process.exitCode=1;});

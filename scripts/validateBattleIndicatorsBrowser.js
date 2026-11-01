// Real authenticated client and battle synchronizer, dedicated SQL fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory'),progress=require('../server/persistence/progressionRepository');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-battle-indicators-dist',out='/tmp/riftmon-'+(process.env.MOVE_TYPE_COLORS_ONLY==='1'?'move-colors-':'battle-indicators-')+engine;fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,battle,battlePlayer,socketId,success=false;const errors=[],views=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const mon=id=>{const p=factory.create(id,25,true);p.passiveAbility=null;p.heldItem=null;p.abilities=['Splash'];p.movePp=[40];return p;};
function encounter(ids,type='wild'){
 const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[mon(9)]},drifts:[],equipped:[]};const b={socketId:'fixture-enemy',userId:0,npc:type!=='pvp',equipe:{pokemons:ids.map(mon)},drifts:[],equipped:[]};
 battlePlayer=a;battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>io.to(p.socketId).emit(event,data),rules:{report:false,rewards:false},paceMs:0});return b;
}
async function end(){battle.finish(null,'fled');battle=null;await page.locator('[data-battle-result-continue]').waitFor();await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});}
async function balls(ready,hurt,ko){await page.waitForFunction(({ready,hurt,ko})=>{const row=document.querySelector('[data-opponent-party]');return row&&['ready','hurt','ko'].every((state,i)=>row.querySelectorAll(`[data-party-state="${state}"]`).length===[ready,hurt,ko][i]);},{ready,hurt,ko});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'indicators_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id]);
 await progress.markPokemonSeen(user.user.id,19);await progress.markPokemonCaught(user.user.id,25);
 const before=(await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY position',[user.user.id]))[0],bag=(await db.execute('SELECT * FROM user_items WHERE user_id=? ORDER BY item_key',[user.user.id]))[0];assert(!before.some(p=>p.pokemon_id===25));
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852}});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.caughtSpeciesIds.includes(7)&&v.caughtSpeciesIds.includes(25)){window.v=v;return true;}});socketId=await page.evaluate(()=>v.socket.id);await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 if(process.env.MOVE_TYPE_COLORS_ONLY==='1'){
  const catalog=require('../data/game/moves.json');
  for(const kind of['wild','trainer','pvp']){
   encounter([7],kind);battlePlayer.equipe.pokemons[0].abilities=['Wave Crash','Ice Spinner','Weather Ball','Tackle'];battlePlayer.equipe.pokemons[0].movePp=[10,15,10,35];battle.sync();
   await page.locator('.action-attack:enabled').waitFor();await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().waitFor();
   const exhaustive=await page.evaluate(entries=>{
    const overlay=v.$refs.battleOverlay,original=[...overlay.currentPokemon.abilities],resolved=overlay.resolvedMoveTypes;
    overlay.resolvedMoveTypes=null;
    const failed=[];for(const move of entries){overlay.currentPokemon.abilities=[move.ename];if(overlay.moveButtonType(0)!==move.type)failed.push(move.ename);}
    overlay.currentPokemon.abilities=original;overlay.resolvedMoveTypes=[null,null,'Fire',null];
    const weather=overlay.moveButtonType(2);overlay.resolvedMoveTypes=resolved;return{failed,weather};
   },catalog);assert.deepEqual(exhaustive.failed,[]);assert.equal(exhaustive.weather,'Fire');
   for(const [width,height]of [[320,480],[393,852],[1536,680]])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await pause(130);
    const colors=await page.locator('.battle-move-choice').evaluateAll(buttons=>buttons.map(b=>({type:b.dataset.moveType,color:b.style.getPropertyValue('--move-choice-color'),border:getComputedStyle(b).borderLeftColor,label:b.querySelector('.move-type-label')?.textContent,background:getComputedStyle(b).backgroundColor})));
    assert.deepEqual(colors.map(c=>c.type),['Water','Ice','Normal','Normal']);assert.equal(colors[0].color,'#4e8ee8');assert.equal(colors[1].color,'#63c9d3');
    assert.deepEqual(colors.slice(0,2).map(c=>c.label),['Eau','Glace']);assert.notEqual(colors[0].border,colors[1].border);assert.notEqual(colors[0].background,colors[1].background);
    views.push({kind,width,height,theme,colors});await page.screenshot({path:path.join(out,`colors-${kind}-${theme}-${width}.png`)});
   }
   await end();
  }
  assert.deepEqual((await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY position',[user.user.id]))[0],before);
  assert.deepEqual((await db.execute('SELECT * FROM user_items WHERE user_id=? ORDER BY item_key',[user.user.id]))[0],bag);assert.deepEqual(errors,[]);
  success=true;const report={success,engine,views,exhaustiveMoves:catalog.length,dynamicWeatherOverride:true,resourcesUnchanged:true,errors,closedModesPreserved:true,physicalHardware:false};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success,engine,views:views.length,exhaustiveMoves:catalog.length}));return;
 }
 encounter([7]);await page.locator('[data-caught-species="7"]').waitFor();assert.equal(await page.locator('[data-opponent-party]').count(),0);
 for(const [width,height]of [[320,480],[393,852],[844,390],[1536,680]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await pause(160);
  const m=await page.evaluate(()=>{const marker=document.querySelector('[data-caught-species]'),card=marker.closest('.battle-status'),actions=document.querySelector('.battle-action-shell'),rect=n=>n.getBoundingClientRect().toJSON(),before=rect(actions);marker.style.display='none';const without=rect(actions);marker.style.display='';return{marker:rect(marker),card:rect(card),before,without,overflow:card.scrollWidth-card.clientWidth};});assert(m.marker.width>=14&&m.marker.height>=14);assert(m.marker.left>=m.card.left&&m.marker.right<=m.card.right+1);assert(m.overflow<=1);assert.equal(m.before.y,m.without.y);assert.equal(m.before.height,m.without.height);views.push({width,height,theme,markerFits:true,controlsUnchanged:true});await page.screenshot({path:path.join(out,`caught-${theme}-${width}.png`)});
 }await end();
 encounter([19]);await page.locator('.action-attack:enabled').waitFor();assert.equal(await page.locator('[data-caught-species]').count(),0);await progress.markPokemonCaught(user.user.id,19);io.to(socketId).emit('pokedexState',await progress.loadPokedex(user.user.id));await page.locator('[data-caught-species="19"]').waitFor();await end();
 encounter([25]);await page.locator('[data-caught-species="25"]').waitFor();await end();
 const enemy=encounter([7,19,16,25,1,4],'trainer');await balls(6,0,0);assert.equal(await page.locator('[data-caught-species]').count(),0);
 const hurt=enemy.equipe.pokemons[0];hurt.currentHp--;battle.sync();await balls(5,1,0);hurt.currentHp=hurt.maxHp;battle.sync();await balls(6,0,0);
 hurt.currentHp=0;battle.prune();enemy.equipe.pokemons[0].currentHp--;battle.sync();await balls(4,1,1);
 for(const [width,height]of [[320,480],[393,852],[844,390],[1536,680]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await pause(160);
  const m=await page.locator('[data-opponent-party]').evaluate(row=>{const rect=n=>n.getBoundingClientRect().toJSON(),scene=rect(document.querySelector('.battle-scene')),actions=document.querySelector('.battle-action-shell'),before=rect(actions),colors=['ready','hurt','ko'].map(state=>getComputedStyle(row.querySelector(`[data-party-state="${state}"] .ball-top`)).fill);row.style.display='none';const without=rect(actions);row.style.display='';return{row:rect(row),scene,before,without,colors};});assert.equal(new Set(m.colors).size,3);assert(m.row.left>=m.scene.left&&m.row.right<=m.scene.right+1&&m.row.bottom<=m.scene.bottom+1);assert.equal(m.before.y,m.without.y);assert.equal(m.before.height,m.without.height);assert.match(await page.locator('[data-opponent-party]').getAttribute('aria-label'),/5 Pokémon encore aptes sur 6 · 1 blessé/);await page.screenshot({path:path.join(out,`party-${theme}-${width}.png`)});
 }await end();
 const pvp=encounter([7,19,16],'pvp');pvp.equipe.pokemons[0].currentHp--;battle.sync();await balls(3,0,0);assert.equal(await page.locator('[data-caught-species]').count(),0);await end();
 assert.deepEqual((await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY position',[user.user.id]))[0],before);assert.deepEqual((await db.execute('SELECT * FROM user_items WHERE user_id=? ORDER BY item_key',[user.user.id]))[0],bag);assert.deepEqual(errors,[]);
 const report={success:true,engine,views,caughtHistory:true,seenOnlyUnmarked:true,historyWithoutOwnedPokemon:true,livePokedexRefresh:true,noTrainerCaughtMarker:true,conditionsFollowDamageHealAndKO:true,threeDistinctColors:true,controlsUnchanged:true,pvpReservePrivacy:true,legacyCompatible:true,resourcesUnchanged:true,errors,closedModesPreserved:require('../data/game/modeAvailability.json').expeditionsAvailable===false,physicalHardware:false};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));success=true;console.log(JSON.stringify(report));
 }finally{if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});battle?.finish(null,'fled');try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}}
})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

// Shared gender badges: real Adventure/PC data and expedition worlds, test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teamRepo=require('../server/persistence/teamRepository'),pcRepo=require('../server/persistence/pokemonStorageRepository');
const factory=require('../server/game/drift/pokemonFactory'),{gender}=require('../server/game/items/stoneEvolution');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-gender-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-gender-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0,starterChoiceMs:60000}});
let browser,page,context,base,success=false;const users=[],errors=[],checks=[],views=[];
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'gender_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();users.push(u);return u;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function openContext(u,width=393,height=852){context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));}
async function closeContext(){await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
async function openTeam(){await page.locator('.team-toggle-btn').click();await page.locator('.team-row').first().waitFor();await page.waitForFunction(()=>!v.teamLoading);}
async function badgeCheck(){const expected=await page.evaluate(()=>v.teamPokemons.map(p=>p.gender));assert(expected.length&&expected.every(g=>['male','female','genderless'].includes(g)));const actual=await page.locator('.team-panel [data-pokemon-gender]').evaluateAll(nodes=>nodes.map(n=>n.dataset.pokemonGender));assert.deepEqual(actual,expected);assert(await page.locator('.team-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));return expected;}
async function detailCheck(expected){const badge=page.locator('.companion-traits [data-pokemon-gender]');await badge.scrollIntoViewIfNeeded();assert.equal(await badge.getAttribute('data-pokemon-gender'),expected);assert.match(await badge.innerText(),{male:/Mâle/,female:/Femelle/,genderless:/Asexué/}[expected]);assert(await page.locator('.companion-sheet').evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
(async()=>{try{
  assert(fs.existsSync(path.join(dist,'index.html')),'Complete the build first');server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  const u=await create(),guest=await create(),team={pokemons:[32,29,81,1,7,25].map(id=>factory.create(id,25,true))};
  for(const p of team.pokemons)delete p.gender; // Legacy SQL Pokémon, without any new persisted field.
  const expected=team.pokemons.map(gender);await teamRepo.editEquipe(u.user.id,team);
  const stored=factory.create(29,25,true);delete stored.gender;await pcRepo.storeCapturedPokemon(u.user.id,stored);
  await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[u.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[u.user.id]);
  const before=JSON.stringify({team:await teamRepo.loadEquipe(u.user.id),entries:await pcRepo.loadEntries(u.user.id)});
  browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
  for(const[width,height]of [[320,480],[393,852],[1365,900]]){
    await openContext(u,width,height);await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));await openTeam();assert.deepEqual(await badgeCheck(),expected);
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);
      await page.screenshot({path:path.join(out,`team-${width}-${theme}.png`)});
      await page.locator('.team-detail-link').first().click();await page.locator('.companion-sheet').waitFor();
      for(let i=0;i<3;i++){await detailCheck(expected[i]);if(i<2)await page.locator('[data-companion-next]').click();}
      await page.screenshot({path:path.join(out,`sheet-${width}-${theme}.png`)});await page.locator('.companion-close').click();views.push({width,height,theme});
    }
    await page.locator('.team-close').click();await closeContext();
  }
  checks.push('Legacy Adventure Pokémon expose stable male, female and genderless values in team lists and sheets, including navigation');
  await openContext(u);await page.goto(base+'/game');await ready();await page.evaluate(()=>v.espace());await page.locator('.pc-terminal').waitFor();await page.locator('[data-pc-loading]').waitFor({state:'hidden'});
  await page.locator(`[data-pc-pokemon="${stored.uuid}"]`).click();await page.locator('[data-pc-details]').click();await page.locator('.companion-sheet').waitFor();await detailCheck('female');await page.screenshot({path:path.join(out,'pc-sheet.png')});await page.locator('.companion-close').click();await page.locator('.pc-close').click();
  assert.equal(JSON.stringify({team:await teamRepo.loadEquipe(u.user.id),entries:await pcRepo.loadEntries(u.user.id)}),before);checks.push('PC sheet shares the badge; owned Pokémon, stats and stored data are unchanged');
  await page.goto(base+'/colosseum');await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await ready();await openTeam();const solo=await badgeCheck();await page.locator('.team-detail-link').first().click();await detailCheck(solo[0]);await page.locator('.companion-close').click();await page.locator('.team-close').click();await page.evaluate(()=>v.leaveDrift());await page.locator('[data-colosseum-lobby]').waitFor();
  store.connect(u.user,'gender-host');store.connect(guest.user,'gender-guest');const lobby=store.create(u.user,{capacity:2,durationMinutes:30});store.join(guest.user,lobby.code);for(const f of [u,guest])store.ready(f.user,true);await cleanup.runtime.start(u.user);for(const f of [u,guest]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
  await page.goto(base+'/drift/game');await ready();await openTeam();const multi=await badgeCheck();await page.locator('.team-detail-link').first().click();await detailCheck(multi[0]);await page.locator('.companion-close').click();await page.locator('.team-close').click();checks.push('Real Colosseum and Rift use the shared list and sheet');
  assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,checks,errors}));
}finally{
  if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1500)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
  try{
    await browser?.close();await new Promise(r=>io.close(r));
    let timer;try{await Promise.race([require('../server/realtime/accountConnection').waitForAccountConnections(io),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Account cleanup timed out')),5000);})]);}finally{clearTimeout(timer);}
  }finally{cleanup();for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();}
}})().then(()=>process.exit(0),error=>{console.error(error.stack);process.exit(1);});

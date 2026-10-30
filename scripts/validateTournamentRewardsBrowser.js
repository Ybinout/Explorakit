// Real private Socket/SQL controllers. Forced KOs and reward fixtures are local
// to this review script; no public fixture endpoint or real account is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const repo=require('../server/persistence/superTournamentRepository'),content=require('../server/game/superTournament/content'),rewards=require('../server/game/superTournament/rewards'),codec=require('../server/game/drift/checkpointCodec');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),originalCreate=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=originalCreate(options);controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium';if(!['chromium','webkit'].includes(engine))throw Error('Unsupported browser');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-endless-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-endless-browser-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,id,success=false;const errors=[],views=[],used=[];
const controller=()=>controllers.get(id);
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(8000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(key,n){for(let i=0;i<n;i++){await page.evaluate(key=>v.socket.emit('playerAction',key),key);await page.waitForTimeout(140);}await page.waitForTimeout(300);}
async function finish(){await controller().execute(()=>controller().atomic(()=>{const c=controller(),b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();}));await page.locator('[data-battle-result-continue]').waitFor();assert.equal(await page.locator('.tournament-reward-panel').count(),0);await page.locator('[data-battle-result-continue]').click();await page.locator('.tournament-reward-panel').waitFor();}
async function pick(key){
 await page.locator(`[data-reward-card="${key}"]`).click();const card=content.state(controller().run).reward.choices.find(c=>c.key===key),target=card.targets[0];
 const payload={offerId:controller().run.reward.id,cardKey:key};
 if(card.target!=='team'){await page.locator(`[data-reward-target="${target.uuid}"]`).click();payload.pokemonUuid=target.uuid;}
 if(card.target==='move'){payload.moveIndex=target.moves[0].index;await page.locator('[data-reward-move]').selectOption(String(payload.moveIndex));}
 assert(await page.locator('[data-reward-confirm]').isEnabled());await page.locator('[data-reward-confirm]').click();await page.locator('.tournament-reward-panel').waitFor({state:'hidden'});
 const saved=await repo.load(id);assert.equal(saved.run.phase,'cleared');assert.equal(saved.run.reward,null);assert.equal((await command('superTournament:reward',payload)).success,false);return payload;
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'endless_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const u=await response.json();id=u.user.id;
 const team={pokemons:[9,94,212,248,445,121].map(species=>factory.create(species,100,true))};await teams.editEquipe(id,team);
 for(const [key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);
 await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[id,content.PASS]);await db.execute("UPDATE users SET map='super_tournament_lobby',x=448,y=304 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(u=>localStorage.setItem('explorakit.user',JSON.stringify(u)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game');await ready();await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:false,masterVolume:0});v.socket.emit('Space');});await page.locator('.tournament-panel').waitFor();assert.match(await page.locator('.rules').innerText(),/en boucle, sans fin/);assert.match(await page.locator('.rules').innerText(),/Aucune XP/);assert.match(await page.locator('.rules').innerText(),/10 niveaux à chaque cycle de 16 combats/);assert.match(await page.locator('.rules').innerText(),/95\/105\/110/);
 await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);const original=codec.encode(await teams.loadEquipe(id));
 assert.equal((await command('useMedicine',{itemKey:'potion',pokemonUuid:team.pokemons[0].uuid})).success,false);
 await walk('move_z',11);await ready();assert.equal(controller().run.phase,'ready');await walk('move_z',6);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);assert(await page.locator('.action-bag').isDisabled());
 const baseline=controller().run.player.equipe.pokemons.map(p=>[p.uuid,p.experience,p.level,{...p.ev}]);
 await controller().execute(()=>controller().atomic(()=>{const p=controller().run.player.equipe.pokemons[0];p.currentHp=1;p.movePp=p.movePp.map(()=>0);p.status='poison';}));
 await finish();const first=(await repo.load(id)).run.reward;assert.equal(new Set(first.cards).size,3);assert.equal(await controller().next(),false);
 await page.reload();await ready();await page.locator('.tournament-reward-panel').waitFor();assert.deepEqual((await repo.load(id)).run.reward,first);
 const sealed=codec.decode(codec.encode(controller().run.player.equipe));
 // Review all five colour palettes, readable selections and actual target controls.
 const palettes=new Map(),contrastChecks=[];
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]])for(const mode of ['light','dark'])for(const [deck,cards]of [
  ['basic',['heal_25','heal_50','heal_100']],['special',['revive_100','full_restore','full_reset']]
 ]){
  await page.setViewportSize({width,height});await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);
  await controller().execute(()=>controller().atomic(()=>{const r=controller().run;r.player.equipe=codec.decode(codec.encode(sealed));r.reward={id:randomUUID(),afterRoom:1,cards};}));
  await page.waitForFunction(key=>v.superTournament.reward?.choices[0]?.key===key,cards[0]);
  const chosen=content.state(controller().run).reward.choices.find(c=>c.usable);
  await page.locator(`[data-reward-card="${chosen.key}"]`).click();
  if(chosen.target!=='team')await page.locator(`[data-reward-target="${chosen.targets[0].uuid}"]`).click();
  assert(await page.locator('[data-reward-confirm]').isEnabled());
  assert(await page.locator(`[data-reward-card="${chosen.key}"] .reward-check`).isVisible());
  const colours=await page.locator('.reward-card').evaluateAll(nodes=>{
   const rgb=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
   const luminance=c=>c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
   return nodes.map(n=>{
    const c=getComputedStyle(n),bg=rgb(c.backgroundColor),surface=bg.map(v=>v*(1-36/255)+36);
    const texts=[...n.querySelectorAll('.reward-rarity,strong,.reward-description')];
    const contrast=Math.min(...texts.flatMap(t=>{const ink=rgb(getComputedStyle(t).color);return [ratio(ink,bg),ratio(ink,surface)];}));
    const footer=n.querySelector('.reward-selected'),f=getComputedStyle(footer),selected=n.getAttribute('aria-pressed')==='true';
    return {rarity:n.dataset.rarity,background:c.backgroundColor,selected,contrast,selectedContrast:selected?ratio(rgb(f.color),rgb(f.backgroundColor)):null};
   });
  });
  for(const c of colours){palettes.set(mode+':'+c.rarity,c.background);assert(c.contrast>=4.5,'Card text contrast '+JSON.stringify(c));if(c.selected)assert(c.selectedContrast>=4.5,'Selected footer contrast');contrastChecks.push(c.contrast);}
  assert(await page.locator('.tournament-reward-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));assert(await page.locator('.reward-content').evaluate(n=>n.scrollWidth<=n.clientWidth+1));for(const n of await page.locator('.reward-card,[data-reward-confirm]').all())assert((await n.boundingBox()).height>=44);
  await page.locator('.reward-content').evaluate(n=>{n.scrollTop=0;});await page.screenshot({path:path.join(out,`cards-${width}-${mode}-${deck}.png`)});
  await page.locator('[data-reward-confirm]').scrollIntoViewIfNeeded();assert(await page.locator('[data-reward-confirm]').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}));views.push({width,height,mode,deck});
 }
 assert.equal(palettes.size,10);assert.equal(new Set(palettes.values()).size,10,'Every rarity has a distinct background in both modes');
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.updatePreferences({...v.preferences,themeMode:'light'}));
 // Every card applies through its production Socket.IO handler and SQL save.
 for(const card of rewards.cards){
  await controller().execute(()=>controller().atomic(()=>{const r=controller().run;r.player.equipe=codec.decode(codec.encode(sealed));for(const [i,p]of r.player.equipe.pokemons.entries()){p.currentHp=i===1?0:Math.max(1,Math.floor(p.maxHp*.2));p.status=i===1?'normal':'poison';p.movePp=p.movePp.map(()=>0);}r.phase='reward';r.reward={id:randomUUID(),afterRoom:1,cards:[card.key,...rewards.cards.filter(c=>c.key!==card.key).slice(0,2).map(c=>c.key)]};}));
  await page.waitForFunction(key=>v.superTournament.reward?.choices.some(c=>c.key===key),card.key);
  const before=codec.encode(controller().run);assert.equal((await command('superTournament:reward',{offerId:controller().run.reward.id,cardKey:'forged'})).success,false);assert.deepEqual(codec.encode(controller().run),before);
  await pick(card.key);used.push(card.key);
  assert.deepEqual(controller().run.player.equipe.pokemons.map(p=>[p.uuid,p.experience,p.level,{...p.ev}]),baseline);assert.equal(controller().run.player.money,0);
 }
 // A pristine team is never trapped by three unusable rewards. Escape opens
 // the explicit abandon confirmation; cancelling returns to the same offer.
 await controller().execute(()=>controller().atomic(()=>{const r=controller().run;require('../server/game/world/playerRecovery').healTeam(r.player.equipe);r.phase='reward';r.reward=rewards.createOffer(r.player.equipe.pokemons,1);}));
 await page.locator('[data-reward-skip]').waitFor();const healthyOffer=controller().run.reward.id;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Continuer le parcours',exact:true}).click();await page.locator('[data-reward-skip]').waitFor();assert.equal(controller().run.reward.id,healthyOffer);await page.locator('[data-reward-skip]').click();await page.locator('.tournament-reward-panel').waitFor({state:'hidden'});
 // Lucie no longer ends the attempt. The real north gate starts cycle 2.
 await controller().execute(()=>controller().atomic(()=>{const r=controller().run;r.room=15;r.cleared=15;r.score=4500;r.phase='ready';controller().startBattle();}));await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.entranceChampion.name),'Lucie');await finish();const usable=content.state(controller().run).reward.choices.find(c=>c.usable);if(usable)await pick(usable.key);else{await page.locator('[data-reward-skip]').click();await page.locator('.tournament-reward-panel').waitFor({state:'hidden'});}
 assert.equal(controller().run.score,4800);const resources=controller().run.player.equipe.pokemons.map(p=>[p.uuid,p.currentHp,p.status,[...p.movePp]]);
 await walk('move_z',7);await ready();assert.equal(controller().run.room,16);assert.equal(content.state(controller().run).cycle,2);assert.equal(content.state(controller().run).opponent,'Wayne');assert.deepEqual(controller().run.player.equipe.pokemons.map(p=>[p.uuid,p.currentHp,p.status,[...p.movePp]]),resources);
 await walk('move_z',6);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);assert.equal(controller().run.battle.npcKey,'dia1');assert.deepEqual(controller().run.battle.b.equipe.pokemons.map(p=>p.level).sort((a,b)=>a-b),[95,105,110]);
 const cycle2Enemy=controller().run.battle.b.equipe.pokemons.map(p=>[p.uuid,p.level,p.currentHp,p.maxHp,p.attack,p.speed,[...p.movePp]]);
 await page.reload();await ready();await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);assert.deepEqual(controller().run.battle.b.equipe.pokemons.map(p=>[p.uuid,p.level,p.currentHp,p.maxHp,p.attack,p.speed,[...p.movePp]]),cycle2Enemy);assert([95,105,110].includes(await page.evaluate(()=>v.$refs.battleOverlay.opponent.level)));await page.waitForFunction(()=>{const b=v.$refs.battleOverlay,img=document.querySelector('.battle-background');return b?.opponent?.data&&b.currentPokemon?.data&&img?.complete&&img.naturalWidth>0&&document.querySelector('.battle-status-wild')?.innerText.includes('lv.');});await page.screenshot({path:path.join(out,'cycle2-levels-mobile.png')});
 assert.equal((await command('superTournament:abandon',{})).success,true);await page.waitForFunction(()=>!v.superTournament.active&&v.map==='centre');assert.deepEqual(codec.encode(await teams.loadEquipe(id)),original);assert.equal(Number((await repo.leaderboard(id)).personal.score),4800);assert.deepEqual(errors,[]);success=true;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,views,palettes:Object.fromEntries(palettes),minimumContrast:Math.min(...contrastChecks),cardsApplied:used.length,reconnectStable:true,onceOnly:true,forgeryRejected:true,healthySkip:true,abandonCancel:true,realGateLoop:true,cycle2Levels:[95,105,110],cycle2ReconnectStable:true,zeroXpEffortMoney:true,adventurePreserved:true,errors},null,2));
}catch(e){console.error(e.stack);try{console.error(await page?.evaluate(()=>({map:window.v?.map,phase:window.v?.superTournament?.phase,text:document.body.innerText.slice(-1500)})));await page?.screenshot({path:path.join(out,'failure.png')});}catch{}process.exitCode=1;}
finally{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();console.log(JSON.stringify({success,errors,testUserDeleted:true}));}})();

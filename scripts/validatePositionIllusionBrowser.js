// Check leftward sprite placement and Illusion visibility in an authenticated House encounter; isolated SQL data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test DB required');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const root=path.resolve(__dirname,'..');
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright'),{dbPool:db}=require(root+'/server/config/database'),users=require(root+'/server/persistence/userRepository'),teams=require(root+'/server/persistence/teamRepository'),factory=require(root+'/server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-position-illusion-dist',engine=process.env.PRESENTATION_BROWSER||'chromium',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-position-illusion-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require(root+'/server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require(root+'/server/http/authMiddleware').authenticateSocket);require(root+'/server/realtime/socketHandler')(io);
let user,browser,page,success=false,hold=false;const pending=[],errors=[],checks=[],seen=[],requested=[];let failureState=null;const club=require(root+'/server/realtime/whitepeakClub').getClub(io);
const release=(reserve=true)=>{for(let i=pending.length-1;i>=0;i--)if(reserve||!pending[i].reserve){pending[i].resolve();pending.splice(i,1);}};
async function ready(){await page.waitForFunction(()=>{const x=document.querySelector('.game-root')?.__vue__;if(x?.socket?.connected&&!x.mapLoading&&x.map===x.renderedMap){window.v=x;return true;}});await page.bringToFront();if(await page.locator('[data-patch-dismiss]').count())await page.locator('[data-patch-dismiss]').click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 user=await users.createUserWithStarter('Loader_'+randomUUID().slice(0,8),randomUUID());await db.execute("UPDATE users SET map='ville5_maison1',x=432,y=176 WHERE id=?",[user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[user.id]);
 const pokemons=[1,94,130,321,648,555].map(id=>{const p=factory.create(id,100,true);p.shiny=id===1||id===648;p.abilities=['Tackle','Splash'];p.movePp=[35,40];return p;});await teams.editEquipe(user.id,{pokemons});const owned=JSON.stringify(await teams.loadEquipe(user.id));
 browser=await playwright[engine].launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1536,height:680},hasTouch:process.env.SPRITE_TOUCH_CONTEXT==='1',isMobile:process.env.SPRITE_TOUCH_CONTEXT==='1'});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...user,token:require(root+'/server/config/auth').signAccessToken(user)});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(hold)requested.push({type:r.resourceType(),url:r.url()});});

 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 const response=await page.evaluate(()=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit('whitepeak:create',{mode:'pve',trainerKey:'dia1',level:100},(e,r)=>e?reject(e):resolve(r))));assert(response.success,JSON.stringify(response));await page.waitForFunction(()=>v.$refs.battleOverlay.canChooseAction,null,{timeout:25000});
 await page.evaluate(()=>{window.b=v.$refs.battleOverlay;window.fighters=JSON.parse(JSON.stringify(b.player.equipe.pokemons));});
 const measurements=[];
 for(const [width,height]of[[1920,1080],[1536,900],[1365,768],[1024,640],[393,852],[320,740],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(220);
  for(let index=0;index<6;index++){
   await page.evaluate(index=>{b.player={...b.player,equipe:{...b.player.equipe,pokemons:[fighters[index],...fighters.filter((_,n)=>n!==index)]}};},index);
   await page.locator('.battle-sprite-player img').evaluate(i=>i.decode());await page.waitForTimeout(45);
   const measurement=await page.evaluate(async()=>{
    const i=document.querySelector('.battle-sprite-player img'),anchor=b.$refs.playerAnchor,enemyBefore=b.getSpriteGeometry('wild');b.calibrateBattleSprite({currentTarget:i},'player');anchor.style.marginLeft='-1px';await b.$nextTick();const before=b.getSpriteGeometry('player');anchor.style.removeProperty('margin-left');
    b.calibrateBattleSprite({currentTarget:i},'player');await b.$nextTick();const after=b.getSpriteGeometry('player'),enemyAfter=b.getSpriteGeometry('wild'),scene=b.$refs.battleScene.getBoundingClientRect();
    const path=b.buildMovePath('player','special','opponent');return{id:b.currentPokemon.data.id,shiny:b.currentPokemon.shiny,before,after,enemyBefore,enemyAfter,scene:{width:scene.width,height:scene.height},path,mobile:v.showMobileControls,src:i.src};
   });
   const scale=1;assert(Math.abs(measurement.after.width/measurement.before.width-scale)<.001);assert(Math.abs(measurement.after.height/measurement.before.height-scale)<.001);assert(Math.abs(measurement.after.centerX-measurement.before.centerX-(measurement.mobile?-8:-24))<.01);assert.equal(measurement.after.bottomY,measurement.before.bottomY);assert.deepEqual(measurement.enemyBefore,measurement.enemyAfter);
   if(!measurement.mobile)assert(measurement.after.centerX-measurement.after.width/2>=-1,JSON.stringify(measurement));assert(measurement.after.bottomY-measurement.after.height>=-1);assert(measurement.after.bottomY<=measurement.scene.height+1);assert.equal(measurement.path.startX,measurement.after.centerX);assert.equal(measurement.path.startY,measurement.after.centerY);
   measurements.push({viewport:[width,height],...measurement});
  }
  await page.screenshot({path:path.join(out,width+'x'+height+'.png')});
 }
 for(const id of [570,571]){
  const active=club.room.engine,fox=factory.create(id,100,true);fox.passiveAbility='Illusion';active.b.equipe.pokemons[0]=fox;const own=active.active(0);own.passiveAbility='Illusion';
  const forms=require(root+'/server/game/abilities/abilityForms');forms.attachTeam(active.b.equipe.pokemons);forms.attachTeam(active.a.equipe.pokemons);forms.sync(fox,'entry');forms.sync(own,'entry');active.sync();
  await page.waitForFunction(id=>v.$refs.battleOverlay.opponent?.data?.id===id&&v.$refs.battleOverlay.currentPokemon?.passiveAbility==='Illusion',id);await page.waitForTimeout(100);
  assert.equal(await page.locator('.battle-status-wild [data-battle-ability]').count(),1);assert(!(await page.locator('.battle-status-wild [data-battle-ability]').innerText()).includes('Illusion'));assert((await page.locator('.battle-status-player [data-battle-ability]').innerText()).includes('Illusion'));
  assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.opponent.passiveAbility),fox.__battle.illusion.passiveAbility);assert.deepEqual(await page.evaluate(()=>v.$refs.battleOverlay.opponent.data.type),fox.__battle.illusion.types);assert.equal(fox.passiveAbility,'Illusion');assert(fox.__battle.illusion);await page.screenshot({path:path.join(out,'illusion-'+id+'.png')});
  const old=Math.random;Math.random=()=>.8;try{require(root+'/server/game/battle/battleEngine').useattack('Tackle',own,fox,{battleState:active.state,attackerSide:active.sides[0],defenderSide:active.sides[1]});}finally{Math.random=old;}
  assert.equal(fox.__battle.illusion,null);active.sync();await page.waitForFunction(()=>!v.$refs.battleOverlay.opponent?.__battle?.illusion);assert.equal(fox.passiveAbility,'Illusion');assert((await page.locator('.battle-status-wild [data-battle-ability]').innerText()).includes('Illusion'));
 }
 checks.push('Zorua-Zoroark-opposing-appearance-ability-types-and-owner-real-ability','real-hit-breaks-disguise-without-changing-stored-ability');
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));assert.equal(measurements.length,42);assert.equal(JSON.stringify(await teams.loadEquipe(user.id)),owned);assert.deepEqual(errors,[]);checks.push('42-sprite-shape-and-viewport-configurations','desktop-player-shifted-left-24px','mobile-player-shifted-left-8px','size-and-feet-preserved','no-desktop-player-edge-cropping','opponent-geometry-unchanged','attack-origin-follows-new-center','owned-team-unchanged');success=true;

 }catch(e){errors.push(e.message);if(page)failureState=await page.evaluate(()=>({href:location.href,socket:v.socket.io.uri,map:v.map,phase:v.$refs.battleOverlay.entrancePhase,environment:v.$refs.battleOverlay.environment,spriteMethod:String(v.$refs.battleOverlay.getPokemonSprite),sprites:[...document.querySelectorAll('.battle-sprite')].map(i=>i.src)})).catch(()=>null);if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;
 }finally{hold=false;release();if(club.room?.phase==='battle'){await club.execute(()=>club.room.engine.finish(null,'server_restart'));await club.tick();}await browser?.close();club.close();await new Promise(r=>io.close(r));await require(root+'/server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,checks,errors,intercepted:seen,requested,failureState,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')},null,2));}
 console.log(JSON.stringify({success,engine,checks,errors}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

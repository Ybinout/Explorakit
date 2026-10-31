// Compiled shared combat UI, real packets and battle-engine state changes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle'),engine=require('../server/game/battle/battleEngine');
const browserName=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-battle-traits-dist',out='/tmp/riftmon-battle-traits-'+browserName;
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,battle,success=false;const errors=[],views=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const mon=(id,ability)=>Object.assign(factory.create(id,45,true),{passiveAbility:ability,heldItem:null,abilities:['Splash'],movePp:[40]});
async function traits(own,enemy,ownAbility,enemyAbility){
 await page.waitForFunction(({own,enemy,ownAbility,enemyAbility})=>{
  const types=side=>[...document.querySelectorAll('.battle-status-'+side+' [data-battle-type]')].map(el=>el.dataset.battleType);
  const ability=side=>document.querySelector('.battle-status-'+side+' [data-battle-ability]')?.textContent.trim()||'';
  return JSON.stringify(types('player'))===JSON.stringify(own)&&JSON.stringify(types('wild'))===JSON.stringify(enemy)&&ability('player').includes(ownAbility)&&ability('wild').includes(enemyAbility);
 },{own,enemy,ownAbility,enemyAbility});
 await page.waitForFunction(()=>!v.$refs.battleOverlay.presentationBusy);
}
async function layout(width,height,theme){
 await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await pause(180);
 const result=await page.evaluate(()=>{
  const rect=el=>el.getBoundingClientRect().toJSON(),scene=rect(document.querySelector('.battle-scene')),controls=document.querySelector('.battle-action-shell'),before=rect(controls);
  const cards=[...document.querySelectorAll('.battle-status')].map(card=>({rect:rect(card),overflow:card.scrollWidth-card.clientWidth,types:[...card.querySelectorAll('[data-battle-type]')].map(el=>({type:el.dataset.battleType,rect:rect(el),color:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color})),ability:[...card.querySelectorAll('[data-battle-ability]')].map(el=>({rect:rect(el),display:getComputedStyle(el).display,text:el.textContent.trim(),overflow:el.scrollWidth-el.clientWidth}))}));
  const traits=[...document.querySelectorAll('[data-battle-traits]')];traits.forEach(el=>el.style.display='none');const without=rect(controls);traits.forEach(el=>el.style.removeProperty('display'));
  return {scene,cards,before,without};
 });
 for(const card of result.cards){
  assert(card.overflow<=1,'Card overflows');assert(card.rect.top>=result.scene.top-1&&card.rect.bottom<=result.scene.bottom+1,'Card outside scene');
  assert.equal(card.ability.length,1);assert.notEqual(card.ability[0].display,'none');assert(card.ability[0].rect.height>=12&&card.ability[0].rect.width>=36,'Ability unreadable');assert(card.ability[0].overflow<=1,'Ability name truncated');
  for(const badge of card.types)assert(badge.rect.left>=card.rect.left&&badge.rect.right<=card.rect.right+1&&badge.rect.width>12,'Type outside card');
  assert.equal(new Set(card.types.map(t=>t.color)).size,2,'Types share a colour');
 }
 const [a,b]=result.cards.map(c=>c.rect);const overlap=Math.min(a.right,b.right)-Math.max(a.left,b.left)>0&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0;
 assert(!overlap,JSON.stringify({message:'Cards overlap',width,height,a,b}));
 assert.equal(result.before.y,result.without.y);assert.equal(result.before.height,result.without.height);
 views.push({width,height,theme,typesFit:true,abilityVisibleAndUncut:true,noCardOverlap:true,controlsUnchanged:true});await page.screenshot({path:path.join(out,`${theme}-${width}.png`)});
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'traits_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id]);
 const before=(await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY position',[user.user.id]))[0];
 browser=await playwright[browserName].launch({headless:true,...(browserName==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.players[v.socket.id]){window.v=v;return true;}});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const socketId=await page.evaluate(()=>v.socket.id);
 const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[mon(94,'Levitate')]},drifts:[],equipped:[]},b={socketId:'fixture-enemy',userId:0,npc:true,equipe:{pokemons:[mon(81,'Sturdy'),...Array.from({length:5},()=>mon(19,'Guts'))]},drifts:[],equipped:[]};
 battle=new DriftBattle(a,b,{type:'trainer',emit:(p,event,data)=>io.to(p.socketId).emit(event,data),rules:{report:false,rewards:false},paceMs:0});
 await traits(['Ghost','Poison'],['Electric','Steel'],'Lévitation','Fermeté');
 for(const[width,height]of [[320,480],[393,852],[844,390],[1024,600],[1536,680]])for(const theme of ['light','dark'])await layout(width,height,theme);
 await page.setViewportSize({width:393,height:852});
 engine.applyStageChange(a.equipe.pokemons[0],'speed',2,[]);engine.applyStageChange(b.equipe.pokemons[0],'attack',-1,[]);battle.sync();
 await traits(['Ghost','Poison'],['Electric','Steel'],'Lévitation','Fermeté');assert.equal(await page.locator('.battle-conditions').count(),2);
 a.equipe.pokemons[0].__battle.abilitySuppressed=true;battle.sync();await page.locator('.battle-status-player .ability-suppressed').waitFor();assert.match(await page.locator('.battle-status-player [data-battle-ability]').getAttribute('aria-label'),/neutralisé/);a.equipe.pokemons[0].__battle.abilitySuppressed=false;
 b.equipe.pokemons[0]=mon(351,'Forecast');battle.state.weather={kind:'rain',turns:5};battle.sync();await traits(['Ghost','Poison'],['Water'],'Lévitation','Météo');
 battle.state.weather={kind:'hail',turns:5};battle.sync();await traits(['Ghost','Poison'],['Ice'],'Lévitation','Météo');
 battle.state.weather={kind:null,turns:0};battle.sync();await traits(['Ghost','Poison'],['Normal'],'Lévitation','Météo');
 const caster=mon(55,'Damp');caster.abilities=['Soak'];caster.movePp=[20];b.equipe.pokemons[0]=caster;
 const soaked=engine.useattack('Soak',caster,a.equipe.pokemons[0],{battleState:battle.state,attackerSide:battle.state.sides.enemy,defenderSide:battle.state.sides.player});assert(soaked.success);battle.sync();await traits(['Water'],['Water'],'Lévitation','Moiteur');
 const ditto=mon(132,'Imposter');ditto.abilities=['Transform'];ditto.movePp=[10];a.equipe.pokemons[0]=ditto;b.equipe.pokemons[0]=mon(94,'Levitate');
 const transformed=engine.useattack('Transform',ditto,b.equipe.pokemons[0],{battleState:battle.state,attackerSide:battle.state.sides.player,defenderSide:battle.state.sides.enemy});assert(transformed.success);battle.sync();await traits(['Ghost','Poison'],['Ghost','Poison'],'Lévitation','Lévitation');
 ditto.__battle.tempTypes=['???'];battle.sync();await traits(['???'],['Ghost','Poison'],'Lévitation','Lévitation');assert.equal(await page.locator('.battle-status-player [data-battle-type]').innerText(),'Sans type');
 b.equipe.pokemons[0].storyActor='professor';battle.sync();await page.waitForFunction(()=>!document.querySelector('.battle-status-wild [data-battle-traits]'));
 assert.deepEqual((await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY position',[user.user.id]))[0],before);assert.deepEqual(errors,[]);assert.equal(require('../data/game/modeAvailability.json').expeditionsAvailable,false);
 const report={success:true,engine:browserName,views,activeFormTypes:true,temporaryMoveTypes:true,transformedTypesAndTalent:true,suppressionIndicated:true,buffsDoNotHideTalent:true,typelessLabel:true,humanHasNoPokemonTypes:true,resourcesUnchanged:true,closedModesPreserved:true,errors,physicalDevice:false};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));success=true;console.log(JSON.stringify(report));
 }finally{if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});battle?.finish(null,'fled');await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}
})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

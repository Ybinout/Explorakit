// Real battle packets and compiled client; disposable SQL account only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-battle-gender-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-battle-gender-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,battle,success=false;const errors=[],views=[],checks=[];
const create=(id,wrongGender)=>Object.assign(factory.create(id,25,true),{gender:wrongGender});
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function badges(own,enemy){
 await page.waitForFunction(({own,enemy})=>document.querySelector('.battle-status-player [data-pokemon-gender]')?.dataset.pokemonGender===own&&document.querySelector('.battle-status-wild [data-pokemon-gender]')?.dataset.pokemonGender===enemy,{own,enemy});
 for(const side of ['player','wild']){
  const card=page.locator('.battle-status-'+side);await card.waitFor({state:'visible'});
  assert(await card.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Card overflow '+side);
  assert(await card.locator('[data-pokemon-gender]').evaluate(n=>{const a=n.getBoundingClientRect(),p=n.closest('.battle-status').getBoundingClientRect();return a.width>=18&&a.height>=18&&a.left>=p.left&&a.right<=p.right+1;}),'Badge outside card '+side);
  assert.match(await card.locator('[data-pokemon-gender]').getAttribute('aria-label'),/Sexe : (Mâle|Femelle|Asexué)/);
 }
}
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'battle_gender_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height,type]of [[320,480,'wild'],[393,852,'arena'],[1365,900,'pvp']]){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const socketId=await page.evaluate(()=>v.socket.id);
  const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[create(128,'female')]},drifts:[],equipped:[]};
  const b={socketId:'private-fixture',userId:0,npc:type!=='pvp',equipe:{pokemons:[create(113,'male')]},drifts:[],equipped:[]};
  battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>io.to(p.socketId).emit(event,data),rules:{report:false,rewards:false},paceMs:0});
  await badges('male','female');await page.screenshot({path:path.join(out,`${width}-${type}.png`)});
  // Replacements go through the real authoritative synchronizer and presentation queue.
  a.equipe.pokemons=[create(113,'male')];b.equipe.pokemons=[create(132,'male')];battle.sync();await badges('female','genderless');
  a.equipe.pokemons=[create(132,'female')];a.equipe.pokemons[0].__battle={transformSpeciesId:128};b.equipe.pokemons=[create(475,'female')];battle.sync();await badges('genderless','male');
  // The same widget must remain within the card with long names and a status.
  await page.evaluate(()=>{const overlay=v.$refs.battleOverlay;overlay.opponent.name='Étouraptor au très long nom';overlay.opponent.truename=overlay.opponent.name;overlay.opponent.status='paralysis';});
  await badges('genderless','male');await page.screenshot({path:path.join(out,`${width}-status.png`)});
  await page.evaluate(()=>{const overlay=v.$refs.battleOverlay;overlay.$set(overlay.opponent,'storyActor','professor');});await page.waitForFunction(()=>!document.querySelector('.battle-status-wild [data-pokemon-gender]'));
  await page.evaluate(()=>{const overlay=v.$refs.battleOverlay;overlay.$set(overlay.currentPokemon,'isEgg',true);});await page.waitForFunction(()=>!document.querySelector('.battle-status-player [data-pokemon-gender]'));
  views.push({width,height,type});battle.finish(null,'fled');battle=null;await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 checks.push('Both combat HUDs use authoritative male/female/genderless values despite invalid raw fields');
 checks.push('Sex follows replacements; transformed Ditto stays genderless; human and egg badges are hidden');
 checks.push('Shared combat UI fits mobile and desktop, including long names and status labels');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,views,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1200)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 battle?.finish(null,'fled');
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

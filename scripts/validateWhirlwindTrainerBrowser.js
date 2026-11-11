// Authenticated browser replay of the real trainer executor on a disposable SQL account.
const root=require('node:path').resolve(__dirname,'..'),requireAt=require('node:module').createRequire(root+'/package.json');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.DB_TEST_NAME='explorakit_test';process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const express=requireAt('express'),{Server}=requireAt('socket.io'),playwright=requireAt('playwright');
const {dbPool:db}=requireAt('./server/config/database'),teams=requireAt('./server/persistence/teamRepository'),Pokemon=requireAt('./server/game/models/Pokemon'),{getPnjTeam}=requireAt('./server/game/world/pnjTeamFactory'),tactics=requireAt('./server/game/battle/trainerTactics');
const engine=process.env.PRESENTATION_BROWSER||'chromium',out='/tmp/riftmon-whirlwind-'+engine,dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-info-buttons-dist';fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',requireAt('./server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(requireAt('./server/http/authMiddleware').authenticateSocket);requireAt('./server/realtime/socketHandler')(io);
const factory=requireAt('./server/game/drift/pokemonFactory');
function mon(move='Splash'){const p=factory.create(143,50,true);p.abilities=[move];p.movePp=[requireAt('./server/game/battle/battleEngine').getMoveByName(move).pp];p.passiveAbility='No Ability';p.heldItem=null;return p;}
let browser,page,user,running;const original=tactics.chooseAction,errors=[],results=[];
async function move(index){await page.locator('.action-attack:enabled').click();await page.locator('.battle-move-choice').nth(index).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'whirlwind_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await requireAt('./server/persistence/patchNotesRepository').acknowledge(user.user.id,requireAt('./data/game/latest_patch.json').version);
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id]);
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'early_game_tutorial',?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id,JSON.stringify({version:1,phase:'complete',metWayne:true})]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852}});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading){window.v=v;return true;}});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const id=await page.evaluate(()=>v.socket.id);await page.evaluate(()=>{v.patchNoteVisible=false;});
 for(const scenario of ['normal','clone','bounce','roots']){
  await page.evaluate(()=>{window.trace=[];const b=v.$refs.battleOverlay;for(const name of ['playMoveAnimation','playMoveResult','updateBattleState']){b['_original_'+name]||=b[name];b[name]=function(p){window.trace.push({name,move:p.moveName,next:p.wildPokemon?.uuid,player:p.player?.equipe?.pokemons?.[0]?.uuid,transitions:p.transitions});return b['_original_'+name].call(this,p);};}});
  const p=mon('Whirlwind'),reserve=mon(),npc={pokemons:[mon('Trick Room'),mon(),mon()]},outgoing=npc.pokemons[0];
  if(scenario==='bounce')outgoing.passiveAbility='Magic Bounce';
  // Scene setup below uses a genuine trainer team and executor, not a combat presentation mock.
  tactics.chooseAction=()=>({action:'attack',number:0});
  const player={id,userId:user.user.id,currentmap:'gen_route8',equipe:{pokemons:[p,reserve]}};await teams.editEquipe(user.user.id,player.equipe);
  io.to(id).emit('battletrigger',{battleType:'trainer'});running=requireAt('./server/game/battle/trainerBattle')(player,npc,io,user.user.id,{recordPokedex:false,grantBaseMoney:false,grantExperience:false});
  await page.locator('.action-attack:enabled').waitFor();
  const engineModule=requireAt('./server/game/battle/battleEngine');
  if(scenario==='clone')engineModule.ensureBattleData(outgoing).substituteHp=40;
  if(scenario==='roots')engineModule.ensureBattleData(outgoing).ingrain=true;
  await move(0);await page.waitForFunction(()=>{const b=v.$refs.battleOverlay;return window.trace.some(e=>e.name==='playMoveResult'&&e.move==='Whirlwind')&&b.canAct&&!b.presentationBusy;});
  const trace=await page.evaluate(()=>window.trace);assert.equal(trace.filter(x=>x.name==='playMoveResult'&&x.move==='Whirlwind').length,1);
  if(scenario==='normal'||scenario==='clone'){assert.notEqual(npc.pokemons[0],outgoing);assert.equal(outgoing.movePp[0],5);assert(trace.some(e=>e.name==='updateBattleState'&&e.next===npc.pokemons[0].uuid));}
  if(scenario==='bounce'){assert.equal(npc.pokemons[0],outgoing);assert.equal(player.equipe.pokemons[0],reserve);assert(trace.some(e=>e.player===reserve.uuid));assert.equal(outgoing.movePp[0],4);}
  if(scenario==='roots'){assert.equal(npc.pokemons[0],outgoing);assert.equal(player.equipe.pokemons[0],p);assert.equal(outgoing.movePp[0],4);}
  assert.equal(p.movePp[0],19);await page.screenshot({path:path.join(out,scenario+'.png')});results.push({scenario,nativeExecutor:true,correctReplacement:true,onePp:true,nextActionAvailable:true});
  await page.locator('.action-flee:enabled').click();await running;running=null;await page.locator('[data-battle-result-continue]').waitFor();await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success:true,engine,results,errors},null,2));console.log(JSON.stringify({success:true,engine,results,errors}));
}finally{tactics.chooseAction=original;await browser?.close();await running?.catch(()=>{});await new Promise(r=>io.close(r));await requireAt('./server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

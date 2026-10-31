// Authenticated browser replay of the real trainer executor on a disposable SQL account.
const root=require('node:path').resolve(__dirname,'..'),requireAt=require('node:module').createRequire(root+'/package.json');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.DB_TEST_NAME='explorakit_test';process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const express=requireAt('express'),{Server}=requireAt('socket.io'),playwright=requireAt('playwright');
const {dbPool:db}=requireAt('./server/config/database'),teams=requireAt('./server/persistence/teamRepository'),Pokemon=requireAt('./server/game/models/Pokemon'),{getPnjTeam}=requireAt('./server/game/world/pnjTeamFactory'),tactics=requireAt('./server/game/battle/trainerTactics');
const engine=process.env.PRESENTATION_BROWSER||'chromium',out='/tmp/riftmon-pursuit-'+engine,dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-pursuit-dist';fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',requireAt('./server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(requireAt('./server/http/authMiddleware').authenticateSocket);requireAt('./server/realtime/socketHandler')(io);
const factory=requireAt('./server/game/drift/pokemonFactory');
function yanmega(){const base=factory.create(469,45,true),p=new Pokemon(469,null,45,base.experience,base.iv,'Lonely',1);for(const name of ['Ancient Power','Pursuit','Slash','Detect'])p.addAbility(name);p.passiveAbility='Tinted Lens';p.heldItem='life_orb';return p;}
let browser,page,user,running;const original=tactics.chooseAction,errors=[],results=[];
async function move(index){await page.locator('.action-attack:enabled').click();await page.locator('.battle-move-choice').nth(index).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'pursuit_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852}});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading){window.v=v;return true;}});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const id=await page.evaluate(()=>v.socket.id);
 for(const scenario of ['direct','detect','ko']){
  await page.evaluate(()=>{window.trace=[];const b=v.$refs.battleOverlay;for(const name of ['playMoveAnimation','playMoveResult','updateBattleState']){b['_original_'+name]||=b[name];b[name]=function(p){window.trace.push({name,move:p.moveName,damage:p.damage,old:this.opponent?.uuid,hp:this.opponent?.currentHp,next:p.wildPokemon?.uuid,nextHp:p.wildPokemon?.currentHp,transitions:p.transitions});return b['_original_'+name].call(this,p);};}});
  const p=yanmega();
  const npc=getPnjTeam('gwenn_route8',{mode:'adventure'}),outgoing=npc.pokemons[0],incoming=npc.pokemons[scenario==='detect'?2:1];if(scenario==='ko')outgoing.currentHp=1;
  const hp=outgoing.currentHp,pp=p.movePp[1];let turn=0;tactics.chooseAction=()=>++turn===1&&scenario==='detect'?{action:'attack',number:0}:{action:'change',number:npc.pokemons.indexOf(incoming)};
  const player={id,userId:user.user.id,currentmap:'gen_route8',equipe:{pokemons:[p]}};await teams.editEquipe(user.user.id,player.equipe);
  io.to(id).emit('battletrigger',{battleType:'trainer',trainerKey:'gwenn_route8'});running=requireAt('./server/game/battle/trainerBattle')(player,npc,io,user.user.id,{recordPokedex:false,grantBaseMoney:false,grantExperience:false});
  if(scenario==='detect')await move(3);await move(1);await page.waitForFunction(()=>{const b=v.$refs.battleOverlay;return b.canAct&&!b.presentationBusy;});
  const trace=await page.evaluate(()=>window.trace),hits=trace.filter(x=>x.name==='playMoveResult'&&x.move==='Pursuit');assert.equal(hits.length,1);assert(hits[0].damage>0);assert.equal(hits[0].old,outgoing.uuid);
  const settle=trace.findIndex(x=>x.name==='updateBattleState'&&x.next===outgoing.uuid&&x.nextHp<hp),entry=trace.findIndex(x=>x.name==='updateBattleState'&&x.next===incoming.uuid);assert(settle>=0,JSON.stringify(trace));if(scenario!=='ko')assert(entry>settle,JSON.stringify(trace));assert.equal(p.movePp[1],pp-1);assert(outgoing.currentHp<hp);assert.equal(incoming.currentHp,incoming.maxHp);
  await page.screenshot({path:path.join(out,scenario+'.png')});results.push({scenario,damage:hits[0].damage,displayedBeforeSwitch:true,onePp:true});
  await page.locator('.action-flee:enabled').click();await running;running=null;await page.locator('[data-battle-result-continue]').waitFor();await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success:true,engine,results,errors},null,2));console.log(JSON.stringify({success:true,engine,results,errors}));
}finally{tactics.chooseAction=original;await browser?.close();await running?.catch(()=>{});await new Promise(r=>io.close(r));await requireAt('./server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});

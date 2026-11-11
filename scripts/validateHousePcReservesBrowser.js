// Genuine compiled Vue components and authenticated HTTP/Socket/SQL storage.
// All accounts and writes are confined to the dedicated disposable test database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');

assert.equal(process.env.DB_TEST_NAME, 'explorakit_test', 'Dedicated test database required');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-house-pc-dist';
const output = process.env.RELEASE_SCREENSHOTS || `/tmp/riftmon-house-pc-${engine}`;
const indexSha256 = createHash('sha256').update(fs.readFileSync(path.join(dist, 'index.html'))).digest('hex');
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'report.json'), { force: true });

const { dbPool: db } = require('../server/config/database');
const teams = require('../server/persistence/teamRepository');
const factory = require('../server/game/drift/pokemonFactory');

const express = require('express');
const app = express();
const server = http.createServer(app);
const io = new (require('socket.io').Server)(server);
app.use(express.json());
app.use('/api', require('../server/http/routes'));
app.use(express.static(dist));
app.get('*', (_req, response) => response.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);


let browser,page,user,base,success=false,failure=null;const errors=[],checks=[],views=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map||v.teamLoading)return false;window.v=v;return true;});}
async function snap(name,selector){await page.waitForTimeout(120);const n=page.locator(selector),r=await n.boundingBox(),vp=page.viewportSize();assert(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=vp.width+1&&r.y+r.height<=vp.height+1,name+': bounds');assert(await n.evaluate(n=>n.scrollWidth<=n.clientWidth+1),name+': horizontal overflow');await page.screenshot({path:path.join(output,name+'.png')});views.push(name);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'pc_bench_'+randomUUID().slice(0,10),password:randomUUID(),starterId:7})});assert.equal(response.status,201);user=await response.json();
 const hero=factory.create(94,80,true),reserve=factory.create(9,80,true);hero.abilities=['Shadow Ball','Thunderbolt','Focus Blast','Protect'];reserve.abilities=['Surf','Ice Beam','Rapid Spin','Protect'];for(const p of[hero,reserve])p.movePp=p.abilities.map(require('../server/game/battle/battleResources').getMaxMovePp);reserve.movePp[1]=0;reserve.passiveAbility='Torrent';
 await teams.editEquipe(user.user.id,{pokemons:[hero,reserve]});await db.execute("UPDATE users SET map='whitepeak_club',x=144,y=144 WHERE id=?",[user.user.id]);
 for(const[key,value]of[['adventure_opening','complete'],['early_game_tutorial',JSON.stringify({version:1,phase:'complete',metWayne:true})]])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.user.id,key,value]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.user.id,require('../data/game/latest_patch.json').version);
 browser=await require('playwright')[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block'});await context.addInitScript(user=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(user));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:false}));
 assert.equal(await page.evaluate(()=>v.map),'whitepeak_club');assert.equal(await page.evaluate(()=>v.worldDevices.devices[0].id),'battle-house-pc');await page.screenshot({path:path.join(output,'house-terminal-mobile.png')});views.push('house-terminal-mobile');
 await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.pc.visible&&!!v.pc.state);await snap('native-house-pc','.pc-terminal');checks.push('Native Space interaction opens the real shared PC from the House; authenticated SQL storage');await page.evaluate(()=>v.pc.visible=false);
 const before=JSON.stringify((await teams.loadEquipe(user.user.id)).pokemons);
 await page.evaluate(({hero,reserve})=>{v.battle=true;const b=v.$refs.battleOverlay;b.player={equipe:{pokemons:[hero,reserve]}};b.opponent={...hero,uuid:'foe'};b.canAct=true;b.entrancePhase='ready';b.presentationBusy=false;b.actionState={patient:false,attackPanel:false,pokemonPanel:true,bagPanel:false,text:''};window.actions=0;b.$on('action',()=>actions++);},JSON.parse(JSON.stringify({hero,reserve})));
 await page.locator('.battle-reserve-entry [data-pokemon-info]').nth(1).waitFor();
 for(const[width,height,theme]of[[320,568,'light'],[393,852,'dark'],[1365,900,'light']]){await page.setViewportSize({width,height});await page.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await page.locator('.battle-reserve-entry [data-pokemon-info]').nth(1).click();await page.locator('[data-battle-pokemon-info]').waitFor();assert.equal(await page.locator('.companion-info-move').count(),4);assert((await page.locator('.companion-info-sheet').innerText()).includes('Laser Glace'));assert((await page.locator('.companion-info-sheet').innerText()).includes('Torrent'));assert((await page.locator('.companion-info-move').nth(1).innerText()).includes('0 /'));await snap('reserve-'+width+'-'+theme,'.companion-info-sheet');await page.keyboard.press('1');assert.equal(await page.evaluate(()=>actions),0);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-battle-pokemon-info]'));assert(await page.evaluate(()=>v.$refs.battleOverlay.actionState.pokemonPanel));}
 checks.push('Native reserve selection has separate info; all four moves/effects/PP/types/talent; no swap or attack on click or number key; Escape preserves team menu');
 await page.evaluate(()=>{v.$refs.battleOverlay.player.equipe.pokemons[1].currentHp=0;});await page.locator('.battle-reserve-entry [data-pokemon-info]').nth(1).click();assert((await page.locator('.companion-info-sheet').innerText()).includes('0 /'));await page.keyboard.press('Escape');checks.push('Fainted reserves remain inspectable');
 const {make}=require('../scripts/calibrateCorruptionRaids');const {DoublesBattle}=require('../server/game/doubles/doublesBattle');const d=new DoublesBattle(...[0,1].map(i=>({id:String(i),username:'Camp '+i,equipe:{pokemons:[9,6,3].map(n=>make(n,80,4,['Surf','Protect'],'Torrent'))}})),{emit:()=>{}});const doubleFrame=d.state(0);d.sim.destroy();
 const {RaidBattle}=require('../server/game/raids/RaidBattle');const raid=new RaidBattle([1,1,2,2].map(ownerId=>({ownerId,ownerName:'Camp '+ownerId,pokemon:make(9,80,4,['Surf','Protect'],'Torrent')})),make(143,100,4,['Tackle'],'Keen Eye'),{seed:[1,2,3,4]});const raidFrame=raid.view(1);raid.sim.destroy();
 for(const [kind,frame]of[['DoublesBattle',doubleFrame],['RaidBattle',raidFrame]]){
  await page.evaluate(({kind,frame})=>{v.battle=false;if(window.fixture){const el=fixture.$el;fixture.$destroy();el.remove();}const Vue=v.$options._base,Component=v.$options.components[kind],el=document.createElement('div');v.$el.append(el);window.fixtureActions=0;window.fixture=new Vue({render:h=>h(Component,{props:{frame,control:{slots:[{canControl:true},{canControl:true}]},reduced:true,difficulty:'easy'},on:{action:event=>{if(event.action!=='presented')fixtureActions++;}}})}).$mount(el);},JSON.parse(JSON.stringify({kind,frame})));
  await page.waitForTimeout(1400);if(kind==='DoublesBattle')await page.evaluate(()=>{const b=fixture.$children[0];b.loading=false;b.playing=false;b.reserves=true;});
  for(const[width,height]of[[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});const root=page.locator(kind==='DoublesBattle'?'.double-reserves':'.raid-ally-cards');await root.locator('[data-pokemon-info]').first().click();await snap(kind+'-'+width,'.companion-info-sheet');assert.equal(await page.locator('.companion-info-move').count(),2);assert.equal(await page.evaluate(()=>fixtureActions),0);await page.keyboard.press('Escape');await page.screenshot({path:path.join(output,kind+'-cards-'+width+'.png')});views.push(kind+'-cards-'+width);}
 }
 checks.push('Compiled Doubles and Raid cards expose owned moves without submitting actions, desktop/mobile');assert.equal(JSON.stringify((await teams.loadEquipe(user.user.id)).pokemons),before);checks.push('Consultation leaves persisted team unchanged');assert.deepEqual(errors,[]);success=true;
 }catch(e){failure=e.stack;console.error(failure);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
 finally{await browser?.close();await require('../server/realtime/raidManager').getRaidManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await require('../server/realtime/draftManager').getDraftManager(io).stop();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();const report={success,engine,buildIndexSha256:indexSha256,checks,views,errors,failure,testAccountDeleted:!!user,productionAccountsTouched:false,physicalHardware:false,battleUsesCompiledPresentationFixture:true};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();

// Local-only native raid frames, test database identity, compiled production client.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const{dbPool:db}=require('../server/config/database'),{RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('./calibrateCorruptionRaids');
const dist=process.env.RELEASE_DIST_DIR,engine=process.env.PRESENTATION_BROWSER||'chromium',out='/tmp/riftmon-raid-report-'+engine;assert(dist&&fs.existsSync(dist+'/index.html'));fs.mkdirSync(out,{recursive:true});
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let user,browser,page,success=false;const checks=[],views=[],errors=[];
function battle(bossMoves=['Splash'],allies=[['Splash','Dragon Claw','Protect','Heal Pulse'],['Splash'],['Splash'],['Splash']]){const party=[135,9,143,195].map((id,i)=>({ownerId:user.id,ownerName:'Test',pokemon:make(id,120,4,allies[i],'Keen Eye')}));for(const p of party)p.pokemon.heldItem=null;const boss=make(248,100,4,bossMoves,'Keen Eye');boss.heldItem=null;return new RaidBattle(party,boss,{seed:[1,2,3,4]});}
async function mount(frame,id){await page.evaluate(async({frame,id})=>{v.raidState=null;v.battle=false;await v.$nextTick();v.battle=true;v.raidState={id,phase:'active',rift:{name:'Facile'},combat:frame};},{frame,id});await page.waitForFunction(()=>{const r=document.querySelector('[data-raid-battle]')?.__vue__;if(r&&!r.loading&&!r.playing){window.r=r;return true;}return false;});await page.evaluate(()=>{window.actions=[];r.$off('action');r.$on('action',a=>actions.push(a));});}
async function shot(name,w=393,h=852){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(220);const geometry=await page.evaluate(()=>{const root=document.querySelector('[data-raid-battle]'),scene=root.querySelector('.raid-stage'),console=root.querySelector('.raid-console');return{height:innerHeight,stage:scene.clientHeight,console:console.getBoundingClientRect().height,bottom:console.getBoundingClientRect().bottom,scroll:document.documentElement.scrollWidth};});assert(geometry.bottom<=h+1&&geometry.scroll<=w+1,name+JSON.stringify(geometry));await page.screenshot({path:path.join(out,name+'.png')});views.push({name,w,h,...geometry});}

async function deliver(frame){await page.evaluate(frame=>{v.raidState={...v.raidState,combat:frame};},frame);await page.waitForFunction(()=>!r.playing&&!r.loading,null,{timeout:45000});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');user=await require('../server/persistence/userRepository').createUserWithStarter('RaidCoop_'+randomUUID().slice(0,8),randomUUID());await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.id]);
 browser=await require('playwright')[engine].launch({headless:true});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});await context.addInitScript(auth=>localStorage.setItem('explorakit.user',JSON.stringify(auth)),{...user,token:require('../server/config/auth').signAccessToken(user)});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/game');await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading){window.v=v;return true;}return false;});await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:true,masterVolume:0});v.raidCommand=async()=>{};});
 const b=new RaidBattle([135,9,143,195].map((id,i)=>{const p=make(id,120,4,['Tackle','Heal Pulse'],'Keen Eye');p.heldItem=null;return {ownerId:i<2?user.id:user.id+1,ownerName:i<2?'Dresseur test':'Partenaire du raid',pokemon:p};}),make(143,100,4,['Splash'],'Keen Eye'),{seed:[1,2,3,4]});
 const sim=b.sim,allies=sim.p1.active,boss=b.bossPokemon;
 sim.damage(100,boss,allies[0],sim.dex.moves.get('tackle'));
 sim.raid.shield={hp:500,max:500};sim.damage(120,boss,allies[2],sim.dex.moves.get('tackle'));
 allies[1].hp-=73;sim.heal(100,allies[1],allies[2],sim.dex.moves.get('healpulse'));
 allies[0].hp-=18;sim.heal(100,allies[0],allies[0],sim.dex.moves.get('recover'));
 sim.win('p2');const report=b.view(user.id).report;
 assert.equal(report.trainers[0].damage,100);assert.equal(report.trainers[1].shield,120);assert.equal(report.trainers[1].healing,73);
 for(const won of [false,true]){
  await page.evaluate(async({report,won})=>{v.battle=false;v.raidPanelVisible=true;v.raidPreview=null;v.raidState={id:'report-fixture',phase:won?'won':'lost',won,rift:{name:'Faille de test',level:100,training:true},members:[{id:Number(v.currentUserId),casualties:[]}],combat:{finished:true,report}};await v.$nextTick();},{report,won});
  for(const [w,h]of [[320,568],[393,852],[1365,900]]){
   await page.setViewportSize({width:w,height:h});await page.locator('[data-raid-report]').waitFor();
   const reportNode=page.locator('[data-raid-report]');assert.equal(await reportNode.locator('article').count(),2);
   for(const detail of await reportNode.locator('details').all()){if(!(await detail.getAttribute('open')))await detail.locator('summary').click();}
   assert.equal(await reportNode.locator('[data-report-pokemon]').count(),4);
   assert(await reportNode.innerText().then(t=>t.includes('73')&&t.includes('120')));
   const geometry=await reportNode.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,body:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert(geometry.scroll<=geometry.width+1&&geometry.body<=w+1,JSON.stringify(geometry));
   await reportNode.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,(won?'won':'lost')+'-'+w+'.png')});views.push({won,w,h,...geometry});
  }
 }
 await page.evaluate(()=>{v.raidState={...v.raidState,combat:{...v.raidState.combat,report:{...v.raidState.combat.report,partial:true}}};});assert(await page.locator('.report-partial').isVisible());
 await page.evaluate(()=>{v.raidState={...v.raidState,combat:{...v.raidState.combat,report:null}};});assert.equal(await page.locator('[data-raid-report]').count(),0);
 checks.push('Native simulator damage/shield/effective healing shown in compiled result panel for victory and defeat','Four Pokémon grouped by their two real owners','320/393/1365 pixel layouts without horizontal overflow','Partial old checkpoints explicitly labelled; missing report safely hidden');assert.deepEqual(errors,[]);success=true;
}finally{await browser?.close();await require('../server/realtime/raidManager').getRaidManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();const report={success,engine,checks,views,errors,scope:'Native raid report in authenticated compiled client with explicit result fixtures; no production account writes',buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex')};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});

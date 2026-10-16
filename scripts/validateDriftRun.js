const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const mysql=require('mysql2/promise');
const {io}=require('../vue-explorakit/node_modules/socket.io-client');
const {findBrowserExecutable,waitForServer,stopChild,waitForDebugPage,CdpClient,evaluate,waitForExpression,registerFixture,cleanupFixture,gameVm,getDatabaseConfig,projectRoot,testDatabaseName,serverPort,debugPort,baseUrl}=require('./validatePokedexViewports');
// Test-only IPC controls: no HTTP/Socket cheat endpoint exists in the application.
const harness=`
const express=require('express'), http=require('http'), path=require('path');
const {Server}=require('socket.io'); const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.json());app.use('/api',require('./server/http/routes'));app.use(express.static(path.resolve('dist')));app.get('*',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
let offset=0, randomRoll=.99;
const {createLobbyStore}=require('./server/game/drift/lobbyStore');const store=createLobbyStore({now:()=>Date.now()+offset});
const cleanup=require('./server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,runtimeOptions:{starterChoiceMs:0,now:()=>Date.now()+offset,random:()=>randomRoll,paceMs:0}});
const factory=require('./server/game/drift/pokemonFactory');
process.on('message', message=>{
 try{
 const run=[...cleanup.runtime.runs.values()][0];
 if(message.type==='fixtures')for(const [index,p] of [...run.players.values()].entries()){
  p.equipe.pokemons=[factory.create(index===0?1:19,index===0?80:5),factory.create(7,5)];
  p.drifts=[1,13,27,35,43,58].map((number,i)=>({uuid:'fixture-'+p.userId+'-'+i,definitionId:'DRF-'+String(number).padStart(3,'0'),rarity:['legendary','rare','epic','common','mythic','legendary'][i],element:number===1?'Grass':null}));
  cleanup.runtime.send(p);
 }
 if(message.type==='trainer'){
  const p=run.players.get(message.userId);
  cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,2)]},drifts:[],equipped:[]},'arena','visual_champion');
 }
 if(message.type==='wild'){
  randomRoll=message.capture===true?0:.99;
  const p=run.players.get(message.userId);
  cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,2)]},drifts:[],equipped:[]},'wild');
 }
 if(message.type==='normalRandom')randomRoll=.99;
 if(message.type==='expire'){offset+=1200000;cleanup.runtime.tick();}
 if(message.type==='disconnectExpire'){
  const active=[...cleanup.runtime.runs.values()].find(run=>run.phase==='exploration');
  if(active.players.get(message.userId).socketId)throw Error('Le second joueur doit déjà être déconnecté.');
  offset+=91000;cleanup.runtime.tick();
 }
 process.send({ok:true,id:message.id});
 }catch(e){process.send({ok:false,id:message.id,message:e.stack});}
});
server.listen(process.env.PORT,()=>console.log('Server is running'));
`;
async function run(){
 const directory=path.resolve(process.env.DRIFT_RUN_SCREENSHOT_DIR||path.join(os.tmpdir(),'explorakit-drift-run'));
 fs.mkdirSync(directory,{recursive:true});const profile=fs.mkdtempSync(path.join(os.tmpdir(),'explorakit-drift-run-browser-'));
 const server=spawn(process.execPath,['-e',harness],{cwd:projectRoot,env:{...process.env,PORT:String(serverPort),DB_NAME:testDatabaseName,JWT_SECRET:'drift-run-visual-test'},stdio:['ignore','pipe','pipe','ipc']});
 let browser,client,peer,db,seq=0;const ids=[],runtimeErrors=[],receivedStates=[];
 const control=(type,extra={})=>new Promise((resolve,reject)=>{
  const id=++seq;const timer=setTimeout(()=>{server.off('message',listener);reject(Error('IPC timeout'));},5000);
  const listener=m=>{if(m.id!==id)return;clearTimeout(timer);server.off('message',listener);if(m.ok)resolve();else reject(Error(m.message));};server.on('message',listener);server.send({type,id,...extra});
 });
 const command=(name,data={})=>new Promise((resolve,reject)=>peer.timeout(5000).emit(name,data,(error,r)=>error?reject(error):resolve(r)));
 async function click(selector){
  const point=await evaluate(client,`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error('Commande absente ou inactive : '+${JSON.stringify(selector)});button.scrollIntoView({block:'center',inline:'nearest'});const r=button.getBoundingClientRect();if(!r.width||!r.height)throw Error('Commande masquée : '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
 }
 async function press(key,code=key,modifiers=0){
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});
 }
 async function returnToInventory(){
  if(await evaluate(client,`Boolean(document.querySelector('[data-drift-action="back"]')?.getClientRects().length)`))await click('[data-drift-action="back"]');
 }
 async function acknowledgeBattleResult(outcome, name){
  await waitForExpression(client,"Boolean(document.querySelector('[data-battle-result]'))");
  assert.equal(await evaluate(client,`${gameVm}.battleResult.outcome`),outcome,'issue réelle du combat Drift');
  assert.equal(await evaluate(client,"document.querySelector('[data-battle-result]').contains(document.activeElement)"),true,'le résultat contient le focus');
  assert.equal(await evaluate(client,"Boolean(document.querySelector('.run-panel'))"),false,'le carnet attend la lecture du résultat de combat');
  await capture(name,async({label,width,height})=>{
   const bounds=await evaluate(client,"(()=>{const r=document.querySelector('[data-battle-result]').getBoundingClientRect(),b=document.querySelector('[data-battle-result-continue]').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttonTop:b.top,buttonBottom:b.bottom,buttonHeight:b.height};})()");
   assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=height+1,label+' : résultat hors écran');
   assert.ok(bounds.buttonTop>=0&&bounds.buttonBottom<=height+1&&bounds.buttonHeight>=44,label+' : commande Continuer visible et tactile');
  });
  await click('[data-battle-result-continue]');
  await waitForExpression(client,"!document.querySelector('[data-battle-result]')");
 }
 async function openBag(quantity=10){
  await click('.menu-toggle-btn');
  const index=await evaluate(client,"Array.from(document.querySelectorAll('.menu-dropdown-item')).findIndex(button=>button.textContent.trim()==='Sac')");
  assert.ok(index>=0,'le menu du monde propose le sac');
  await click(`.menu-dropdown-item:nth-child(${index+1})`);
  await waitForExpression(client,`Boolean(document.querySelector('.bag-panel')) && !${gameVm}.bagLoading`);
  assert.equal(await evaluate(client,`${gameVm}.bagItems.find(item=>item.key==='pokeball')?.quantity`),quantity,'le stock réel de Balls reste dans le sac');
  assert.equal(await evaluate(client,"document.querySelector('.bag-panel [data-item-key=\"pokeball\"] .bag-item-qty')?.textContent.trim()"),'x'+quantity,'quantité réelle affichée dans le sac');
  assert.equal(await evaluate(client,"Boolean(document.querySelector('.bag-panel .bag-state'))"),false,'le sac ne dit pas vide pendant une expédition active');
 }
 async function worldLayout({label,width,height}){
  const rectangles=await evaluate(client,`['.menu-toggle-btn','.drift-clock','.drift-hud-toggle','.location-banner'].map(selector=>{
   const node=document.querySelector(selector);if(!node)throw Error('Élément du HUD absent : '+selector);
   const r=node.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
  })`);
  for(const [index,r] of rectangles.entries()){
   assert.ok(r.width>0&&r.height>0&&r.left>=-1&&r.right<=width+1&&r.top>=-1&&r.bottom<=height+1,label+' : HUD hors écran '+JSON.stringify(r));
   if(/btn|toggle/.test(r.selector))assert.ok(r.height>=44,label+' : cible tactile '+r.selector);
   for(const other of rectangles.slice(index+1))assert.ok(
    Math.min(r.right,other.right)-Math.max(r.left,other.left)<=1||Math.min(r.bottom,other.bottom)-Math.max(r.top,other.top)<=1,
    label+' : HUD superposé '+r.selector+' / '+other.selector);
  }
  assert.equal(await evaluate(client,`${gameVm}.driftState.phase`),'exploration',label+' : expédition toujours active');
  assert.match(await evaluate(client,"document.querySelector('.drift-clock strong').textContent.trim()"),/^\d{2}:\d{2}$/,'le HUD affiche le chrono réel');
 }
 async function snapshot(){
  const tables=['users','teams','pokemons','user_items','player_story_flags','player_quests','player_badges','user_pokedex','user_npc_battles'];const result={};
  for(const table of tables){let sql=table==='pokemons'?'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id IN (?,?)':`SELECT * FROM ${table} WHERE ${table==='users'?'id':'user_id'} IN (?,?)`;const [rows]=await db.execute(sql,ids);result[table]=rows;}
  return JSON.stringify(result);
 }
 async function capture(name,check){
  for(const [label,width,height,mobile] of [['desktop',1440,900,false],['mobile',390,844,true],['small-mobile',320,568,true],['landscape',844,390,true]]){
   await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   await evaluate(client,'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
   await evaluate(client,"const content=document.querySelector('.run-content');if(content)content.scrollTop=0;true;");
   if(check)await check({label,width,height,mobile});
   assert.equal(await evaluate(client,'document.documentElement.scrollWidth>innerWidth+1'),false,name+' '+label);
   if(await evaluate(client,"Boolean(document.querySelector('.run-panel'))")){
    const bounds=await evaluate(client,"(()=>{const el=document.querySelector('.run-panel'),r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:el.scrollWidth>el.clientWidth+1};})()");
    assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=height+1,JSON.stringify(bounds));assert.equal(bounds.overflow,false);
   }
   const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(directory,`${name}-${label}.png`),Buffer.from(shot.data,'base64'));
  }
 }
 async function reportLayout({label,width}){
  await waitForExpression(client,"Boolean(document.querySelector('[data-drift-report]'))");
  const bounds=await evaluate(client,"(()=>{const el=document.querySelector('[data-drift-report]'),r=el.getBoundingClientRect();return{left:r.left,right:r.right,overflow:el.scrollWidth>el.clientWidth+1,players:el.querySelectorAll('[data-report-player]').length};})()");
  assert.ok(bounds.left>=0&&bounds.right<=width+1,label+' : rapport dans le viewport');
  assert.equal(bounds.overflow,false,label+' : aucune largeur débordante dans le rapport');
  assert.equal(bounds.players,2,label+' : les deux équipes sont consultables');
  const exportBounds=await evaluate(client,"(()=>{const r=document.querySelector('[data-report-export]').getBoundingClientRect();return{width:r.width,height:r.height};})()");
  assert.ok(exportBounds.width>=44&&exportBounds.height>=44,label+' : export tactile');
 }
 async function captureReportSection(name,selector){
  await capture(name,async viewport=>{
   await evaluate(client,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});true;`);
   await reportLayout(viewport);
  });
 }
 async function exportReport(expected){
  await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory});
  const previous=new Set(fs.readdirSync(directory));
  await click('[data-report-export]');
  let filename;
  for(let tries=0;tries<100;tries++){
   filename=fs.readdirSync(directory).find(name=>!previous.has(name)&&name.endsWith('.json'));
   if(filename)break;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(filename,'l’export produit un fichier JSON téléchargeable');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,filename),'utf8')),expected,'l’export contient le rapport complet');
 }
 async function inspectArchive(expected){
  await waitForExpression(client,"Boolean(document.querySelector('[data-drift-history]'))");
  const selector=`[data-drift-history-run="${expected.runId}"]`;
  if(!await evaluate(client,"document.querySelector('[data-drift-history-toggle]').parentElement.open"))await click('[data-drift-history-toggle]');
  await waitForExpression(client,"document.querySelector('[data-drift-history-toggle]').parentElement.open");
  await click(selector);
  await waitForExpression(client,"Boolean(document.querySelector('[data-drift-report]'))");
  assert.equal(await evaluate(client,"document.querySelector('[data-drift-report]').__vue__.report.runId"),expected.runId,'le bilan se relit depuis le camp');
  assert.match(await evaluate(client,"document.querySelector('[data-drift-history]').textContent"),/cet appareil/,'la portée locale de l’archive est explicite');
  await capture('report-archive',async viewport=>{
   await evaluate(client,"document.querySelector('[data-drift-report]').scrollIntoView({block:'start'});true;");
   await reportLayout(viewport);
  });
  // Leave the optional archive folded so the lobby interaction stays natural.
  await click('[data-drift-history-toggle]');
 }
 try{
  await waitForServer(server);const host=await registerFixture();ids.push(host.user.id);const guest=await registerFixture();ids.push(guest.user.id);
  db=await mysql.createConnection(getDatabaseConfig());const before=await snapshot();
  browser=spawn(findBrowserExecutable(),['--headless=new','--no-sandbox','--disable-gpu','--no-first-run',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,baseUrl+'/'],{stdio:'ignore'});
  client=new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl);await client.connect();
  client.socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});
  await client.send('Page.enable');await client.send('Runtime.enable');
  await waitForExpression(client,`location.origin===${JSON.stringify(baseUrl)}`);
  await evaluate(client,`localStorage.setItem('user',${JSON.stringify(JSON.stringify({...host.user,token:host.token}))})`);
  await client.send('Page.navigate',{url:baseUrl+'/drift'});
  const lobby="document.querySelector('.drift-page').__vue__";
  await waitForExpression(client,`Boolean(document.querySelector('.drift-page')&&${lobby}.bootstrapped)`);
  await evaluate(client,`const vm=${lobby};vm.capacity=2;vm.durationMinutes=20;document.querySelector('.lobby-card form').requestSubmit();true;`);
  await waitForExpression(client,`${lobby}.lobby?.players.length===1&&!${lobby}.busy`);
  const code=await evaluate(client,`${lobby}.lobby.code`);
  peer=io(baseUrl+'/drift',{autoConnect:false,auth:{token:guest.token},transports:['websocket']});
  peer.on('drift:state',state=>receivedStates.push(state));
  const ready=new Promise((resolve,reject)=>{peer.once('drift:bootstrap',resolve);peer.once('connect_error',reject);});peer.connect();await ready;
  await command('drift:join',{code});await command('drift:ready',{ready:true});
  await evaluate(client,"document.querySelector('.room-actions .gold-button').click();true;");
  await waitForExpression(client,`!${lobby}.busy&&${lobby}.readyCount===2`);
  await evaluate(client,"document.querySelector('.launch-note button').click();true;");
  await waitForExpression(client,`location.pathname==='/drift/game'&&Boolean(${gameVm}?.driftState?.alive)`);
  assert.equal((await command('drift:enter')).success,true);
  // Exercise the normal entry, inventory and travel BEFORE any test-only team or
  // Drift fixtures. A fixture broadcast previously hid missing initial state.
  await waitForExpression(client,`${gameVm}.map==='start' && ${gameVm}.mapImage?.complete && ${gameVm}.mapImage?.naturalWidth>0`);
  const initial=await evaluate(client,`({runId:${gameVm}.driftState.id,endsAt:${gameVm}.driftState.endsAt,team:${gameVm}.driftState.team.map(p=>p.uuid),socketId:${gameVm}.socket.id})`);
  assert.equal(await evaluate(client,`${gameVm}.driftState.phase`),'exploration');
  assert.equal(await evaluate(client,`Boolean(${gameVm}.driftState.report)`),false,'les équipes adverses ne sont pas révélées par le rapport pendant l’expédition');
  assert.equal(await evaluate(client,`${gameVm}.driftState.items.find(item=>item.key==='pokeball')?.quantity`),10);
  assert.equal(await evaluate(client,`${gameVm}.driftState.items.find(item=>item.key==='drift_potion')?.quantity`),3);
  assert.equal(initial.team.length,1,'un vrai compagnon de départ');
  await capture('exploration',worldLayout);
  await openBag();await capture('bag');await press('Escape');
  await waitForExpression(client,"!document.querySelector('.bag-panel')");
  await press('q','KeyQ');
  await waitForExpression(client,`${gameVm}.map==='maison' && ${gameVm}.players[${gameVm}.socket.id]?.currentmap==='maison' && ${gameVm}.mapImage?.complete && ${gameVm}.mapImage?.naturalWidth>0`);
  await capture('travel-interior',worldLayout);
  await client.send('Page.reload',{ignoreCache:true});
  await waitForExpression(client,`Boolean(${gameVm}?.socket?.connected && ${gameVm}?.driftState?.alive) && ${gameVm}.map==='maison' && ${gameVm}.mapImage?.complete && ${gameVm}.mapImage?.naturalWidth>0`);
  assert.notEqual(await evaluate(client,`${gameVm}.socket.id`),initial.socketId,'le rechargement reconnecte une nouvelle socket');
  await openBag();await press('Escape');
  await press('s','KeyS');
  await waitForExpression(client,`${gameVm}.map==='start' && ${gameVm}.players[${gameVm}.socket.id]?.currentmap==='start' && ${gameVm}.mapImage?.complete && ${gameVm}.mapImage?.naturalWidth>0`);
  await new Promise(resolve=>setTimeout(resolve,160));
  await press('d','KeyD');
  await waitForExpression(client,`Math.abs(${gameVm}.players[${gameVm}.socket.id]?.x-80)<1`);
  assert.deepEqual(await evaluate(client,`({runId:${gameVm}.driftState.id,endsAt:${gameVm}.driftState.endsAt,team:${gameVm}.driftState.team.map(p=>p.uuid)})`),{runId:initial.runId,endsAt:initial.endsAt,team:initial.team},'voyage et reconnexion conservent la même expédition, son équipe et son échéance');
  assert.equal(await evaluate(client,`${gameVm}.driftState.phase`),'exploration','aucune fin de partie pendant le changement de carte');
  assert.deepEqual(runtimeErrors,[],'aucune exception navigateur pendant les transitions');
  await control('fixtures');await waitForExpression(client,`${gameVm}.driftState.drifts.length===6`);
  assert.ok(await evaluate(client,`${gameVm}.driftCountdown.startsWith('19:') || ${gameVm}.driftCountdown==='20:00'`));
  await click('.drift-hud button');await waitForExpression(client,"Boolean(document.querySelector('.run-panel'))");
  assert.equal(await evaluate(client,"document.querySelector('.run-panel').contains(document.activeElement)"),true,'le focus entre dans le panneau');
  async function inventoryLayout({label,width,height}){
   await returnToInventory();
   await evaluate(client,"document.querySelector('.run-content').scrollTop=0;true;");
   const slots=await evaluate(client,"Array.from(document.querySelectorAll('[data-drift-slot]')).map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height};})");
   assert.equal(slots.length,5,label+' : cinq emplacements');
   for(const slot of slots){assert.ok(slot.left>=0&&slot.right<=width+1&&slot.top>=0&&slot.top+slot.height<=height+1,label+' : emplacement hors écran');assert.ok(slot.height>=44,label+' : cible tactile de slot');}
   assert.ok(slots.every(slot=>Math.abs(slot.top-slots[0].top)<1),label+' : cinq slots sur une ligne');
   assert.ok(await evaluate(client,"document.querySelector('.drift-search').getBoundingClientRect().width>0"),label+' : recherche visible');
  }
  await capture('inventory',inventoryLayout);
  await click('.drift-search');await client.send('Input.insertText',{text:'Fureur'});
  await waitForExpression(client,"document.querySelectorAll('[data-drift-id]').length===1");
  assert.equal(await evaluate(client,"document.querySelector('[data-drift-id]').dataset.driftId"),`fixture-${host.user.id}-0`);
  await evaluate(client,"const input=document.querySelector('.drift-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));true;");
  await waitForExpression(client,"document.querySelectorAll('[data-drift-id]').length===6");
  for(let i=0;i<5;i++){
   await returnToInventory();await click(`[data-drift-id="fixture-${host.user.id}-${i}"]`);
   await waitForExpression(client,"Boolean(document.querySelector('.drift-detail [data-drift-action=\"equip\"]'))");
   await click('.drift-detail [data-drift-action="equip"]');
   await waitForExpression(client,`${gameVm}.driftState.equipped.length===${i+1}`);
  }
  await returnToInventory();await capture('equipped',inventoryLayout);
  await click(`[data-drift-id="fixture-${host.user.id}-5"]`);
  assert.equal(await evaluate(client,"document.querySelector('.drift-detail [data-drift-action=\"equip\"]').disabled"),true,'sixième équipement bloqué visuellement');
  await capture('detail');
  await click('.drift-detail [data-drift-action="discard"]');
  await waitForExpression(client,"Boolean(document.querySelector('.confirm[role=\"alertdialog\"]'))");
  assert.equal(await evaluate(client,"document.querySelector('.confirm').contains(document.activeElement)"),true,'la confirmation contient le focus');
  await press('Escape');
  await waitForExpression(client,"!document.querySelector('.confirm') && Boolean(document.querySelector('.run-panel'))");
  assert.equal(await evaluate(client,`${gameVm}.driftState.drifts.length`),6,'Échap annule la suppression');
  await returnToInventory();
  await click('[data-drift-tab="team"]');
  await waitForExpression(client,"document.querySelectorAll('.run-panel .pokemon-portrait img').length===2 && Array.from(document.querySelectorAll('.run-panel .pokemon-portrait img')).every(image=>image.complete&&image.naturalWidth>0)");
  await capture('team');
  await click('[data-drift-tab="team"]');await press('ArrowLeft');
  await waitForExpression(client,"document.activeElement.dataset.driftTab==='drifts'");
  await press('ArrowRight');
  await waitForExpression(client,"document.activeElement.dataset.driftTab==='team'");
  await evaluate(client,"document.querySelector('.run-footer button').focus();true;");
  await press('Tab');
  assert.equal(await evaluate(client,"document.activeElement===document.querySelector('.run-panel .close-button')"),true,'Tab reste dans le panneau');
  await press('Tab','Tab',8);
  assert.equal(await evaluate(client,"document.activeElement===document.querySelector('.run-footer button')"),true,'Maj+Tab revient à la dernière commande');
  // This intentional rejected command can leave the server's limit notice in
  // subsequent captures; normal interaction cannot activate the disabled button.
  assert.equal(await evaluate(client,`${gameVm}.driftCommand({name:'drift:equip',data:{uuid:'fixture-${host.user.id}-5',enabled:true}})`),false,'sixième équipement refusé par le serveur');
  await press('Escape');
  await waitForExpression(client,"!document.querySelector('.run-panel')");
  assert.equal(await evaluate(client,"document.activeElement===document.querySelector('.drift-hud button')"),true,'Échap rend le focus au bouton Drifts');
  // A real failed capture consumes a Ball. Reopening either bag must preserve
  // the server's new quantity, including the bagUpdated battle path.
  await control('wild',{userId:host.user.id});
  await waitForExpression(client,`Boolean(${gameVm}.battle && ${gameVm}.$refs.battleOverlay.canChooseAction)`);
  await click('.action-bag');
  await waitForExpression(client,"Boolean(document.querySelector('.battle-choice-btn-bag'))");
  assert.match(await evaluate(client,"document.querySelector('.battle-choice-btn-bag').textContent"),/x10/);
  await click('.battle-choice-btn-bag');
  await waitForExpression(client,`${gameVm}.bagItems.find(item=>item.key==='pokeball')?.quantity===9 && ${gameVm}.$refs.battleOverlay.canChooseAction`);
  await click('.action-bag');
  await waitForExpression(client,"Boolean(document.querySelector('.battle-choice-btn-bag'))");
  assert.match(await evaluate(client,"document.querySelector('.battle-choice-btn-bag').textContent"),/x9/,'le sac de combat conserve la Ball consommée');
  await click('.action-flee');
  await acknowledgeBattleResult('fled','battle-fled');
  await openBag(9);await press('Escape');
  await control('wild',{userId:host.user.id,capture:true});
  await waitForExpression(client,`Boolean(${gameVm}.battle && ${gameVm}.$refs.battleOverlay.canChooseAction)`);
  await click('.action-bag');
  await waitForExpression(client,"Boolean(document.querySelector('.battle-choice-btn-bag'))");
  await click('.battle-choice-btn-bag');
  await waitForExpression(client,`Boolean(${gameVm}.battleResult?.capturedPokemon)`);
  const capturedPokemon=await evaluate(client,`${gameVm}.battleResult.capturedPokemon`);
  const captureSummary=await evaluate(client,`${gameVm}.battleResult`);
  assert.equal(captureSummary.loot.length,1,'une capture réussie peut rapporter un Drift');
  assert.deepEqual(captureSummary.experience,[]);
  assert.equal(captureSummary.money,Math.min(120,20+2*capturedPokemon.level));
  await waitForExpression(client,`${gameVm}.driftState.drifts.length===7`);
  await acknowledgeBattleResult('captured','battle-captured');
  await control('normalRandom');
  await openBag(8);await press('Escape');
  await control('trainer',{userId:host.user.id});
  await waitForExpression(client,`Boolean(${gameVm}.battle && ${gameVm}.$refs.battleOverlay.canChooseAction)`);
  await evaluate(client,"document.querySelector('.action-attack').click();true;");
  await waitForExpression(client,"Boolean(document.querySelector('.battle-choice-btn'))");
  await evaluate(client,"document.querySelector('.battle-choice-btn').click();true;");
  await waitForExpression(client,`!${gameVm}.battle && ${gameVm}.driftState.drifts.length===8`);
  const trainerSummary=await evaluate(client,`${gameVm}.battleResult`);
  assert.ok(trainerSummary.experience.some(pokemon=>pokemon.xpGained>0),'le combat réel octroie de l’XP à consigner');
  assert.ok(trainerSummary.money>0&&trainerSummary.loot.length>0,'la victoire réelle rapporte de la monnaie et du butin');
  await acknowledgeBattleResult('victory','battle-victory');
  await control('expire');
  await waitForExpression(client,`${gameVm}.driftState.phase==='preparation' && ${gameVm}.map==='ville1_arene'`);
  assert.equal(await evaluate(client,`Boolean(${gameVm}.driftState.report)`),false,'les équipes adverses restent privées avant le tournoi');
  const hostTournamentTeam=await evaluate(client,`${gameVm}.driftState.team.map(pokemon=>pokemon.uuid)`);
  const guestPreparation=await command('drift:enter');
  assert.equal(guestPreparation.success,true);
  const guestTournamentTeam=guestPreparation.state.team.map(pokemon=>pokemon.uuid);
  await capture('tournament');
  peer.on('requestAction',data=>peer.emit('actionResponse',{action:'attack',number:0,turnId:data.turnId}));
  await command('drift:roundReady');
  await click('[data-drift-action="ready"]');
  await waitForExpression(client,`${gameVm}.battle`);
  for(let i=0;i<12;i++){
   if(await evaluate(client,`${gameVm}.driftState.phase==='results'`))break;
   await waitForExpression(client,`${gameVm}.driftState.phase==='results'||${gameVm}.$refs.battleOverlay.canChooseAction`);
   if(await evaluate(client,`${gameVm}.driftState.phase==='results'`))break;
   await evaluate(client,"document.querySelector('.action-attack').click();true;");
   await waitForExpression(client,"Boolean(document.querySelector('.battle-choice-btn'))");
   await evaluate(client,"document.querySelector('.battle-choice-btn').click();true;");
  }
  await waitForExpression(client,`${gameVm}.driftState.phase==='results'`);
  assert.equal(await evaluate(client,`${gameVm}.driftState.winnerId`),host.user.id);
  assert.equal(await evaluate(client,`${gameVm}.driftState.team.length`),0);
  await acknowledgeBattleResult('victory','battle-tournament-victory');
  await waitForExpression(client,`Boolean(${gameVm}.driftState.report && document.querySelector('[data-drift-report]'))`);
  const report=await evaluate(client,`${gameVm}.driftState.report`);
  assert.equal(report.runId,initial.runId);
  assert.equal(report.winnerId,host.user.id);
  assert.equal(report.players.length,2,'le rapport conserve les deux joueurs après purge');
  const hostReport=report.players.find(player=>player.id===host.user.id);
  const guestReport=report.players.find(player=>player.id===guest.user.id);
  assert.deepEqual(hostReport.tournamentTeam.map(pokemon=>pokemon.uuid),hostTournamentTeam,'équipe du vainqueur à l’entrée du tournoi');
  assert.deepEqual(guestReport.tournamentTeam.map(pokemon=>pokemon.uuid),guestTournamentTeam,'équipe du finaliste à l’entrée du tournoi');
  assert.deepEqual(hostReport.team.map(pokemon=>pokemon.uuid),hostTournamentTeam,'dernière équipe du vainqueur conservée malgré purge');
  assert.deepEqual(guestReport.team.map(pokemon=>pokemon.uuid),guestTournamentTeam,'dernière équipe du perdant conservée malgré ses K.O.');
  assert.ok(guestTournamentTeam.every(uuid=>guestReport.pokemon.some(pokemon=>pokemon.uuid===uuid&&pokemon.lostAt!==null)),'les Pokémon perdus restent dans la collection finale');
  assert.equal(hostReport.stats.arenaWins,1);
  assert.equal(hostReport.stats.pvpWins,1);
  assert.equal(hostReport.stats.fled,1);
  assert.equal(hostReport.stats.captureAttempts,2);
  assert.equal(hostReport.stats.captures,1);
  assert.ok(hostReport.pokemon.some(pokemon=>pokemon.uuid===capturedPokemon.uuid&&pokemon.source==='capture'),'le compagnon réellement capturé rejoint les archives');
  assert.equal(hostReport.stats.moneyEarned,captureSummary.money+trainerSummary.money,'monnaie du rapport égale aux gains réellement accordés');
  assert.ok(hostReport.stats.xpGained>=trainerSummary.experience.reduce((total,pokemon)=>total+pokemon.xpGained,0),'XP réelle incluse au rapport');
  assert.equal(hostReport.stats.driftsFound,2,'les drops de capture et de champion comptent, pas les fixtures');
  assert.equal(hostReport.drifts.filter(drift=>drift.source==='capture').length,1,'le butin de capture conserve sa provenance au bilan');
  assert.equal(hostReport.equippedDrifts.length,5,'les cinq Drifts restent consultables après purge');
  assert.ok(hostReport.visitedMaps.some(entry=>entry.map==='start')&&hostReport.visitedMaps.some(entry=>entry.map==='maison'),'le parcours aller/retour est consigné');
  assert.ok(hostReport.events.length>0&&guestReport.events.length>0,'journal conservé pour chaque joueur');
  assert.equal(report.matches.length,1);
  assert.equal(report.matches[0].winnerId,host.user.id);
  const guestFinal=await command('drift:enter');
  assert.equal(guestFinal.state.team.length,0,'le finaliste ne récupère aucun Pokémon jouable');
  assert.deepEqual(guestFinal.state.report,report,'tous les participants reçoivent le même bilan détaché');
  for(const state of receivedStates.filter(state=>state.phase!=='results')){
   assert.equal(Boolean(state.report),false,'aucun rapport diffusé avant la fin réelle');
   assert.ok(state.players.every(player=>!player.team&&!player.pokemon&&!player.drifts),'aucune équipe adverse dans les états publics avant la fin');
  }
  await capture('results',reportLayout);
  await click(`[data-report-player="${guest.user.id}"]`);
  await waitForExpression(client,`document.querySelector('[data-drift-report]').__vue__.selected.id===${guest.user.id}`);
  assert.equal(await evaluate(client,"document.querySelectorAll('[data-report-team] > details').length"),guestTournamentTeam.length,'les deux compagnons éliminés restent visibles');
  assert.equal(await evaluate(client,"document.querySelectorAll('[data-report-team] > details.fallen').length"),guestTournamentTeam.length,'les K.O. définitifs sont indiqués');
  await captureReportSection('results-opponent','.player-story');
  await click('[data-report-team] details:first-child > summary');
  assert.equal(await evaluate(client,"document.querySelectorAll('[data-report-team] details:first-child .pokemon-stats tbody tr').length"),6,'six statistiques, IV et EV consultables');
  if(guestReport.team[0].moves.includes('Tackle'))assert.match(await evaluate(client,"document.querySelector('[data-report-team] details:first-child .move-list').textContent"),/Charge/,'les capacités du souvenir sont affichées en français');
  assert.doesNotMatch(await evaluate(client,"document.querySelector('[data-report-team] details:first-child .pokemon-traits').textContent"),/Run Away|Guts/,'le talent utilise la traduction du jeu');
  await captureReportSection('report-pokemon','[data-report-team] details:first-child');
  await click('[data-report-team-view="tournament"]');
  await waitForExpression(client,"document.querySelectorAll('[data-report-team] > details.fallen').length===0");
  assert.equal(await evaluate(client,"document.querySelectorAll('[data-report-team] > details').length"),guestTournamentTeam.length,'équipe du tournoi avant les pertes consultable séparément');
  await click(`[data-report-player="${host.user.id}"]`);
  await click('[data-report-journal] > summary');
  assert.ok(await evaluate(client,"document.querySelectorAll('[data-report-events] li').length>0"),'journal lisible depuis le bilan');
  assert.doesNotMatch(await evaluate(client,"document.querySelector('[data-report-events]').textContent"),/visual_champion/,'le journal utilise un nom de personnage lisible');
  await captureReportSection('report-journal','[data-report-journal]');
  await exportReport(report);
  const archiveKey='explorakit:drift-reports:v1:'+host.user.id;
  const archived=await evaluate(client,`JSON.parse(localStorage.getItem(${JSON.stringify(archiveKey)}))`);
  assert.ok(archived.some(entry=>entry.runId===report.runId),'le rapport est archivé avant de quitter la partie');
  assert.equal(await snapshot(),before,'les neuf tables Aventure sont inchangées');
  await click('[data-drift-action="exit"]');
  await waitForExpression(client,"Boolean(document.querySelector('.drift-page'))");
  assert.notEqual(await evaluate(client,"getComputedStyle(document.body).overflow"),'hidden','défilement rétabli après le jeu');
  await inspectArchive(report);
  await client.send('Page.reload',{ignoreCache:true});
  await waitForExpression(client,`Boolean(document.querySelector('.drift-page')&&${lobby}.bootstrapped)`);
  await inspectArchive(report);
  // A second real expedition ends during exploration when the only opponent
  // exhausts the reconnect grace. This is a result screen, not a map crash.
  assert.equal((await command('drift:leave')).ok,true);
  await waitForExpression(client,`${lobby}.bootstrapped&&!${lobby}.lobby`);
  await evaluate(client,`const vm=${lobby};vm.capacity=2;vm.durationMinutes=20;document.querySelector('.lobby-card form').requestSubmit();true;`);
  await waitForExpression(client,`${lobby}.lobby?.players.length===1&&!${lobby}.busy`);
  const nextCode=await evaluate(client,`${lobby}.lobby.code`);
  await command('drift:join',{code:nextCode});await command('drift:ready',{ready:true});
  await click('.room-actions .gold-button');
  await waitForExpression(client,`!${lobby}.busy&&${lobby}.readyCount===2`);
  await click('.launch-note button');
  await waitForExpression(client,`Boolean(${gameVm}?.driftState?.alive)`);
  assert.equal((await command('drift:enter')).success,true);
  peer.disconnect();await new Promise(resolve=>setTimeout(resolve,150));
  await control('disconnectExpire',{userId:guest.user.id});
  await waitForExpression(client,`${gameVm}.driftState.phase==='results'&&Boolean(document.querySelector('.expedition-results'))`);
  assert.equal(await evaluate(client,`${gameVm}.driftState.players.find(player=>player.id===${guest.user.id}).reason`),'disconnected');
  assert.equal(await evaluate(client,`${gameVm}.driftState.winnerId`),host.user.id);
  assert.equal(await evaluate(client,`${gameVm}.bagItems.length`),0,'le sac disparaît uniquement avec la fin réelle de la partie');
  assert.match(await evaluate(client,"document.querySelector('.run-panel').textContent"),/90|[Dd]éconnexion/,'la cause de fin est expliquée');
  assert.match(await evaluate(client,"document.querySelector('.run-panel').textContent"),/Balls.*effacés/s,'la suppression des Balls est expliquée');
  await capture('exploration-results');
  assert.equal(await snapshot(),before,'les neuf tables Aventure restent identiques après les deux expéditions');
  await click('[data-drift-action="exit"]');
  await waitForExpression(client,"Boolean(document.querySelector('.drift-page'))");
  assert.deepEqual(runtimeErrors,[],'aucune exception JavaScript sur le parcours complet');
  console.log('Drift réel : entrée sans fixture, HUD sans superposition, sac réel (10 Balls/3 Potions), transition clavier aller/retour et reconnexion dans une maison, cinq équipements via interface, recherche/fiche, équipe illustrée, clavier/focus, capture ratée puis réussie et stock de Balls 10 → 9 → 8, victoire PNJ/drop, expiration, téléportation, duel, purge, rapport des deux équipes et pertes conservées, statistiques confrontées aux gains réels, équipes privées avant résultats, export JSON complet, archive relue au camp puis après rechargement, fin pendant exploration par déconnexion et quatre formats validés. Combats accélérés par équipes de test uniquement. Aucune exception JavaScript ; neuf tables Aventure inchangées. '+directory);
 }finally{peer?.disconnect();client?.close();await stopChild(browser);await stopChild(server);if(db)await db.end();for(const id of ids)await cleanupFixture(id);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});

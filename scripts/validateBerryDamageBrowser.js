// Compiled production UI, authenticated native Socket.IO and disposable MySQL user.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),{make}=require('./calibrateCorruptionRaids'),calculator=require('../server/game/strategy/damageCalculator');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR,out='/tmp/riftmon-berry-damage-'+engine;
assert(dist&&fs.existsSync(dist+'/index.html'));fs.mkdirSync(out,{recursive:true});
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let user,browser,page,success=false;const checks=[],views=[],errors=[];
async function shot(name,w,h){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(250);const box=await page.locator('.strategy-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return{width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,pageWidth:document.documentElement.scrollWidth};});assert(box.left>=-1&&box.right<=w+1&&box.top>=-1&&box.bottom<=h+1&&box.pageWidth<=w+1,name+JSON.stringify(box));await page.screenshot({path:path.join(out,name+'.png')});views.push({name,...box});}
async function result(){await page.waitForFunction(()=>{let c=document.querySelector('.strategy-backdrop')?.__vue__;while(c&&!c.selection)c=c.$parent;if(c&&!c.busy&&c.result){window.calc=c;return true;}return false;});return page.evaluate(()=>({result:calc.result,selection:calc.selection,options:JSON.parse(JSON.stringify(calc.options)),move:calc.moveIndex}));}
async function compare(team){const r=await result(),expected=calculator.calculate(team,{...r.selection,move:r.move,options:r.options});assert.equal(r.result.max,expected.max);assert.equal(r.result.min,expected.min);assert.equal(r.result.defenderMaxHp,expected.defenderMaxHp);return r;}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');user=await require('../server/persistence/userRepository').createUserWithStarter('BerryCalc_'+randomUUID().slice(0,8),randomUUID());
 const party=[make(143,100,4,['Body Slam','Tri Attack','Fire Punch','Earthquake'],'Keen Eye'),make(143,120,3,['Tri Attack','Body Slam','Ice Beam','Surf'],'Keen Eye'),make(448,100,4,['Aura Sphere','Flash Cannon','Dark Pulse','Dragon Pulse'],'Inner Focus')];
 party[0].heldItem='mutant_offense_normal_legendary_berry';party[1].heldItem='mutant_defense_normal_rare_berry';party[2].heldItem='choice_specs';await teams.editEquipe(user.id,{pokemons:party});
 for(const[k,value]of Object.entries({adventure_opening:'complete',early_game_tutorial:JSON.stringify({version:1,phase:'complete',metWayne:true})}))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,k,value]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
 const saved=(await teams.loadEquipe(user.id)).pokemons;
 async function snapshot(){const[p]=await db.execute('SELECT * FROM pokemons WHERE team_id=(SELECT id FROM teams WHERE user_id=?) ORDER BY id',[user.id]),[items]=await db.execute('SELECT * FROM user_items WHERE user_id=? ORDER BY item_key',[user.id]);return JSON.stringify({pokemons:p,items});}
 const before=await snapshot();
 browser=await require('playwright')[engine].launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(auth=>localStorage.setItem('explorakit.user',JSON.stringify(auth)),{...user,token:require('../server/config/auth').signAccessToken(user)});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.mode-card.adventure').click();
 await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading){window.v=v;return true;}return false;});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 await page.evaluate(()=>v.openDamageCalculator());let current=await compare(saved);assert.equal(current.result.entryItems.length,2);
 for(const side of ['attacker','defender']){const item=current.result.entryItems.find(i=>i.side===side);assert.equal(await page.locator('[data-calculator-item="'+side+'"]').innerText(),item.name);}
 assert.equal(await page.locator('.calc-notes p').filter({hasText:'bonus et malus inclus'}).count(),2);
 const plain=structuredClone(saved);plain[0].heldItem=null;const without=calculator.calculate(plain,{...current.selection,move:0,options:current.options});assert(current.result.max>without.max);
 checks.push('Native authenticated calculator includes both mutation berries and names their activation; actual damage differs from the unequipped comparison');
 for(const[w,h]of[[1280,900],[393,852],[320,568],[844,390]])await shot('berries-'+w,w,h);
 await page.locator('.calc-context summary').click();await page.locator('[data-calc-level]').selectOption('150');await page.waitForFunction(()=>window.calc?.result?.simulated?.level===150&&!calc.busy);await compare(saved);
 await page.getByLabel('PV en pourcentage · Défenseur').fill('50');await page.waitForTimeout(320);await compare(saved);await shot('common-level-150',393,852);
 checks.push('Common-level recalculation and selected HP percentage include temporary berry effects, with responsive notes');
 await page.locator('.calc-context summary').click();await page.locator('.calc-pokemon.attacker select').selectOption(saved[2].uuid);await page.waitForTimeout(320);current=await compare(saved);
 assert.equal(current.result.entryItems.length,1);assert.equal(current.result.entryItems[0].side,'defender');
 const noSpecs=structuredClone(saved);noSpecs[2].heldItem=null;assert(current.result.max>calculator.calculate(noSpecs,{...current.selection,move:current.move,options:current.options}).max);
 await shot('choice-specs',1280,900);checks.push('Choice Specs still increases actual damage, while the opposing berry remains included');
 await page.locator('.calc-swap').click();await page.waitForTimeout(320);current=await compare(saved);assert.equal(current.result.entryItems[0].side,'attacker');
 checks.push('Swapping roles recomputes item effects on the correct side');
 await page.waitForTimeout(250);const invalid=await page.evaluate(()=>new Promise(resolve=>v.socket.emit('strategy:calculate',{attacker:v.teamPokemons[0].uuid,defender:'foreign',move:0},resolve)));assert.equal(invalid.success,false);
 assert.equal(await snapshot(),before);checks.push('Repeated calculations, common levels and invalid ownership requests never alter stored Pokémon or inventory');
 assert.deepEqual(errors,[]);success=true;
 }catch(e){console.error(e.stack);if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;
 }finally{await browser?.close();await require('../server/realtime/housing').getHousingManager(io).stop();await require('../server/realtime/casinoSlots').getSlotsManager(io).stop();await require('../server/realtime/raidManager').getRaidManager(io).stop();await require('../server/realtime/draftManager').getDraftManager(io).stop();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();const report={success,engine,checks,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),scope:'Compiled client, native HTTP/Socket/MySQL, disposable account. Automated WebKit is not a physical iPhone.'};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();

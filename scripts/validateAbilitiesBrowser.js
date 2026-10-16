// Real client, socket battle and isolated SQL account. Fixtures never reach production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required.');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-six-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-release-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{runtimeOptions:{paceMs:0},checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
let browser,page,userId,success=false;const errors=[];
async function waitFor(check){const until=Date.now()+12000;while(!check()){if(Date.now()>until)throw Error('Battle did not advance');await new Promise(r=>setTimeout(r,30));}}
async function attack(){await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();}
async function finish(battle){for(const p of battle.b.equipe.pokemons)p.currentHp=0;battle.prune();battle.checkEnd();await page.locator('[data-battle-result-continue]').click();if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'abilities_'+randomUUID(),password:randomUUID(),starterId:7})});assert(response.ok);const fixture=await response.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 const p=cleanup.runtime.playerFor({id:userId});
 const gastly=factory.create(92,30),ground=factory.create(27,25);gastly.passiveAbility='Levitate';gastly.abilities=['Growl'];gastly.movePp=[40];ground.abilities=['Earthquake'];ground.movePp=[10];ground.passiveAbility=null;p.equipe.pokemons=[gastly];
 const levitation=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[ground]},drifts:[],equipped:[]},'wild'),hp=gastly.currentHp;
 await attack();await waitFor(()=>levitation.round>=2 && levitation.awaiting);assert.equal(gastly.currentHp,hp);assert(levitation.publicLog.some(message=>message.includes('Levitate')));
 await page.locator('.action-attack:enabled').waitFor();await page.screenshot({path:path.join(output,'abilities-mobile-levitate.png')});await finish(levitation);
 const rough=factory.create(445,30),contact=factory.create(19,25);rough.passiveAbility='Rough Skin';rough.abilities=['Growl'];rough.movePp=[40];contact.abilities=['Pound'];contact.movePp=[35];contact.passiveAbility=null;p.equipe.pokemons=[rough];
 const retaliation=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[contact]},drifts:[],equipped:[]},'wild'),enemyHp=contact.currentHp;
 await attack();await waitFor(()=>retaliation.round>=2 && retaliation.awaiting);assert.equal(contact.currentHp,enemyHp-Math.max(1,Math.floor(contact.maxHp/8)));await finish(retaliation);
 const aegislash=factory.create(681,30),opponent=factory.create(143,50);aegislash.passiveAbility='Stance Change';aegislash.abilities=['Pound'];aegislash.movePp=[35];opponent.abilities=['Growl'];opponent.movePp=[40];opponent.passiveAbility=null;p.equipe.pokemons=[aegislash];
 const stance=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[opponent]},drifts:[],equipped:[]},'wild');await attack();await waitFor(()=>stance.round>=2 && stance.awaiting);
 assert.equal(aegislash.__battle.abilityForm,'Aegislash-Blade');await page.locator('.battle-sprite-player img[src$="/10026.png"]').waitFor();await cleanup.checkpoint();assert(checkpoint);
 const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId).equipe.pokemons[0];assert.equal(saved.__battle.abilityForm,'Aegislash-Blade');
 await page.reload({waitUntil:'networkidle'});await page.locator('.battle-sprite-player img[src$="/10026.png"]').waitFor();await page.screenshot({path:path.join(output,'abilities-mobile-form-reload.png')});
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({realLevitateImmunity:true,realContactRetaliation:true,formAndSprite:true,checkpointAndReload:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'abilities-failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(resolve=>io.close(resolve));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(error=>{console.error(error);process.exitCode=1});

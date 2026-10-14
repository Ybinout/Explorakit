// HTTP, authenticated profiles and friendship actions on a dedicated test database.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs'),path=require('node:path');
if(!/test/i.test(process.env.DB_TEST_NAME || ''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const {dbPool}=require('../server/config/database');
const express=require('express'),{chromium}=require('playwright');
const dist=process.env.RELEASE_DIST_DIR || '/tmp/explorakit-release-dist';
const output=process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-six-browser';fs.mkdirSync(output,{recursive:true});
const app=express();app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('/explorakit/*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let server,browser,runId;const fixtures=[],errors=[];const password='Community-browser-check-2026';
(async()=>{try{
    server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
    for(let i=0;i<4;i++){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'carnet_'+randomUUID().slice(0,12),password,starterId:7})});assert.equal(r.status,201);fixtures.push(await r.json());}
    const [a,b]=fixtures;const account=require('../server/persistence/riftAccountRepository');runId=randomUUID();
    const run={id:runId,players:fixtures.map(f=>f.user),winnerId:a.user.id,finishedAt:Date.now(),explorationMs:1200000};run.report={runId,mode:'rift',players:run.players,matches:[]};
    await account.recordRunStarted(run);await account.recordRunFinished(run);
    const colo=require('../server/persistence/colosseumRepository'),scores=require('../server/game/social/ranks').colosseumThresholds;
    for(const minutes of [30,60]){const r={id:randomUUID(),players:[a.user],durationMinutes:minutes,finishedAt:Date.now()};r.report={runId:r.id,colosseum:{score:scores[minutes===30?4:2],wins:minutes===30?40:20,lastTeam:[{pokemonId:7,name:'Carapuce',level:60,currentHp:100},{pokemonId:133,name:'Évoli',level:58,currentHp:0}]}};await colo.recordRunStarted(r);await colo.recordRunFinished(r);}
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    async function pageFor(f){const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true});await context.addInitScript(session=>localStorage.setItem('explorakit.user',JSON.stringify(session)),{...f.user,token:f.token});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});return p;}
    const pa=await pageFor(a),pb=await pageFor(b);
    const widthOK=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
    for(const [width,height] of [[1365,900],[393,852],[320,568],[844,390]]){
        await pa.setViewportSize({width,height});await pa.goto(base+'/profil/'+a.user.id,{waitUntil:'networkidle'});await pa.locator('[data-trainer-profile]').waitFor();
        assert.match(await pa.locator('.rift-card').innerText(),/1.024 Elo/);assert.equal(await pa.locator('[data-rank-badge].diamond').count(),1);await widthOK(pa);await pa.screenshot({path:path.join(output,`trainer-profile-${width}.png`),fullPage:true});
    }
    await pa.setViewportSize({width:320,height:568});await pa.getByRole('link',{name:'Rechercher',exact:true}).click();await pa.locator('#trainer-search').fill(b.user.username);await pa.getByRole('button',{name:'Rechercher',exact:true}).click();
    await pa.locator(`[data-trainer-id="${b.user.id}"] a`).click();await pa.locator('[data-friend-action="request"]').click();await pa.locator('[data-friend-action="cancel"]').waitFor();
    await pb.goto(base+'/dresseurs?onglet=amis',{waitUntil:'networkidle'});await pb.locator('[data-friend-action="accept"]').click();await pb.locator('[data-friend-action="remove"]').waitFor();
    await pa.getByRole('link',{name:/^Amis/}).click();await pa.locator('[data-friend-action="remove"]').waitFor();await widthOK(pa);await pa.screenshot({path:path.join(output,'trainer-friends-mobile.png'),fullPage:true});
    for(const p of [pa,pb]){const rect=await p.locator('[data-friend-action="remove"]').boundingBox();assert(rect.height>=44);}
    await pa.getByRole('link',{name:'Classements',exact:true}).click();await pa.locator('[data-personal-rank]').waitFor();assert.match(await pa.locator('.ranking-list').innerText(),new RegExp(a.user.username));
    for(const mode of ['30','60','rift']){await pa.locator(`[data-ranking-mode="${mode}"]`).click();await pa.locator('[data-personal-rank]').waitFor();await widthOK(pa);await pa.screenshot({path:path.join(output,`trainer-ranking-${mode}-mobile.png`),fullPage:true});}
    await pa.locator('.ranking-rules summary').click();assert.match(await pa.locator('.ranking-rules').innerText(),/Diamant/);await widthOK(pa);
    await pa.getByRole('link',{name:/^Amis/}).click();await pa.locator('[data-friend-action="remove"]').click();await pa.getByText('Ton carnet attend ses premières rencontres.',{exact:false}).waitFor();
    await pb.reload({waitUntil:'networkidle'});assert.equal(await pb.locator('[data-friend-action="remove"]').count(),0);
    // A shared profile link survives authentication without permitting external redirects.
    const anon=await browser.newPage({viewport:{width:320,height:568}});await anon.goto(base+'/profil/'+a.user.id);await anon.locator('input[autocomplete="username"]').fill(b.user.username);await anon.locator('input[type="password"]').fill(password);await anon.locator('button[type="submit"]').click();await anon.locator('[data-trainer-profile]').waitFor();assert(anon.url().endsWith('/profil/'+a.user.id));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles:true,rankFormats:3,viewports:4,friendRequestAndConsent:true,removalPersisted:true,search:true,authenticatedDeepLink:true,errors,output}));
}finally{
    await browser?.close();if(server)await new Promise(r=>server.close(r));
    if(runId)await dbPool.execute('DELETE FROM rift_runs WHERE id=?',[runId]);
    for(const f of fixtures)await dbPool.execute('DELETE FROM users WHERE id=?',[f.user.id]);await dbPool.end();
}})().catch(e=>{console.error(e);process.exitCode=1;});

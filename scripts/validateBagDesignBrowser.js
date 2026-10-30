// Read-only presentation fixtures on the compiled client, private HTTP server,
// and a disposable owner in explorakit_test. No fixture endpoint in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),catalog=require('../data/game/items.json').items;
const browserName=process.env.PRESENTATION_BROWSER||'chromium';
if(!['chromium','webkit'].includes(browserName))throw Error('Unsupported browser');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-bag-design-dist',out='/tmp/riftmon-bag-design-browser-'+browserName;
fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,id,success=false;const errors=[],checks=[],icons=new Map();
const names={hp_up:'PV Plus (PV)',protein:'Protéine (Attaque)',iron:'Fer (Défense)',calcium:'Calcium (Attaque spéciale)',zinc:'Zinc (Défense spéciale)',carbos:'Carbone (Vitesse)'};
const fixture=catalog.filter(i=>['key','evolution','held'].includes(i.category)||i.fieldUse?.ivReroll||i.fieldUse?.effortReset||i.fieldUse?.effort?.amount>0||i.fieldUse?.abilityReroll||i.fieldUse?.natureReroll).map(i=>({...i,quantity:3}));
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});}
async function checkIcons(){
 const rows=await page.locator('.bag-item-row').evaluateAll(nodes=>nodes.map(n=>{const s=n.querySelector('svg'),b=s.getBBox();return {key:n.dataset.itemKey,name:n.querySelector('.bag-item-name').innerText,svg:s.outerHTML,design:s.dataset.itemDesign,main:s.style.getPropertyValue('--item-main'),bounds:{x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height},marks:s.querySelectorAll('path,rect,circle,ellipse').length};}));
 for(const r of rows){assert(r.marks>0,'Empty icon '+r.key);assert(r.bounds.x>=0&&r.bounds.y>=0&&r.bounds.right<=48&&r.bounds.bottom<=48,'Clipped icon '+JSON.stringify(r));icons.set(r.key,r);}
 return rows;
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'bagdesign_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const user=await response.json();id=user.user.id;
 await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[id]);
 await db.execute("UPDATE users SET map='tour_etage1',x=432,y=528 WHERE id=?",[id]);
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[id]);
 browser=await playwright[browserName].launch({headless:true,...(browserName==='chromium'?{args:['--no-sandbox']}: {})});
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(u=>localStorage.setItem('explorakit.user',JSON.stringify(u)),{...user.user,token:user.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('.bag-panel').waitFor();await page.waitForFunction(()=>!v.bagLoading);
 await page.evaluate(items=>{window.realItems=v.bagItems;v.bagItems=items;},fixture);
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});
  for(const mode of ['light','dark']){
   await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);
   for(const pocket of ['key','evolution','held','training']){
    await page.locator(`[data-bag-pocket="${pocket}"]`).click();
    if(pocket==='training')await page.getByRole('button',{name:'Tout',exact:true}).click();
    const rows=await checkIcons();
    assert(await page.locator('.bag-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    assert(await page.locator('.pack-scroll').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    for(const button of await page.locator('.bag-item-select').all())assert((await button.boundingBox()).height>=44);
    if(pocket==='training')for(const [key,name]of Object.entries(names))assert.equal(rows.find(i=>i.key===key).name.split('\n')[0],name);
    if(width===393||width===1365)await shot(`${pocket}-${width}-${mode}`);
   }
   await page.locator('[data-bag-pocket="training"]').click();
   for(const group of ['vitamins','iv','ev']){
    await page.locator(`[data-training-group="${group}"]`).click();
    if(width===393&&mode==='light')await shot('training-'+group);
   }
   // Collapsing the same row is still possible by tapping its chevron.
   const row=page.locator('.bag-item-row').first();
   if(await row.locator('.bag-item-select').getAttribute('aria-expanded')!=='true')await row.locator('.bag-item-select').click();
   await row.locator('.item-chevron').click();assert.equal(await row.locator('.bag-item-detail').count(),0);
   await row.locator('.item-chevron').click();assert.equal(await row.locator('.bag-item-detail').count(),1);
   checks.push({width,height,mode,noOverflow:true,touchTargets:true,collapse:true});
  }
 }
 assert.equal(new Set(catalog.filter(i=>i.category==='evolution').map(i=>icons.get(i.key).main)).size,10);
 for(const i of catalog.filter(i=>i.category==='key'||i.category==='held'&&!i.key.endsWith('_berry'))){const icon=icons.get(i.key);assert(icon,'Missing '+i.key);assert.notEqual(icon.design,i.category,'Generic icon '+i.key);}
 assert.equal(icons.get('protein').design,'vitamin');assert.equal(icons.get('iv_randomizer_attack').design,'iv-roll');assert.equal(icons.get('ev_reset_attack').design,'ev-reset');
 // Render the actual SVGs in a compact review sheet at their real size and at 48px.
 const review=await context.newPage();
 await review.setViewportSize({width:1100,height:900});
 await review.setContent('<style>body{margin:0;background:#eaf2f8;color:#294453;font:12px Arial;padding:24px}h2{margin:15px 0}section{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.tile{background:#f6f9fc;border:1px solid #cbdce6;border-radius:8px;padding:10px;display:flex;gap:8px;align-items:center}.tile svg{flex:none;width:48px;height:48px}.tile svg.mini{width:28px;height:28px}.tile span{font-size:11px;overflow-wrap:anywhere}</style>');
 for(const [label,keys]of [['Objets clés',catalog.filter(i=>i.category==='key').map(i=>i.key)],['Pierres',catalog.filter(i=>i.category==='evolution').map(i=>i.key)],['Objets tenus',catalog.filter(i=>i.category==='held'&&!i.key.endsWith('_berry')).map(i=>i.key)],['Entraînement',fixture.filter(i=>i.fieldUse?.ivReroll||i.fieldUse?.effortReset||i.fieldUse?.effort?.amount>0||i.fieldUse?.natureReroll||i.fieldUse?.abilityReroll).map(i=>i.key)]]){
  await review.evaluate(({label,rows})=>{const h=document.createElement('h2');h.textContent=label;document.body.append(h);const section=document.createElement('section');for(const row of rows){const tile=document.createElement('div');tile.className='tile';tile.innerHTML=row.svg+row.svg.replace('bag-object-icon','mini');const name=document.createElement('span');name.textContent=row.name;tile.append(name);section.append(tile);}document.body.append(section);},{label,rows:keys.map(k=>icons.get(k))});
 }
 await review.screenshot({path:path.join(out,'icon-review.png'),fullPage:true});await review.close();
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.updatePreferences({...v.preferences,themeMode:'light',language:'en'}));
 await page.locator('[data-training-group="vitamins"]').click();assert.match(await page.locator('[data-item-key="calcium"] .bag-item-name').innerText(),/\(Sp\. Attack\)/);
 await page.locator('.bag-panel .panel-close').click();
 await page.evaluate(()=>{v.bagItems=window.realItems;v.updatePreferences({...v.preferences,language:'fr'});v.openShop();});
 await page.locator('[data-shop-category="training"]').click();
 for(const [key,name]of Object.entries(names)){assert.equal(await page.locator(`[data-shop-item="${key}"] .shop-item-title`).innerText(),name);assert.equal(await page.locator(`[data-shop-item="${key}"] [data-item-design]`).getAttribute('data-item-design'),'vitamin');}
 await page.getByRole('searchbox').fill('Défense');assert(await page.locator('[data-shop-item="iron"]').isVisible());
 await shot('shop-stat-search-393');await page.locator('.shop-close').click();
 assert.deepEqual(errors,[]);success=true;
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,browserName,checks,reviewedItems:icons.size,stones:10,keyItems:9,trainingSilhouettes:true,vitaminStatNames:true,shopShared:true,english:true,errors},null,2));
}catch(e){console.error(e.stack);await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();io.close();await new Promise(r=>server.close(r));await new Promise(r=>setTimeout(r,200));if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();console.log(JSON.stringify({success,errors,deletedTestUser:true}));}})();

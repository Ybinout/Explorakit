// Real compiled client and authenticated Socket.IO; disposable test account only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const dist=process.env.RELEASE_DIST_DIR,engine=process.env.PRESENTATION_BROWSER||'chromium';
assert(fs.existsSync(dist+'/index.html'));
const out='/tmp/riftmon-berry-master-'+engine;fs.mkdirSync(out,{recursive:true});
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository');
const master=require('../server/game/berries/master'),rules=require('../server/game/magicIsland/rules');
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,user,success=false;const errors=[],checks=[],shots=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}return false;});}
async function speak(){await page.evaluate(()=>v.espace());await page.waitForFunction(()=>v.endSentences==='magic_berry_master'&&v.textImageSequence.length>0);}
async function finish(){for(let i=0;i<30&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(50);}await page.waitForFunction(()=>!v.textImageSequence.length);await page.waitForTimeout(100);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 user=await users.createUserWithStarter('BerryMasterUI_'+randomUUID().slice(0,8),randomUUID());
 await db.execute("UPDATE users SET map='ile2_04',x=?,y=? WHERE id=?",[9*32+16,10*32+16,user.id]);
 for(const[k,value]of Object.entries({adventure_opening:'complete',early_game_tutorial:JSON.stringify({version:1,phase:'complete',metWayne:true})}))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,k,value]);
 await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
 browser=await require('playwright')[engine].launch({headless:true});
 const context=await browser.newContext({viewport:{width:1365,height:900},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(auth=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(auth));},{...user,token:require('../server/config/auth').signAccessToken(user)});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.mode-card.adventure').click();await ready();
 await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 assert(await page.evaluate(()=>v.pnjs.some(a=>a.name==='magic_berry_master'&&a.spriteFrame.index===17)));
 await page.screenshot({path:path.join(out,'world.png')});shots.push('world');
 await speak();
 const text=await page.evaluate(()=>v.textImageSequence.map(p=>p.text).join(' '));assert(text.includes('recette du jour'));assert(text.includes('15 minutes'));assert(text.includes('10 Éclats'));
 assert(await page.evaluate(()=>v.textImageSequence.every(p=>p.image)),'Illustrated portrait resolves');
 const [rows]=await db.execute('SELECT * FROM berry_recipe_discoveries WHERE user_id=?',[user.id]);assert.equal(rows.length,1);assert.equal(rows[0].attempts,0);checks.push('real action teaches and persists native recipe with illustrated dialogue');
 // Exercise the actual component pagination for every paragraph on four sizes.
 for(const[w,h]of[[1365,900],[393,852],[320,568],[844,390]]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(180);
  await page.screenshot({path:path.join(out,'dialogue-'+w+'.png')});shots.push('dialogue-'+w);
  const b=await page.locator('.dialogue-layer .text-with-image').evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:document.documentElement.scrollWidth};});
  assert(b.left>=-1&&b.right<=w+1&&b.top>=-1&&b.bottom<=h+1&&b.scroll<=w+1,JSON.stringify(b));
 }
 await finish();checks.push('dialogue fits desktop, mobile portrait and landscape and closes normally');
 await speak();assert((await page.evaluate(()=>v.textImageSequence.map(p=>p.text).join(' '))).includes('déjà confié'));
 await finish();assert.equal((await db.execute('SELECT COUNT(*) n FROM berry_recipe_discoveries WHERE user_id=?',[user.id]))[0][0].n,1);checks.push('repeated action does not duplicate daily reward');
 await page.reload();await ready();await speak();assert((await page.evaluate(()=>v.textImageSequence.map(p=>p.text).join(' '))).includes('déjà confié'));await finish();checks.push('reconnect preserves daily recipe and availability');
 const c=require('../server/realtime/housing').getHousingManager(io).contexts.get(user.id);assert(c);
 await c.travel({map:'ile2_04',x:6*32+16,y:7*32+16});await ready();await page.evaluate(()=>v.socket.emit('Space'));await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>v.textImageSequence.length),0);assert.equal((await db.execute('SELECT COUNT(*) n FROM berry_recipe_discoveries WHERE user_id=?',[user.id]))[0][0].n,1);checks.push('action far from master has no effect');
 // Server rejects walking onto either of the NPC body cells, but both sides of
 // the road remain connected (also covered by the authored-grid unit test).
 await c.travel({map:'ile2_04',x:9*32+16,y:10*32+16});await ready();await page.evaluate(()=>v.socket.emit('playerAction','move_d'));await page.waitForTimeout(350);
 assert.equal(Math.floor(c.getPlayer().x/32),9);await page.evaluate(()=>v.socket.emit('playerAction','move_q'));await page.waitForTimeout(350);
 assert.equal(Math.floor(c.getPlayer().x/32),8);checks.push('native NPC body collision and free passage beside it');
 assert.equal(errors.length,0,JSON.stringify(errors));success=true;console.log(JSON.stringify({success,engine,checks,shots}));
}catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
finally{await browser?.close();io.close();await new Promise(r=>server.close(r));if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,checks,shots,errors},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});

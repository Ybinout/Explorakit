const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(process.env.DB_NAME,'explorakit_test');assert.equal(process.env.RUN_MYSQL_TESTS,'1');
const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository');
const repo=require('../server/persistence/darkBattleRepository'),dark=require('../server/persistence/darkContinentRepository'),talents=require('../server/persistence/talentTreeRepository'),factory=require('../server/game/drift/pokemonFactory');
const {DarkBattleController}=require('../server/game/battle/darkBattleController'),magic=require('../server/game/magicIsland/rules'),codec=require('../server/game/drift/checkpointCodec');
let user;const ticket=p=>({requestId:randomUUID(),...p}),wallet=async()=>Number((await db.execute('SELECT money FROM users WHERE id=?',[user.id]))[0][0].money);
function mon(id=143,level=100,moves=['Splash']){const p=factory.create(id,level,true);p.passiveAbility=null;p.heldItem=null;p.abilities=[];p.movePp=[];for(const m of moves)p.addAbility(m);return p;}
test.before(async()=>{user=await users.createUserWithStarter('Postgame_'+randomUUID().slice(0,8),randomUUID());});
test.beforeEach(async()=>{await db.execute('DELETE FROM dark_battle_checkpoints WHERE user_id=?',[user.id]);await db.execute('DELETE FROM user_items WHERE user_id=?',[user.id]);await db.execute('DELETE FROM player_story_flags WHERE user_id=?',[user.id]);await db.execute('UPDATE users SET money=100000000 WHERE id=?',[user.id]);});
test.after(async()=>{if(user){talents.invalidate(user.id);await db.execute('DELETE FROM users WHERE id=?',[user.id]);}await db.end();});
async function speed(owned,active){if(owned)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[user.id,magic.SPEED_ITEM]);await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,magic.SPEED_FLAG,String(active)]);}
async function fixture(map='jungle1',persist=repo){const p=mon();p.status='burn';p.currentHp=23;await teams.editEquipe(user.id,{pokemons:[p]});const player={id:'test',userId:user.id,username:user.username,currentmap:map,x:416,y:416,speedModuleActive:true,equipe:await teams.loadEquipe(user.id)},events=[];const c=new DarkBattleController({userId:user.id,getPlayer:()=>player,persist,emit:(e,d)=>events.push([e,d]),now:()=>10000,random:()=>.5});await c.start(mon(3),null);return{p,player,events,c};}
for(const [owned,active]of[[false,false],[false,true],[true,false],[true,true]])test('DC escape requires server ownership AND activation, regardless of client/world hints: '+owned+'/'+active,async()=>{
 await speed(owned,active);const r=await fixture(),allowed=owned&&active,before=await wallet();
 assert.equal(r.c.run.battle.rules.fleeAllowed,allowed);assert.equal(r.c.run.battle.state.escapeForbidden,true,'Teleport/forced switching stay restricted');
 const result=await r.c.action({turnId:r.c.run.battle.token,action:'flee',fleeAllowed:true,speedModuleActive:true});assert.equal(result,allowed);
 assert.equal(r.c.active,!allowed);assert.equal(await wallet(),before);const saved=await teams.loadEquipe(user.id);assert.equal(saved.pokemons[0].currentHp,23);assert.equal(saved.pokemons[0].status,'burn');
 if(allowed){assert.equal((await repo.load(user.id)).run,null);assert(r.events.some(([e])=>e==='endbattle'));}
 await r.c.stop();
});
for(const map of['jungle1','DC2_44'])test('old saved '+map+' encounters refresh module permission on reconnect, keep conditions and reject revoked proof',async()=>{
 await speed(true,false);const r=await fixture(map),token=r.c.run.battle.token;await r.c.stop();await speed(false,true);
 const events=[],c=new DarkBattleController({userId:user.id,getPlayer:()=>r.player,persist:repo,emit:(e,d)=>events.push([e,d]),now:()=>10000,random:()=>.5});await c.load();
 assert(events.some(([e,d])=>e==='battletrigger'&&d.fleeAllowed===true));assert.equal(c.run.battle.active(0).status,'burn');assert.equal(c.run.battle.active(0).currentHp,23);
 await db.execute("UPDATE player_story_flags SET flag_value='false' WHERE user_id=? AND flag_key=?",[user.id,magic.SPEED_FLAG]);assert.equal(await c.action({turnId:token,action:'flee'}),false);assert(c.active);
 await db.execute("UPDATE player_story_flags SET flag_value='true' WHERE user_id=? AND flag_key=?",[user.id,magic.SPEED_FLAG]);assert(await c.action({turnId:c.run.battle.token,action:'flee'}));assert(!c.active);await c.stop();
});
for(const map of['jungle1','DC2_44'])test('guide '+map+' heals for5,000 once, refuses remote/stale requests and never pays for a fully healed party',async()=>{
 const p=mon();p.currentHp=1;p.status='poison';p.movePp[0]=0;await teams.editEquipe(user.id,{pokemons:[p]});await db.execute('UPDATE users SET money=5000 WHERE id=?',[user.id]);
 const player={userId:user.id,currentmap:map,x:map==='jungle1'?208:432,y:map==='jungle1'?336:432,equipe:await teams.loadEquipe(user.id)},commands={},state={money:5000};
 require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket:{emit(){}},account:{on:(n,f)=>commands[n]=f},userId:user.id,getPlayer:()=>player,getState:()=>state,setState:v=>Object.assign(state,v),refreshActors(){},canUse:()=>true,travel(){},closeFishing(){}});
 const send=async price=>{let result;await commands['dark:heal']({price},r=>result=r);return result;};
 assert(!(await send(10000)).success);assert.equal(await wallet(),5000);const x=player.x;player.x=16;assert(!(await send(5000)).success);player.x=x;
 const result=await send(5000);assert(result.success);assert.equal(result.charged,5000);assert.equal(await wallet(),0);
 const saved=await teams.loadEquipe(user.id);assert.equal(saved.pokemons[0].currentHp,saved.pokemons[0].maxHp);assert.equal(saved.pokemons[0].status,'normal');assert(saved.pokemons[0].movePp[0]>0);
 const repeat=await send(5000);assert(repeat.success);assert.equal(repeat.charged,0);assert.equal(await wallet(),0);
});
test('talent module charges exactly15 of each type and10M once, with rollback for missing plates',async()=>{
 const catalog=require('../server/game/talents/catalog');await db.execute('DELETE FROM player_talent_trees WHERE user_id=?',[user.id]);
 for(const [key,n]of Object.entries(catalog.moduleCost))if(key!=='money')await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?)',[user.id,key,key==='dark_plate_fire'?14:n]);
 const before=await wallet();await assert.rejects(talents.purchase(user.id,ticket({})),/insuffisante/);assert.equal(await wallet(),before);
 await db.execute("UPDATE user_items SET quantity=15 WHERE user_id=? AND item_key='dark_plate_fire'",[user.id]);const payload=ticket({});await Promise.all([talents.purchase(user.id,payload),talents.purchase(user.id,payload)]);
 assert.equal(before-await wallet(),10000000);const [rows]=await db.execute("SELECT item_key,quantity FROM user_items WHERE user_id=? AND item_key LIKE 'dark_plate_%'",[user.id]);assert.equal(rows.length,18);assert(rows.every(r=>r.quantity===0));
 assert.equal((await talents.state(user.id)).available,124);assert.deepEqual(require('../data/game/corruption_recipes.json').families.move.plates,3);
});
test('three-plate native battle reward is saved once and stale replay cannot duplicate it',async()=>{
 const p=mon(94,150,['Shadow Ball']);await teams.editEquipe(user.id,{pokemons:[p]});const player={id:'win',userId:user.id,username:user.username,currentmap:'jungle1',x:208,y:336,equipe:await teams.loadEquipe(user.id)};
 const draws=()=>{const values=[.999,.999,.999,0,0,.999,.999,.999];return()=>values.length?values.shift():.999;};
 const c=new DarkBattleController({userId:user.id,getPlayer:()=>player,persist:{...repo,save:(id,r,v,o)=>repo.save(id,r,v,{...o,random:draws()})},emit(){},now:()=>10000,random:()=>.5});const enemy=mon(3,5);enemy.currentHp=1;await c.start(enemy);const saved=codec.decode(codec.encode(await repo.load(user.id)));
 assert(await c.action({turnId:c.run.battle.token,action:'attack',number:0}));assert(!c.active);
 const stock=async()=>Number((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='dark_plate_grass'",[user.id]))[0][0]?.quantity||0);assert.equal(await stock(),3);
 await assert.rejects(repo.save(user.id,saved.run,saved.version),/changé/);assert.equal(await stock(),3);await c.stop();
});

const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled){if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test DB required');process.env.DB_NAME=process.env.DB_TEST_NAME;}
const {dbPool}=require('../server/config/database'),repo=require('../server/persistence/experienceModuleRepository'),progress=require('../server/persistence/progressionRepository');
const ids=[];async function user(){const[r]=await dbPool.execute("INSERT INTO users(username,password_hash,map,x,y,sprite) VALUES(?,'fixture','start',48,240,'sprite.png')",['xp_module_'+randomUUID()]);ids.push(r.insertId);return r.insertId;}
async function flag(id,key,value='true'){await dbPool.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);}
async function count(id){const[[r]]=await dbPool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='experience_module'",[id]);return r?.quantity||0;}
test.after(async()=>{if(enabled){for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}});
test('7p victory grants one inactive key atomically; repeats and reconciliation preserve the active switch',{skip:!enabled},async()=>{
 const id=await user();await flag(id,'wanda_defeated');assert.equal(await count(id),0);assert.equal((await progress.loadProgressState(id)).experienceModule.owned,false);
 const result=await progress.completeNpcBattle(id,'champion_7p');assert(result.granted);assert.deepEqual(result.progress.experienceModule,{owned:true,active:false,levelBonus:0});assert.equal(await count(id),1);
 assert.deepEqual(await repo.setActive(id,true),{owned:true,active:true,levelBonus:15});assert.equal((await progress.completeNpcBattle(id,'champion_7p')).granted,false);await Promise.all([repo.reconcile(id),repo.reconcile(id)]);assert.equal(await count(id),1);assert.equal((await repo.loadState(id)).active,true);
 const item=(await require('../server/persistence/itemRepository').loadUserItems(id)).find(i=>i.key==='experience_module');assert(item.experienceModule&&item.unique&&item.active);assert.equal(item.sellPrice,0);
 assert.deepEqual(await repo.setActive(id,false),{owned:true,active:false,levelBonus:0});assert.equal((await progress.loadProgressState(id)).experienceModule.active,false);
});
test('legacy flag, badge or recorded battle qualify independently; unproven flags never grant a module',{skip:!enabled},async()=>{
 const [a,b,c,d]=await Promise.all([user(),user(),user(),user()]);await flag(a,'sevenp_defeated');await dbPool.execute("INSERT INTO player_badges(user_id,badge_key) VALUES(?,'summit_badge')",[b]);await dbPool.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json) VALUES(?,'story_champion_7p','champion_7p','{}')",[c]);await flag(d,'sevenp_defeated','false');await flag(d,'experience_module_active');
 for(const id of[a,b,c]){await Promise.all([repo.reconcile(id),repo.reconcile(id)]);assert.equal(await count(id),1);assert.equal((await repo.loadState(id)).active,false);assert.equal((await progress.loadProgressState(id)).experienceModule.owned,true);}
 assert.equal(await repo.reconcile(d),false);assert.equal(await count(d),0);assert.equal((await repo.loadState(d)).active,false);await assert.rejects(repo.setActive(d,true),/possèdes/);
});
test('switch is personal, explicit and durable, consumes nothing and does not alter teammates',{skip:!enabled},async()=>{
 const id=await user(),other=await user();await flag(id,'sevenp_defeated');await repo.reconcile(id);const factory=require('../server/game/drift/pokemonFactory'),teams=require('../server/persistence/teamRepository');await teams.editEquipe(id,{pokemons:[factory.create(7,5,true)]});const before=JSON.stringify(await teams.loadEquipe(id));
 for(const active of[true,true,false,false,true]){const state=await repo.setActive(id,active);assert.equal(state.active,active);assert.equal(await count(id),1);}
 assert.equal((await repo.loadState(other)).active,false);assert.equal((await progress.loadProgressState(id)).experienceModule.active,true);assert.equal(JSON.stringify(await teams.loadEquipe(id)),before);await assert.rejects(repo.setActive(id,'true'),/Choisis/);assert.equal((await repo.loadState(id)).active,true);
});

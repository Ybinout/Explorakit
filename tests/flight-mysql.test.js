const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
if(enabled){if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');process.env.DB_NAME=process.env.DB_TEST_NAME;}
const{dbPool}=require('../server/config/database');
const f=require('../server/persistence/flightRepository'),progress=require('../server/persistence/progressionRepository');
const ids=[];
async function user(){const[r]=await dbPool.execute("INSERT INTO users(username,password_hash,map,x,y,sprite) VALUES(?,'fixture','start',48,240,'sprite.png')",['flight_'+randomUUID()]);ids.push(r.insertId);return r.insertId;}
async function flag(id,key){await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[id,key]);}
async function quantity(id){const[rows]=await dbPool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='fly_module'",[id]);return rows[0]?.quantity||0;}
test.after(async()=>{if(enabled){for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}});
test('legacy Wanda victories grant exactly one module and reconstruct only proven visits', {skip:!enabled},async()=>{
 const a=await user(),b=await user(),c=await user(),d=await user();await flag(a,'wanda_defeated');
 await dbPool.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json) VALUES(?,'story_champion_wanda','champion_wanda','{}')",[b]);
 await dbPool.execute("INSERT INTO player_badges(user_id,badge_key) VALUES(?,'tide_badge')",[d]);
 await f.reconcileFlightProgress(d);assert.equal(await quantity(d),1);
 await Promise.all([f.reconcileFlightProgress(a),f.reconcileFlightProgress(a),f.reconcileFlightProgress(b),f.reconcileFlightProgress(c)]);
 assert.equal(await quantity(a),1);assert.equal(await quantity(b),1);assert.equal(await quantity(c),0);
 const s=await f.loadFlightState(a);assert(s.unlocked);assert(s.visited.includes('ville4'));assert(!s.visited.includes('ville5'));assert(!s.visited.includes('ville_commerciale'));
 await f.recordTownVisit(a,'tour_etage1');await f.recordTownVisit(a,'tour_etage1');assert((await f.loadFlightState(a)).visited.includes('ville_commerciale'));assert(!(await f.loadFlightState(b)).visited.includes('ville_commerciale'));
 await f.recordTownVisit(a,'centre',{map:'ville3',x:752,y:240});assert((await f.loadFlightState(a)).visited.includes('ville3'));
});
test('new Raphael victory grants module atomically; reconnect and repeated wins never duplicate it',{skip:!enabled},async()=>{
 const id=await user();await flag(id,'hoze_defeated');assert(!(await progress.loadProgressState(id)).flight.unlocked);
 const r=await progress.completeNpcBattle(id,'champion_raphael');assert(r.granted);assert(r.progress.flight.unlocked);assert.equal(await quantity(id),1);
 const again=await progress.completeNpcBattle(id,'champion_raphael');assert(!again.granted);await progress.loadProgressState(id);assert.equal(await quantity(id),1);
});

test('legacy Raphael badge, battle or flag qualifies independently; earlier badges never grant flight',{skip:!enabled},async()=>{
 for(const source of ['flag','battle','badge']){const id=await user();if(source==='flag')await flag(id,'raphael_defeated');if(source==='battle')await dbPool.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json) VALUES(?,'story_champion_raphael','champion_raphael','{}')",[id]);if(source==='badge')await dbPool.execute("INSERT INTO player_badges(user_id,badge_key) VALUES(?,'bloom_badge')",[id]);await Promise.all([f.reconcileFlightProgress(id),f.reconcileFlightProgress(id)]);assert.equal(await quantity(id),1);assert((await f.loadFlightState(id)).visited.includes('gen_ville5'));}
 const id=await user();await flag(id,'hoze_defeated');await f.reconcileFlightProgress(id);assert.equal(await quantity(id),0);
});

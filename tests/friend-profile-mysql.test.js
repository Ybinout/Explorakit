const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled){assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME=process.env.DB_TEST_NAME;}
const {dbPool:db}=require('../server/config/database'),trainers=require('../server/persistence/trainerRepository'),details=require('../server/persistence/friendProfileRepository').details;
const ids=[];async function user(){const[r]=await db.execute("INSERT INTO users(username,password_hash,map,x,y,sprite) VALUES(?,'fixture','start',48,240,'sprite.png')",['friendcard_'+randomUUID()]);ids.push(r.insertId);return r.insertId;}
async function friends(a,b){await trainers.friendAction(a,b,'request');await trainers.friendAction(b,a,'accept');}
test.after(async()=>{if(enabled){for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}});
test('friend collection requires an accepted friendship for both sections; no caller flags/locations or future badges leak',{skip:!enabled},async()=>{
 const a=await user(),b=await user(),c=await user();await trainers.friendAction(a,b,'request');for(const view of ['badges','rankings']){await assert.rejects(details(a,b,view),e=>e.statusCode===403);await assert.rejects(details(c,b,view),e=>e.statusCode===403);}
 await trainers.friendAction(b,a,'accept');await db.execute("INSERT INTO player_badges(user_id,badge_key) VALUES(?,'lake_badge')",[b]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'private_secret','true')",[b]);
 const result=await details(a,b,'badges');assert.deepEqual(Object.keys(result).sort(),['badges','targetId','view']);assert.equal(result.badges.length,1);assert.equal(result.badges[0].key,'lake_badge');assert(result.badges[0].name);assert(!JSON.stringify(result).includes('private_secret'));
 await assert.rejects(details(a,b,'flags'),e=>e.statusCode===400);await assert.rejects(details(a,'1 OR 1','badges'));await trainers.friendAction(a,b,'remove');await assert.rejects(details(a,b,'badges'),e=>e.statusCode===403);
});
test('friend standings match real global rank ordering for all three house modes and tower; not a filtered friend-only rank',{skip:!enabled},async()=>{
 const a=await user(),b=await user(),c=await user();await friends(a,b);await friends(a,c);
 for(const mode of ['1v1','2v1','2v2']){await db.execute('INSERT INTO whitepeak_mode_scores(mode,user_id,wins,losses,draws,points) VALUES(?,?,3,1,1,3456789)',[mode,b]);await db.execute('INSERT INTO whitepeak_mode_scores(mode,user_id,wins,losses,points) VALUES(?,?,4,0,3456789)',[mode,c]);}
 await db.execute('INSERT INTO super_tournament_profiles(user_id,best_score,best_rooms) VALUES(?,7654321,32),(?,7654321,40)',[b,c]);
 const r=await details(a,b,'rankings'),ranking=require('../server/persistence/whitepeakRankingRepository');for(const mode of r.house){const official=(await ranking.page({mode:mode.mode,userId:b})).own;assert.equal(mode.position,official.rank);assert.equal(mode.position,2);assert.equal(mode.score,3456789);assert.equal(mode.wins,3);assert.equal(mode.losses,1);assert.equal(mode.draws,1);}
 assert.deepEqual(r.tower,{position:2,score:7654321,rooms:32});const zero=await user();await friends(a,zero);const empty=await details(a,zero,'rankings');assert(empty.house.every(r=>r.position===null&&r.score===0));assert.deepEqual(empty.tower,{position:null,score:0,rooms:0});
});

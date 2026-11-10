const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,pc,raids,fav,factory;const ids=[],runs=[];
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');raids=require('../server/persistence/raidRepository');fav=require('../server/persistence/bagFavoritesRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{if(!db)return;for(const id of runs)await db.execute('DELETE FROM corruption_raids WHERE id=?',[id]);for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();});
async function owner(){const u=await users.createUserWithStarter('Global_'+randomUUID().slice(0,10),randomUUID());ids.push(u.id);return u;}
const wallet=async id=>Number((await db.execute('SELECT money FROM users WHERE id=?',[id]))[0][0].money);
test('SQL favorite migration exceeds old255 limit, supports long berry keys, reload/removal/concurrency and account isolation',{skip:!enabled},async()=>{
 const u=await owner(),other=await owner(),keys=require('../data/game/items.json').items.filter(i=>i.mutationBerry).slice(0,18).map(i=>i.key);assert(JSON.stringify(keys).length>255);
 for(const key of keys)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[u.id,key]);
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'bag_favorites',?)",[u.id,JSON.stringify(keys.slice(0,3))]);
 assert.deepEqual((await fav.load(u.id)).keys,keys.slice(0,3));
 await Promise.all(keys.slice(3).map(k=>fav.set(u.id,k,true)));assert.deepEqual(new Set((await fav.load(u.id)).keys),new Set(keys));
 const [flags]=await db.execute("SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'bag%'",[u.id]);assert.equal(flags.length,keys.length);assert(flags.every(f=>f.flag_key.length<=100&&f.flag_value.length<=180));assert(!flags.some(f=>f.flag_key==='bag_favorites'));
 await fav.set(u.id,keys[3],false);assert(!(await fav.load(u.id)).keys.includes(keys[3]));await fav.set(u.id,keys[3],true);assert.equal((await fav.load(u.id)).keys.length,keys.length);assert.deepEqual((await fav.load(other.id)).keys,[]);await assert.rejects(fav.set(other.id,keys[0],true),/plus dans ton sac/);
});
test('SQL wild held items can drop repeatedly despite old discovery receipts and already held copies',{skip:!enabled},async()=>{
 const u=await owner(),p=await teams.loadEquipe(u.id);p.pokemons[0].heldItem='leftovers';await teams.editEquipe(u.id,p);await db.execute("INSERT INTO user_item_discoveries(user_id,item_key) VALUES(?,'leftovers')",[u.id]);
 const loot=require('../server/persistence/wildLootRepository'),random=()=>{let n=0;return()=>++n===1?.85:0;};
 await Promise.all(Array.from({length:3},()=>loot.grantBattleLoot(u.id,true,[],random())));const [[row]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='leftovers'",[u.id]);assert.equal(row.quantity,3);assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,'leftovers');
});
async function run(map='safari1',bossId=9,level=100){const u=await owner(),m=await raids.member(u.id,u.username),boss=factory.create(bossId,level,true);m.selected=m.team.pokemons.map(p=>p.uuid);const r={id:randomUUID(),version:0,phase:'won',won:true,rift:{map,difficulty:level===1000?'dc2-final':'easy',bossSpecies:bossId,level,fixed:level===1000,anchor:level===1000?'dark2:final':undefined},members:[m],combat:{boss,models:m.team.pokemons.map(pokemon=>({ownerId:u.id,pokemon,initialHeld:pokemon.heldItem}))}};runs.push(r.id);return r;}
const save=(r,random=()=>0)=>raids.save(r,{expected:r.version,settle:true,random}).then(v=>r.version=v);
test('SQL raid Pokémon+XP+items+wallet commit once; retry/concurrent claims never reroll or duplicate and final legendary level1000 is preserved',{skip:!enabled},async()=>{
 for(const [map,id,level]of [['safari1',9,100],['jungle9',143,300],['DC2_04',150,1000]]){
  const r=await run(map,id,level),u=r.members[0],before=await wallet(u.id),codec=require('../server/game/drift/checkpointCodec'),copy=codec.decode(codec.encode(r));
  const claims=await Promise.allSettled([save(r),save(copy)]);assert.equal(claims.filter(p=>p.status==='fulfilled').length,1);if(!r.version)Object.assign(r,copy);
  const reward=r.members[0].reward.pokemon;assert(reward&&reward.shiny);assert.equal(reward.destination,'pc');const s=await pc.loadEntries(u.id);assert.equal(s.length,1);const p=s[0].pokemon;assert.equal(p.uuid,reward.uuid);assert.equal(p.data.id,id);assert.equal(p.level,level);assert.equal(p.k,4);assert.equal(p.corruption,null);assert(Object.values(p.ev).every(v=>v===0));assert(Object.values(p.iv).every(v=>v===0));assert(p.shiny);
  const after=await wallet(u.id),xp=(await teams.loadEquipe(u.id)).pokemons[0].experience;assert(after>before);await save(r,()=>{throw Error('No repeated RNG');});assert.equal(await wallet(u.id),after);assert.equal((await pc.loadEntries(u.id)).length,1);assert.equal((await teams.loadEquipe(u.id)).pokemons[0].experience,xp);assert.equal(r.members[0].reward.pokemon.uuid,p.uuid);
 }
});
test('SQL failure after PC insertion rolls back reward, caught registration, XP, wallet and receipt; clean retry succeeds',{skip:!enabled},async()=>{
 const r=await run(),id=r.members[0].id,before=await wallet(id),team=JSON.stringify(await teams.loadEquipe(id)),original=db.getConnection.bind(db);
 db.getConnection=async()=>{const c=await original(),exec=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...args)=>{const value=await exec(sql,...args);if(sql.startsWith('INSERT INTO corruption_raid_rewards'))throw Error('injected_reward_failure');return value;};c.release=()=>{c.execute=exec;c.release=release;release();};return c;};
 try{await assert.rejects(save(r),/injected_reward_failure/);}finally{db.getConnection=original;}
 assert.equal(await wallet(id),before);assert.equal((await pc.loadEntries(id)).length,0);assert.equal(JSON.stringify(await teams.loadEquipe(id)),team);assert.equal((await db.execute('SELECT id FROM corruption_raids WHERE id=?',[r.id]))[0].length,0);
 // Repository callers restore their checkpoint on error; model that same retry.
 r.members[0].team=await teams.loadEquipe(id);r.combat.models=r.members[0].team.pokemons.map(pokemon=>({ownerId:id,pokemon,initialHeld:pokemon.heldItem}));await save(r);assert.equal((await pc.loadEntries(id)).length,1);
});
test('SQL a failed30% roll and training grant no Pokémon',{skip:!enabled},async()=>{
 for(const training of [false,true]){const r=await run();r.rift.training=training;await save(r,()=>.99999);assert.equal((await pc.loadEntries(r.members[0].id)).length,0);assert.equal(r.members[0].reward?.pokemon,undefined);}
});
test('SQL real Tour controller: Arena Trap rejection delivers its prompt without writing/advancing and an attack works after cold reconnect',{skip:!enabled},async()=>{
 const u=await owner(),team={pokemons:[25,9].map(id=>{const p=factory.create(id,100,true);p.abilities=['Tackle'];p.movePp=[35];p.passiveAbility=null;return p;})};await teams.editEquipe(u.id,team);
 let now=10000;const real={id:'tour-'+u.id,username:u.username,equipe:team},events=[],Controller=require('../server/game/superTournament/controller').TournamentController,make=()=>new Controller({userId:u.id,now:()=>now,getPlayer:()=>real,emit:(e,d)=>events.push({e,d}),travel:async()=>{}}),c=make();await c.load();await c.register(team);await c.next();await c.atomic(()=>{c.startBattle();const b=c.run.battle,dug=factory.create(51,100,true);dug.passiveAbility='Arena Trap';dug.abilities=['Splash'];dug.movePp=[40];b.b.equipe.pokemons=[dug];b.enter(1);b.pending.set(b.b,{action:'attack',number:0});});
 const b=c.run.battle,token=b.token,version=c.version,deadline=b.deadline,pp=b.active(0).movePp[0],choice={...b.pending.get(b.b)};events.length=0;
 assert.equal(await c.action({action:'change',number:1,turnId:token}),false);assert.equal(c.version,version);assert.equal(b.token,token);assert.equal(b.deadline,deadline);assert.deepEqual(b.pending.get(b.b),choice);assert.equal(events.at(-1).e,'requestAction');assert.equal(events.at(-1).d.turnId,token);assert.match(events.at(-1).d.message,/piégé/);
 const resumed=make();await resumed.load();assert.equal(resumed.run.battle.token,token);assert(await resumed.action({action:'attack',number:0,turnId:token}));assert.equal(resumed.run.battle.active(0).movePp[0],pp-1);now+=3000;await resumed.tick();assert.notEqual(resumed.run.battle.token,token);await resumed.abandon();
});

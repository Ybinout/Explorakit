const test=require('node:test'),assert=require('node:assert/strict');
const gates=require('../server/game/world/storyGates'),terrain=require('../server/game/world/mapRepository');
const catalog=require('../data/game/progression.json'),items=require('../data/game/items.json').items;
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory');
test('Gwenn has five fully prepared Pokémon just above Wanda, valid items and isolated battle teams',()=>{
 const config=require('../data/game/pnj_teams.json').pnjs.find(t=>t.name==='gwenn_rochebrume');
 assert.deepEqual(config.team.map(p=>p.pokemonId),[428,430,248,227,94]);assert.deepEqual(config.team.map(p=>p.k),[3,3,3,3,4]);assert.deepEqual(config.team.map(p=>p.level),[55,55,56,56,57]);
 const t=getPnjTeam(config.name),other=getPnjTeam(config.name);assert.equal(t.__trainerPlan.name,'Gwenn');
 for(const [i,p]of t.pokemons.entries()){assert.equal(p.level,config.team[i].level);assert.equal(p.currentHp,p.maxHp);assert.equal(p.abilities.length,4);assert(items.some(x=>x.key===p.heldItem));assert.equal(Object.values(config.team[i].ev).reduce((a,b)=>a+b,0),508);assert.notEqual(p.uuid,other.pokemons[i].uuid);}
 assert(Object.values(config.team[4].givenIv).every(n=>n===31));assert(config.team.slice(0,4).every(p=>Object.values(p.givenIv).some(n=>n<31)));
});
test('orange house has safe entrance/exit and gate actor disappears only after the personal victory',()=>{
 const door=terrain.getNextMap('ville4',22,16);assert.equal(door.nextMap,'ville4_maison2');assert.equal(door.requiresStoryFlag,'gwenn_house_key_received');
 const coll=terrain.loadCollisionData('ville4_maison2');assert.equal(coll[15][13],0);assert.equal(coll[16][13],0);assert(coll[0][0]);assert(coll[8][5]);assert.equal(terrain.getNextMap('ville4_maison2',13,16).nextMap,'ville4');assert.equal(terrain.getNextMap('cave_rochebrume1',13,19).nextY,176,'return below the father, never on his tile');
 const g=gates.gates.find(g=>g.id==='gwenn_rochebrume_tunnel');assert(gates.isLocked(g,{flags:{wanda_defeated:'true'}}));
 for(const direction of ['up','left','right','down'])assert(gates.candidatesForStep('ville4',direction,13,4).includes(g));
 assert(gates.candidatesForStep('ville4','up',13,3,'cave_rochebrume1').includes(g));
 assert(gates.actorAtTile('ville4',13,4,{}));assert.equal(gates.actorAtTile('ville4',13,4,{flags:{gwenn_rochebrume_defeated:'true'}}),null);
 assert.equal(catalog.npcBattles.gwenn_rochebrume.once,true);
});
test('father dialogue and quest guide the player to the key before the house',()=>{
 const {getSentenceForName,getEndSentenceInformation}=require('../server/game/world/interactionRepository');
 const {deriveGwennQuest,deriveStoryQuest}=require('../server/game/world/storyProgression');
 assert.equal(catalog.npcBattles.champion_wanda.reward.items.gwenn_house_key,undefined);
 assert.equal(catalog.npcBattles.champion_wanda.reward.flags.gwenn_house_key_received,undefined);
 assert.equal(getSentenceForName('gwenn_father',{flags:{}})[1],'gwenn_father_locked');
 const state={flags:{wanda_defeated:'true'}};
 assert.equal(getSentenceForName('gwenn_father',state)[1],'gwenn_father');assert.equal(getEndSentenceInformation('gwenn_father'),'story');
 assert.equal(deriveGwennQuest(state).map,'ville4');assert.equal(deriveStoryQuest(state).map,'ville4');
 state.flags.gwenn_house_key_received='true';assert.equal(getSentenceForName('gwenn_father',state)[1],'gwenn_father_after');
 assert.equal(getEndSentenceInformation('gwenn_father_after'),undefined);assert.equal(deriveStoryQuest(state).map,'ville4_maison2');
});
test('only the father grants a new key; Wanda unlocks the conversation and old keys stay valid',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:30000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);const {dbPool:db}=require('../server/config/database'),{randomUUID}=require('crypto'),key=require('../server/persistence/gwennKeyRepository'),progress=require('../server/persistence/progressionRepository');
 const http=require('http'),express=require('express'),{once}=require('events'),app=express();app.use(express.json());app.use('/api',require('../server/http/routes'));const server=http.createServer(app),ids=[];
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 for(const kind of ['none','flag','badge','receipt','false-marker','fresh','legacy-item','legacy-flag','legacy-gwenn']){
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'gw_key_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=(await r.json()).user;ids.push(u.id);
 if(kind==='flag'||kind.startsWith('legacy-'))await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'wanda_defeated','true')",[u.id]);
 if(kind==='false-marker')await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'gwenn_house_key_received','false'),(?,'wanda_defeated','false')",[u.id,u.id]);
 if(kind==='badge'||kind==='false-marker')await db.execute("INSERT INTO player_badges(user_id,badge_key)VALUES(?,'tide_badge')",[u.id]);
 if(kind==='receipt')await db.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json)VALUES(?,'story_champion_wanda','champion_wanda','{}')",[u.id]);
 if(kind==='fresh'){await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'ana_defeated','true')",[u.id]);assert.equal((await progress.completeNpcBattle(u.id,'champion_wanda')).granted,true);}
 if(kind==='legacy-item')await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'gwenn_house_key',1)",[u.id]);
 if(kind==='legacy-flag')await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'gwenn_house_key_received','true')",[u.id]);
 if(kind==='legacy-gwenn')await db.execute("INSERT INTO user_npc_battles(user_id,battle_key,dialogue_name,reward_json)VALUES(?,'story_gwenn_rochebrume','gwenn_rochebrume','{}')",[u.id]);
 const [[before]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);await Promise.all([key.reconcile(u.id),key.reconcile(u.id)]);
 let state=await progress.loadProgressState(u.id);let [rows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.id]);
 const legacy=kind.startsWith('legacy-');assert.equal(rows.length,legacy?1:0,kind+' must not receive the key from Wanda or login');assert.equal(state.flags.gwenn_house_key_received==='true',legacy);assert.equal(state.quests.some(q=>q.key==='gwenn_challenge'),kind!=='none');
 const result=await Promise.all([progress.completeStoryEvent(u.id,'gwenn_father'),progress.completeStoryEvent(u.id,'gwenn_father')]);
 assert.equal(result.filter(r=>r.granted).length,kind==='none'||legacy?0:1,kind+' exactly one handover');
 [rows]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='gwenn_house_key'",[u.id]);assert.equal(rows.length,kind==='none'?0:1);if(rows.length)assert.equal(rows[0].quantity,1);
 state=await progress.loadProgressState(u.id);assert.equal(state.money,before.money);assert.equal(state.flags.gwenn_house_key_received==='true',kind!=='none');
 if(kind!=='none')assert.equal(state.quests.find(q=>q.key==='gwenn_challenge').map,'ville4_maison2');
 if(!legacy&&kind!=='none'){const won=await progress.completeNpcBattle(u.id,'gwenn_rochebrume');assert(won.granted);assert.equal(won.progress.quests.find(q=>q.key==='gwenn_challenge').status,'completed');assert.equal((await progress.completeNpcBattle(u.id,'gwenn_rochebrume')).granted,false);}
 }
 }finally{await new Promise(r=>server.close(r));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});

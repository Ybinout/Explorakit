const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,pc,factory,repo,user,other,party,stored;
test.before(async()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');factory=require('../server/game/drift/pokemonFactory');repo=require('../server/persistence/experienceExchangeRepository');
 user=await users.createUserWithStarter('XP_'+randomUUID().slice(0,8),randomUUID());other=await users.createUserWithStarter('XP_'+randomUUID().slice(0,8),randomUUID());});
test.after(async()=>{if(!db)return;for(const u of[user,other])if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();});
test.beforeEach(async()=>{if(!enabled)return;await db.execute('DELETE FROM pokemon_storage WHERE user_id=?',[user.id]);await db.execute('DELETE FROM experience_exchange_receipts WHERE user_id=?',[user.id]);await db.execute('UPDATE users SET money=4000000 WHERE id=?',[user.id]);
 party=[20,80].map(l=>factory.create(94,l,true));stored=[35,110].map(l=>factory.create(94,l,true));party[0].heldItem='choice_scarf';party[0].currentHp=2;party[0].status='burn';party[0].movePp[0]=0;party[0].pendingMoves=[{move:'Shadow Ball',level:40}];party[1].currentHp=0;
 await teams.editEquipe(user.id,{pokemons:party});for(const p of stored)await pc.storeCapturedPokemon(user.id,p);
 const before=await snapshot();for(const e of before.box){const raw=typeof e.pokemon_data==='string'?JSON.parse(e.pokemon_data):e.pokemon_data;raw.futureMetadata={version:72,note:'preserve'};await db.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?',[JSON.stringify(raw),user.id,e.uuid]);}
});
async function snapshot(){const record=await teams.getTeamRecord(user.id);const[rows]=await db.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position',[record.id]);const[box]=await db.execute('SELECT * FROM pokemon_storage WHERE user_id=? ORDER BY box_index,slot_index',[user.id]);const[[money]]=await db.execute('SELECT money FROM users WHERE id=?',[user.id]);const[receipts]=await db.execute('SELECT * FROM experience_exchange_receipts WHERE user_id=?',[user.id]);return{rows,box,money:Number(money.money),receipts};}
async function request(a,b){const {offer}=await repo.preview(user.id,{firstUuid:a.uuid,secondUuid:b.uuid});return{requestId:randomUUID(),firstUuid:a.uuid,secondUuid:b.uuid,price:offer.price,expected:offer.expected};}
const onlyXP=raw=>Object.fromEntries(Object.entries(raw).filter(([k])=>!require('../server/game/experienceExchange/operation').FIELDS.includes(k)));
for(const mode of['team/team','team/PC','PC/PC'])test('SQL : '+mode+' transaction atomique et conservation de toutes les caractéristiques',{skip:!enabled},async()=>{
 const[a,b]=mode==='team/team'?party:mode==='team/PC'?[party[0],stored[0]]:stored,before=await snapshot(),payload=await request(a,b),result=await repo.exchange(user.id,payload),after=await snapshot();
 assert.equal(after.money,3000000);assert.equal(after.receipts.length,1);assert.equal(result.receipt.after[0].experience,result.receipt.before[1].experience);assert.equal(result.receipt.after[1].experience,result.receipt.before[0].experience);
 after.rows.forEach((row,i)=>{assert.deepEqual(onlyXP(row),onlyXP(before.rows[i]));const p=teams.rowToPokemon(row);assert.equal(p.level,p.calculateLevelFromExperience(row.experience));assert.equal(row.current_attack,p.attack);if(row.uuid===party[0].uuid)assert.equal(row.current_hp,2);if(row.uuid===party[1].uuid)assert.equal(row.current_hp,0);});
 after.box.forEach((row,i)=>{const prev=before.box[i],raw=typeof row.pokemon_data==='string'?JSON.parse(row.pokemon_data):row.pokemon_data,old=typeof prev.pokemon_data==='string'?JSON.parse(prev.pokemon_data):prev.pokemon_data;assert.deepEqual({...row,pokemon_data:null},{...prev,pokemon_data:null});assert.deepEqual(onlyXP(raw),onlyXP(old));});
 const duplicate=await repo.exchange(user.id,payload);assert(duplicate.duplicate);assert.deepEqual(await snapshot(),after);
});
test('SQL : doubles confirmations simultanées et confirmation périmée, un seul paiement',{skip:!enabled},async()=>{
 const payload=await request(...party),results=await Promise.all([repo.exchange(user.id,payload),repo.exchange(user.id,payload)]);assert.equal(results.filter(x=>x.duplicate).length,1);const before=await snapshot();await assert.rejects(repo.exchange(user.id,{...payload,requestId:randomUUID()}),/changé/);assert.deepEqual(await snapshot(),before);
});
test('SQL : fonds, propriété, espèce, prix, signature et verrou de commerce ne consomment rien',{skip:!enabled},async()=>{
 const payload=await request(...party);await db.execute('UPDATE users SET money=999999 WHERE id=?',[user.id]);const before=await snapshot();await assert.rejects(repo.exchange(user.id,payload),/1 000 000/);assert.deepEqual(await snapshot(),before);await db.execute('UPDATE users SET money=4000000 WHERE id=?',[user.id]);
 const baseline=await snapshot();for(const p of[{...payload,price:1},{...payload,firstUuid:randomUUID()},{...payload,expected:['wrong','wrong']}])await assert.rejects(repo.exchange(user.id,p));await assert.rejects(repo.exchange(other.id,payload),/disponible/);assert.deepEqual(await snapshot(),baseline);
 const locks=require('../server/game/social/tradeLocks');locks.acquire([user.id],'xp-fixture');try{await assert.rejects(repo.exchange(user.id,payload));}finally{locks.release([user.id],'xp-fixture');}assert.deepEqual(await snapshot(),baseline);
 await db.execute('UPDATE pokemons SET pokemon_id=9 WHERE uuid=?',[party[1].uuid]);const mismatch=await snapshot();await assert.rejects(repo.preview(user.id,{firstUuid:party[0].uuid,secondUuid:party[1].uuid}),/espèce/);assert.deepEqual(await snapshot(),mismatch);
});
test('SQL : échec après débit et premier Pokémon modifié, rollback intégral',{skip:!enabled},async()=>{
 const payload=await request(...party),before=await snapshot(),original=db.getConnection.bind(db);db.getConnection=async()=>{const c=await original(),execute=c.execute.bind(c);let updates=0;c.execute=async(sql,args)=>{if(sql.startsWith('UPDATE pokemons SET ')&&++updates===2)throw Error('Injected second-write failure');return execute(sql,args);};const release=c.release.bind(c);c.release=()=>{c.execute=execute;release();};return c;};
 try{await assert.rejects(repo.exchange(user.id,payload),/Injected/);}finally{db.getConnection=original;}assert.deepEqual(await snapshot(),before);
});
test('SQL : reçu rejoué après autre modification renvoie l’équipe actuelle, UUID lié au propriétaire et contenu',{skip:!enabled},async()=>{
 const payload=await request(...party);await repo.exchange(user.id,payload);await db.execute("UPDATE pokemons SET name='Après échange' WHERE uuid=?",[party[0].uuid]);const again=await repo.exchange(user.id,payload);assert.equal(again.equipe.pokemons[0].name,'Après échange');await assert.rejects(repo.exchange(other.id,payload),/déjà/);await assert.rejects(repo.exchange(user.id,{...payload,firstUuid:stored[0].uuid}),/déjà/);
});

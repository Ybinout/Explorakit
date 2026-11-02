const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,repo,codec,factory,rewards,TournamentController;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');repo=require('../server/persistence/superTournamentRepository');codec=require('../server/game/drift/checkpointCodec');factory=require('../server/game/drift/pokemonFactory');rewards=require('../server/game/superTournament/rewards');({TournamentController}=require('../server/game/superTournament/controller'));});
test.after(async()=>db?.end());
async function fixture(cards=['pp_3','pp_5','all_pp_5','power_mana']){
 const u=await users.createUserWithStarter('tower_family_'+randomUUID(),randomUUID(),{starterId:7}),original=codec.encode(await teams.loadEquipe(u.id));
 const create=()=>new TournamentController({userId:u.id,random:()=>.99,getPlayer:()=>({id:'owner',username:u.username}),emit:()=>{},travel:async()=>{}}),c=create();await c.load();await c.register({pokemons:[9,94].map(id=>factory.create(id,100,true))});
 await c.atomic(()=>{const r=c.run;r.room=16;r.cleared=17;r.phase='reward';r.score=5100;r.reward={id:randomUUID(),afterRoom:17,cards};r.player.equipe.pokemons[0].currentHp=1;r.player.equipe.pokemons[0].status='poison';r.player.equipe.pokemons[0].movePp[0]=0;});
 return{u,c,create,original,remove:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};
}
function distinct(offer){assert.equal(offer.cards.length,4);assert.equal(new Set(offer.cards.map(rewards.familyOf)).size,4);}
test('SQL old PP duplicates are repaired once with the rarest card retained and no cost, heal, score or reward reset',{skip:!enabled},async()=>{
 const f=await fixture();try{const before=await repo.load(f.u.id),c=f.create();await c.load();const after=await repo.load(f.u.id);distinct(after.run.reward);assert(after.run.reward.cards.includes('power_mana'));assert.equal(after.run.reward.id,before.run.reward.id);assert.equal(after.run.reward.afterRoom,17);assert.equal(after.version,before.version+1);
  for(const key of['score','room','cleared','phase','rerolls','cash'])assert.deepEqual(after.run[key],before.run[key],key);assert.deepEqual(codec.encode(after.run.player.equipe),codec.encode(before.run.player.equipe));assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);
  const again=f.create();await again.load();assert.equal(again.version,after.version);assert.deepEqual(again.run.reward,after.run.reward);
 }finally{await f.remove();}
});
test('SQL failed family repair leaves the original offer and token intact; retry commits the corrected draw',{skip:!enabled},async()=>{
 const f=await fixture(),acquire=db.getConnection.bind(db);try{let injected=false;db.getConnection=async()=>{const c=await acquire(),execute=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...args)=>{if(!injected&&sql.startsWith('UPDATE super_tournament_profiles')){injected=true;throw Error('injected family repair failure');}return execute(sql,...args);};c.release=()=>{c.execute=execute;c.release=release;release();};return c;};
  const before=await repo.load(f.u.id),c=f.create();await assert.rejects(()=>c.load(),/injected/);db.getConnection=acquire;const saved=await repo.load(f.u.id);assert.equal(saved.version,before.version);assert.deepEqual(saved.run.reward,before.run.reward);assert.deepEqual(saved.run.rerolls,before.run.rerolls);await c.load();distinct(c.run.reward);
 }finally{db.getConnection=acquire;await f.remove();}
});
test('SQL current-family offers and rerolled offers stay unique after restart, and stale claim tokens are rejected',{skip:!enabled},async()=>{
 const f=await fixture(['heal_10','pp_3','revive_25','cure']);try{const c=f.create();await c.load();const old=c.run.reward,version=c.version;assert.equal(version,f.c.version);await c.rerollReward({offerId:old.id});distinct(c.run.reward);assert(c.run.reward.cards.every(k=>!old.cards.includes(k)));assert.equal(c.run.rerolls.remaining,1);const again=f.create();await again.load();assert.deepEqual(again.run.reward,c.run.reward);assert.equal(again.run.rerolls.remaining,1);await assert.rejects(()=>again.claimReward({offerId:old.id,cardKey:old.cards[0]}));
 }finally{await f.remove();}
});
test('SQL a legacy short offer keeps its existing distinct choices and completes with a fourth family once',{skip:!enabled},async()=>{
 const f=await fixture(['heal_10','pp_3','cure']);try{const original=[...f.c.run.reward.cards],c=f.create();await c.load();distinct(c.run.reward);assert.deepEqual(c.run.reward.cards.slice(0,3),original);assert.equal(rewards.familyOf(c.run.reward.cards[3]),'revive');
 }finally{await f.remove();}
});
test('SQL cycle two and three battles use +20 levels and preserve all trained stats, HP, PP and UUIDs on reconnect',{skip:!enabled},async()=>{
 const f=await fixture(['heal_10','pp_3','revive_25','cure']);try{let c=f.c;
  for(const [room,levels]of[[16,[95,105,110]],[32,[115,125,130]]]){
   await c.atomic(()=>{c.run.battle=null;c.run.room=room;c.run.phase='ready';c.run.reward=null;c.startBattle();});const enemy=c.run.battle.b.equipe.pokemons;assert.deepEqual(enemy.map(p=>p.level).sort((a,b)=>a-b),levels);const before=enemy.map((p,i)=>teams.pokemonToRow(p,0,i)),score=c.run.score;
   c=f.create();await c.load();assert.deepEqual(c.run.battle.b.equipe.pokemons.map((p,i)=>teams.pokemonToRow(p,0,i)),before);assert.equal(c.run.score,score);assert.equal(c.run.room,room);for(const p of c.run.battle.b.equipe.pokemons){assert.equal(p.k,4);assert(Object.values(p.iv).every(v=>v===31));assert.equal(p.currentHp,p.maxHp);}
  }assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);
 }finally{await f.remove();}
});

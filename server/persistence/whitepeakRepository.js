const {randomUUID,createHash}=require('node:crypto');
const {dbPool,withTransaction}=require('../config/database');
const rules=require('../game/whitepeak/rules');
const rankings=require('./whitepeakRankingRepository');
const teamRepo=require('./teamRepository'),pc=require('./pokemonStorageRepository');
const storage=require('../game/storage/pokemonStorage'),trade=require('../game/social/tradeRules');
const MAX=Number.MAX_SAFE_INTEGER,parse=value=>typeof value==='string'?JSON.parse(value):value;
async function owners(ids,c){
 const found=new Map();for(const id of [...new Set(ids)].sort((a,b)=>a-b)){
  const[[u]]=await c.execute('SELECT id,username,money FROM users WHERE id=? FOR UPDATE',[id]);
  if(!u)rules.fail('Ce dresseur n’est plus disponible.');found.set(id,{...u,money:Number(u.money)});
 }return found;
}
async function credit(c,id,value){const[[u]]=await c.execute('SELECT money FROM users WHERE id=? FOR UPDATE',[id]);const n=Math.min(value,Math.max(0,MAX-Number(u.money)));await c.execute('UPDATE users SET money=money+? WHERE id=?',[n,id]);return{amount:n,balance:Number(u.money)+n};}
async function snapshots(ids,c){
 const users=await owners(ids,c),result=[];
 for(const id of ids){const record=await teamRepo.getTeamRecord(id,c);if(!record)rules.fail('Équipe indisponible.');
  const[rows]=await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]);
  result.push({userId:id,user:users.get(id),teamId:record.id,team:rows.map(teamRepo.rowToPokemon),entries:await pc.loadEntries(id,c,true),items:{}});
 }return result;
}
function requireSlot(entries){try{return storage.freeSlot(entries);}catch{rules.fail('Le PC est plein. Libère une place pour recevoir le Pokémon misé.');}}
function inspect(s,uuids,config){
 const picked=s.map((owner,i)=>{
  rules.validateTeam(owner.team,config);
  if(owner.user.money<config.money)rules.fail(`${owner.user.username} n’a pas les ${config.money.toLocaleString('fr-FR')} ₽ nécessaires.`);
  if(!config.pokemonStake)return null;
  if(!uuids[i])return null;
  const selected=trade.checkOffer(owner,{pokemonUuid:rules.uuid(uuids[i]),items:[]});
  if(owner.team.some(p=>p.uuid===uuids[i])&&!owner.team.some(p=>p.uuid!==uuids[i]&&storage.isAble(p)))rules.fail('Garde un autre Pokémon apte dans ton équipe avant de le miser.');
  requireSlot(owner.entries);return selected.pokemon;
 });
 if(config.pokemonStake)for(const owner of s)requireSlot(owner.entries);
 const digest=createHash('sha256').update(JSON.stringify({config,ids:s.map(o=>o.userId),teams:s.map(o=>o.team.map(pc.encodePokemon)),picked:picked.map(p=>p?pc.encodePokemon(p):null)})).digest('hex');
 return {digest,selected:picked.map(p=>p?storage.view([p],[]).team[0]:null),inventories:s.map(o=>trade.inventory(o))};
}
async function inspectDuel(ids,uuids,config){config=rules.settings(config);return withTransaction(async c=>inspect(await snapshots(ids,c),uuids,config));}
async function startDuel({id,ids,uuids,config,digest}){
 config=rules.settings(config);rules.uuid(id);if(ids.length!==2||ids[0]===ids[1])rules.fail('Deux dresseurs différents sont nécessaires.');
 return withTransaction(async c=>{
  const s=await snapshots(ids,c),[[previous]]=await c.execute('SELECT id FROM whitepeak_duels WHERE id=? FOR UPDATE',[id]);if(previous)rules.fail('Ce duel a déjà été inscrit.');
  const current=inspect(s,uuids,config);if(current.digest!==digest)rules.fail('L’équipe ou la mise a changé. Vérifiez le nouveau récapitulatif.');
  if(config.pokemonStake&&current.selected.some(p=>!p))rules.fail('Chaque dresseur doit proposer un Pokémon.');
  for(const owner of s)await c.execute('UPDATE users SET money=money-? WHERE id=?',[config.money,owner.userId]);
  await c.execute('INSERT INTO whitepeak_duels(id,phase,user_a,user_b,stake,offers_json) VALUES(?,\'active\',?,?,?,?)',[id,...ids,config.money,JSON.stringify({uuids,config,digest,rankingTeams:s.map(o=>require('../game/whitepeak/rankings').teamIds(o.team))})]);
  return {teams:s.map(o=>o.team),balances:s.map(o=>o.user.money-config.money)};
 });
}
async function transferStake(ids,uuids,winnerId,c){
   const loserId=ids.find(n=>n!==winnerId),s=await snapshots(ids,c),loser=s.find(o=>o.userId===loserId),winner=s.find(o=>o.userId===winnerId);
   const uuid=uuids[ids.indexOf(loserId)],selected=trade.checkOffer(loser,{pokemonUuid:uuid,items:[]}),pokemon=selected.pokemon;
   const destination=requireSlot(winner.entries);
   if(selected.source.kind==='team'){
    const remaining=loser.team.filter(p=>p.uuid!==uuid);if(!remaining.some(storage.isAble))rules.fail('Transfert impossible : équipe restante indisponible.');
    await c.execute('DELETE FROM pokemons WHERE team_id=?',[loser.teamId]);
    const insert=`INSERT INTO pokemons (${teamRepo.POKEMON_COLUMNS.join(',')}) VALUES (${teamRepo.POKEMON_COLUMNS.map(()=>'?').join(',')})`;
    for(const[i,p]of remaining.entries())await c.execute(insert,teamRepo.pokemonToRow(p,loser.teamId,i+1));
   }else await c.execute('DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?',[loserId,uuid]);
   await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',[uuid,winnerId,destination.box,destination.slot,pc.encodePokemon(pokemon)]);
   await require('./progressionRepository').markPokemonCaught(winnerId,pokemon,c);
   if(trade.catalog.get(pokemon.heldItem)?.unique)await c.execute('INSERT IGNORE INTO user_item_discoveries(user_id,item_key) VALUES(?,?)',[winnerId,pokemon.heldItem]);
   return {...storage.view([pokemon],[]).team[0],winnerId};
}
async function finishDuel(id,winnerId,reason='finished'){
 const[[initial]]=await dbPool.execute('SELECT user_a,user_b,offers_json FROM whitepeak_duels WHERE id=?',[id]);if(!initial)rules.fail('Duel introuvable.');
 if(parse(initial.offers_json)?.houseVersion){const result=await require('./whitepeakHouseRepository').finish(id,winnerId,reason,parse(initial.offers_json));rankings.invalidate();return result;}
 const settled=await withTransaction(async c=>{
  const ids=[Number(initial.user_a),Number(initial.user_b)];await owners(ids,c);
  const[[duel]]=await c.execute('SELECT * FROM whitepeak_duels WHERE id=? FOR UPDATE',[id]);if(duel.phase!=='active')return parse(duel.result_json);
  if(winnerId!==null&&!ids.includes(winnerId))rules.fail('Vainqueur invalide.');
  const offers=parse(duel.offers_json),stake=Number(duel.stake),payments=[];let wonPokemon=null;
  if(winnerId!==null&&offers.config.pokemonStake){
   wonPokemon=await transferStake(ids,offers.uuids,winnerId,c);
  }
  for(const owner of ids)payments.push({userId:owner,...await credit(c,owner,winnerId===null?stake:winnerId===owner?stake*2:0)});
  const cancelled=winnerId===null&&reason!=='draw'&&reason!=='both_fled';
  if(!cancelled)for(const owner of ids){const win=winnerId===owner,loss=winnerId!==null&&!win;
   await c.execute('INSERT INTO whitepeak_duel_scores(user_id,wins,losses,draws,points) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE wins=wins+VALUES(wins),losses=losses+VALUES(losses),draws=draws+VALUES(draws),points=GREATEST(0,CAST(points AS SIGNED)+?)',[owner,win?1:0,loss?1:0,winnerId===null?1:0,win?30:0,win?30:loss?-10:0]);
  }
  const result={id,winnerId,reason,payments,wonPokemon,refunded:winnerId===null};
  if(!cancelled)await rankings.record(c,duel,offers,result);
  await c.execute('UPDATE whitepeak_duels SET phase=?,result_json=? WHERE id=?',[cancelled?'cancelled':'finished',JSON.stringify(result),id]);return result;
 });rankings.invalidate();return settled;
}
async function recoverDuels(){const[rows]=await dbPool.execute("SELECT id FROM whitepeak_duels WHERE phase='active'");for(const r of rows)await finishDuel(r.id,null,'server_restart');}
async function leaderboard(options){return(await rankings.page(options)).rows;}
function roundView(r){return r?{id:r.id,phase:r.phase,opensAt:Number(r.opens_at),closesAt:Number(r.closes_at),resultAt:Number(r.result_at),nextAt:Number(r.next_at),result:r.result===null?null:Number(r.result)}:null;}
async function rouletteState(){const[[r]]=await dbPool.execute('SELECT * FROM whitepeak_roulette_rounds WHERE active_slot=1');if(!r)return null;const[bets]=await dbPool.execute('SELECT b.id,b.user_id AS userId,u.username,b.choice_json,b.amount,b.payout FROM whitepeak_roulette_bets b JOIN users u ON u.id=b.user_id WHERE b.round_id=? ORDER BY b.id',[r.id]);return{...roundView(r),bets:bets.map(b=>({id:b.id,userId:b.userId,username:b.username,choice:parse(b.choice_json),amount:Number(b.amount),payout:Number(b.payout)}))};}
async function newRound(now=Date.now()){
 const state=await rouletteState();if(state)return state;
 try{await dbPool.execute("INSERT INTO whitepeak_roulette_rounds(id,active_slot,phase,opens_at,closes_at,result_at,next_at) VALUES(?,1,'betting',?,?,?,?)",[randomUUID(),now,now+30000,now+38000,now+45000]);}catch(e){if(e.code!=='ER_DUP_ENTRY')throw e;}return rouletteState();
}
async function placeBet(userId,data,now=Date.now()){
 const id=rules.uuid(data.id),roundId=rules.uuid(data.roundId),choice=rules.choice(data.choice),amount=rules.amount(data.amount,1000000,100);
 return withTransaction(async c=>{
  const[[round]]=await c.execute('SELECT * FROM whitepeak_roulette_rounds WHERE id=? FOR UPDATE',[roundId]);if(!round)rules.fail('Cette manche est terminée.');
  const[[old]]=await c.execute('SELECT * FROM whitepeak_roulette_bets WHERE id=?',[id]);
  if(old){if(Number(old.user_id)!==userId||old.round_id!==roundId||Number(old.amount)!==amount||JSON.stringify(rules.choice(parse(old.choice_json)))!==JSON.stringify(choice))rules.fail('Cette mise a déjà été utilisée.');const u=(await owners([userId],c)).get(userId);return{balance:u.money,duplicate:true};}
  if(round.phase!=='betting'||Number(round.closes_at)<=now||round.active_slot!==1)rules.fail('Les mises sont fermées pour ce tirage.');
  const u=(await owners([userId],c)).get(userId);const[[total]]=await c.execute('SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM whitepeak_roulette_bets WHERE round_id=? AND user_id=?',[roundId,userId]);
  if(Number(total.count)>=10||Number(total.amount)+amount>1000000)rules.fail('Maximum dix mises et 1 000 000 ₽ par tirage.');if(u.money<amount)rules.fail('Tu n’as pas assez de Pokédollars.');
  await c.execute('UPDATE users SET money=money-? WHERE id=?',[amount,userId]);await c.execute('INSERT INTO whitepeak_roulette_bets(id,round_id,user_id,choice_json,amount) VALUES(?,?,?,?,?)',[id,roundId,userId,JSON.stringify(choice),amount]);return{balance:u.money-amount,duplicate:false};
 });
}
async function spin(id,result,now=Date.now()){
 if(!Number.isInteger(result)||result<0||result>36)rules.fail('Tirage invalide.');
 await dbPool.execute("UPDATE whitepeak_roulette_rounds SET phase='spinning',result=? WHERE id=? AND phase='betting' AND closes_at<=?",[result,id,now]);return rouletteState();
}
async function settleRoulette(id,now=Date.now()){
 return withTransaction(async c=>{
  const[[r]]=await c.execute('SELECT * FROM whitepeak_roulette_rounds WHERE id=? FOR UPDATE',[id]);if(!r||r.phase!=='spinning'||Number(r.result_at)>now)return[];
  const[bets]=await c.execute('SELECT * FROM whitepeak_roulette_bets WHERE round_id=? ORDER BY user_id,id FOR UPDATE',[id]);await owners(bets.map(b=>Number(b.user_id)),c);const results=[];
  for(const bet of bets){const requested=rules.payout({choice:parse(bet.choice_json),amount:Number(bet.amount)},Number(r.result));const result=await credit(c,Number(bet.user_id),requested);await c.execute('UPDATE whitepeak_roulette_bets SET payout=? WHERE id=?',[result.amount,bet.id]);results.push({userId:Number(bet.user_id),id:bet.id,...result});}
  await c.execute("UPDATE whitepeak_roulette_rounds SET phase='result' WHERE id=?",[id]);return results;
 });
}
async function closeRound(id,now=Date.now()){await dbPool.execute("UPDATE whitepeak_roulette_rounds SET active_slot=NULL WHERE id=? AND phase='result' AND next_at<=?",[id,now]);}
module.exports={initializeRankings:rankings.initialize,rankingPage:rankings.page,honorRoll:rankings.top,rankingRevision:()=>rankings.revision,inspectDuel,startDuel,finishDuel,recoverDuels,leaderboard,rouletteState,newRound,placeBet,spin,settleRoulette,closeRound,_duelStorage:{owners,credit,snapshots,inspectStakes:inspect,transferStake}};

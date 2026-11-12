const {randomUUID,createHash}=require('node:crypto');
const {dbPool,withTransaction}=require('../config/database');
const rules=require('../game/whitepeak/rules'),pc=require('./pokemonStorageRepository');
const storage=require('../game/storage/pokemonStorage');
const helpers=()=>require('./whitepeakRepository')._duelStorage;
const parse=x=>typeof x==='string'?JSON.parse(x):x;
function split(total,ids){return ids.map((id,i)=>({userId:id,amount:Math.floor(total/ids.length)+(i<total%ids.length?1:0)}));}
function roster(owner){return [...owner.team,...owner.entries.map(e=>e.pokemon)].filter(p=>!p.isEgg);}
function fingerprint(snapshots,config){return createHash('sha256').update(JSON.stringify({config,owners:snapshots.map(s=>({id:s.userId,talentRevision:s.talentRevision,team:s.team.map(pc.encodePokemon),pc:s.entries.map(e=>[e.box,e.slot,pc.encodePokemon(e.pokemon)])}))})).digest('hex');}
function checkFunds(snapshots,sides,config){
 const charges=sides.flatMap(ids=>split(config.money,ids));
 for(const charge of charges){const s=snapshots.find(s=>s.userId===charge.userId);if(s.user.money<charge.amount)rules.fail(`${s.user.username} doit disposer de ${charge.amount.toLocaleString('fr-FR')} ₽.`);}
 return charges;
}
async function inspect(ids,sides,config){return withTransaction(async c=>{
 const snapshots=await helpers().snapshots(ids,c);
 for(const s of snapshots)rules.validateTeam(s.team,{uniqueItems:false});
 checkFunds(snapshots,sides,config);
 return{snapshots,digest:fingerprint(snapshots,config)};
});}
function select(snapshots,sides,selections,config){
 const used=new Set();
 return sides.map((ids,index)=>{
  const chosen=selections[index];if(!Array.isArray(chosen))rules.fail('Équipe commune invalide.');
  const owner=snapshots.find(s=>s.userId===ids[0]);
  const target=ids.length===1?Math.min(6,config.mode==='pve'?owner.team.length:roster(owner).length):(config.mode==='2v2'?config.format:6);
  if(chosen.length!==target)rules.fail(`Choisissez exactement ${target} Pokémon pour ce camp.`);
  const counts=new Map(ids.map(id=>[id,0]));
  const team=chosen.map(({ownerId,uuid})=>{
   if(!ids.includes(ownerId)||used.has(uuid))rules.fail('Propriétaire ou Pokémon en double invalide.');
   const s=snapshots.find(s=>s.userId===ownerId),p=roster(s).find(p=>p.uuid===uuid);
   if(!p)rules.fail('Un Pokémon n’est plus disponible.');
   used.add(uuid);counts.set(ownerId,counts.get(ownerId)+1);return p;
  });
  if([...counts.values()].some(n=>n<1||n>6))rules.fail('Chaque allié doit apporter entre un et six Pokémon.');
  rules.validateTeam(team,config,{maxSize:target});
  const maxCorrupted=rules.corruptionLimit(config);
  if(team.filter(p=>p.corruption?.permanent).length>maxCorrupted)rules.fail(maxCorrupted===1?'Un seul Pokémon corrompu par camp.':'Deux Pokémon corrompus au maximum par camp.');
  return team;
 });
}
async function start({id,ids,sides,selections,config,digest,stakeUuids=[]}){
 rules.uuid(id);config=rules.settings(config);
 if(new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1)||ids.length>4)rules.fail('Participants invalides.');
 const expected=config.mode==='pve'?[1]:config.mode==='2v1'?[1,2]:config.mode==='2v2'?[2,2]:config.mode==='1v1'&&config.battleFormat==='double'?[1,1]:null;
 if(!expected||!Array.isArray(sides)||sides.length!==expected.length||sides.some((s,i)=>!Array.isArray(s)||s.length!==expected[i])||JSON.stringify(sides.flat())!==JSON.stringify(ids))rules.fail('Camps invalides pour ce format.');
 return withTransaction(async c=>{
  const snapshots=await helpers().snapshots(ids,c);
  const[[previous]]=await c.execute('SELECT id FROM whitepeak_duels WHERE id=? FOR UPDATE',[id]);if(previous)rules.fail('Ce combat a déjà commencé.');
  if(fingerprint(snapshots,config)!==digest)rules.fail('Les Pokémon disponibles ont changé. Préparez à nouveau le combat.');
  const charges=checkFunds(snapshots,sides,config),teams=select(snapshots,sides,selections,config);
  if(config.pokemonStake){if(sides.some(s=>s.length!==1)||stakeUuids.some(x=>!x)||stakeUuids.length!==2)rules.fail('Chaque dresseur doit proposer un Pokémon.');helpers().inspectStakes(snapshots,stakeUuids,{...config,uniqueItems:false});}
  for(const charge of charges)await c.execute('UPDATE users SET money=money-? WHERE id=?',[charge.amount,charge.userId]);
  const offers={houseVersion:1,ids,sides,charges,config,digest,stakeUuids,rankingTeams:teams.map(require('../game/whitepeak/rankings').teamIds)};
  await c.execute("INSERT INTO whitepeak_duels(id,phase,user_a,user_b,stake,offers_json) VALUES(?,'active',?,?,?,?)",[id,sides[0][0],sides[1]?.[0]||sides[0][0],config.money,JSON.stringify(offers)]);
  return{teams,balances:charges.map(charge=>({userId:charge.userId,balance:snapshots.find(s=>s.userId===charge.userId).user.money-charge.amount}))};
 });
}
async function finish(id,winnerId,reason,offers){return withTransaction(async c=>{
 await helpers().owners(offers.ids,c);
 const[[row]]=await c.execute('SELECT * FROM whitepeak_duels WHERE id=? FOR UPDATE',[id]);
 if(!row)rules.fail('Combat introuvable.');if(row.phase!=='active')return parse(row.result_json);
 const winningSide=winnerId===null?null:offers.sides.findIndex(ids=>ids.includes(winnerId));
 if(winningSide===-1)rules.fail('Camp vainqueur invalide.');
 const rewards=winnerId===null?offers.charges:split(Number(row.stake)*2,offers.sides[winningSide]);
 const payments=[];for(const owner of offers.ids){const amount=rewards.find(r=>r.userId===owner)?.amount||0;payments.push({userId:owner,...await helpers().credit(c,owner,amount)});}
 const cancelled=winnerId===null&&reason!=='finished'&&reason!=='draw'&&reason!=='both_fled';
 if(offers.config.mode!=='pve'&&!cancelled)for(const owner of offers.ids){const win=winningSide!==null&&offers.sides[winningSide].includes(owner),loss=winningSide!==null&&!win;
  await c.execute('INSERT INTO whitepeak_duel_scores(user_id,wins,losses,draws,points) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE wins=wins+VALUES(wins),losses=losses+VALUES(losses),draws=draws+VALUES(draws),points=GREATEST(0,CAST(points AS SIGNED)+?)',[owner,win?1:0,loss?1:0,winningSide===null?1:0,win?30:0,win?30:loss?-10:0]);
 }
 const wonPokemon=winnerId!==null&&offers.config.pokemonStake?await helpers().transferStake(offers.ids,offers.stakeUuids,winnerId,c):null;
 const result={id,mode:offers.config.mode,winnerId,winningSide,winners:winningSide===null?[]:offers.sides[winningSide],reason,payments,wonPokemon,refunded:winnerId===null};
 if(offers.config.mode!=='pve'&&!cancelled)await require('./whitepeakRankingRepository').record(c,row,offers,result);
 await c.execute('UPDATE whitepeak_duels SET phase=?,result_json=? WHERE id=?',[cancelled?'cancelled':'finished',JSON.stringify(result),id]);return result;
});}
function summary(p,ownerId,username,source){return{uuid:p.uuid,ownerId,username,source,name:p.truename||p.name,pokemonId:p.data.id,level:p.level,potential:p.k,corrupted:!!p.corruption?.permanent,heldItem:p.heldItem||null,heldItemName:require('../game/social/tradeRules').catalog.get(p.heldItem)?.name||null,types:p.data.type};}
function detail(p){return storage.view([p],[]).team[0];}
function inspectStakes(snapshots,uuids,config){return helpers().inspectStakes(snapshots,uuids,{...config,uniqueItems:false}).selected;}
module.exports={inspectStakes,inspect,start,finish,split,roster,select,fingerprint,summary,detail};

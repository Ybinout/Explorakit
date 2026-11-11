// Offline release reconciliation. Dry run by default; --apply requires a
// verified backup and a stopped game service. No DDL, deletion or bulk reset.
const {createHash}=require('node:crypto'),{cleanRow,receiptId}=require('../server/game/corruption/remediation');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
async function candidates(db){
 const [team]=await db.execute('SELECT p.*,t.user_id FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE p.corruption IS NOT NULL');
 const [boxes]=await db.execute('SELECT uuid,user_id,pokemon_data FROM pokemon_storage');
 const [market]=await db.execute("SELECT id,seller_id,pokemon_data FROM player_market_listings WHERE status='active' AND pokemon_data IS NOT NULL");
 return [...team.map(row=>({kind:'team',userId:row.user_id,id:row.uuid,row})),...boxes.map(r=>({kind:'box',userId:r.user_id,id:r.uuid,row:parse(r.pokemon_data)})),...market.map(r=>({kind:'market',userId:r.seller_id,id:r.id,row:parse(r.pokemon_data)}))].filter(v=>cleanRow(v.row));
}
async function run(db,{apply=false}={}){
 const found=await candidates(db),results=[];
 const uuids=new Set(found.map(v=>v.row.uuid)),codec=require('../server/game/drift/checkpointCodec');
 let suspendedCopies=0;
 for(const sql of ['SELECT snapshot FROM super_tournament_profiles WHERE snapshot IS NOT NULL','SELECT snapshot FROM dark_battle_checkpoints WHERE snapshot IS NOT NULL',"SELECT snapshot FROM corruption_raids WHERE phase IN ('lobby','active')"]){
  const [rows]=await db.execute(sql);
  for(const row of rows){const seen=new Set();function visit(v){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(uuids.has(v.uuid)&&v.corruption)suspendedCopies++;if(v instanceof Map)for(const[k,x]of v){visit(k);visit(x);}else for(const x of Object.values(v))visit(x);}visit(codec.decode(row.snapshot));}
 }
 if(apply&&suspendedCopies)throw Error('Termine les tentatives suspendues contenant ces légendaires avant la restitution ; aucune donnée n’a été modifiée.');
 for(const candidate of found){
  const c=apply?await db.getConnection():db;
  try{
   if(apply){await c.beginTransaction();await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[candidate.userId]);}
   let row=candidate.row;
   if(apply){
    const [[fresh]]=await c.execute(candidate.kind==='team'?'SELECT * FROM pokemons WHERE uuid=? FOR UPDATE':candidate.kind==='box'?'SELECT pokemon_data FROM pokemon_storage WHERE uuid=? AND user_id=? FOR UPDATE':"SELECT pokemon_data FROM player_market_listings WHERE id=? AND seller_id=? AND status='active' FOR UPDATE",candidate.kind==='team'?[candidate.id]:[candidate.id,candidate.userId]);
    if(!fresh){await c.rollback();continue;}row=candidate.kind==='team'?fresh:parse(fresh.pokemon_data);
   }
   const [crafts]=await c.execute("SELECT result_json FROM corruption_receipts WHERE user_id=? AND operation='craft' ORDER BY created_at DESC",[candidate.userId]);
   const plateTypes={};for(const raw of crafts){const r=parse(raw.result_json);for(const [family,m]of Object.entries(parse(row.corruption)?.modules||{}))if(!plateTypes[family]&&r.created&&r.itemKey===m.itemKey)plateTypes[family]=r.type;}
   const plan=cleanRow(row,plateTypes);if(!plan){if(apply)await c.rollback();continue;}
   const id=receiptId(candidate.userId,row.uuid),[[previous]]=await c.execute('SELECT user_id FROM corruption_receipts WHERE id=?',[id]);
   if(previous&&Number(previous.user_id)!==Number(candidate.userId))throw Error('Reçu de restitution incohérent.');
   if(apply){
    if(candidate.kind==='team'){
     const keys=['corruption','passive_ability','held_item','current_hp','current_attack','current_defense','current_special_attack','current_special_defense','current_speed','ability1','ability2','ability3','ability4','move1_pp','move2_pp','move3_pp','move4_pp'];
     await c.execute('UPDATE pokemons SET '+keys.map(k=>k+'=?').join(',')+' WHERE uuid=?',[...keys.map(k=>plan.after[k]),row.uuid]);
    }else if(candidate.kind==='box')await c.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE uuid=? AND user_id=?',[JSON.stringify(plan.after),row.uuid,candidate.userId]);
    else await c.execute("UPDATE player_market_listings SET pokemon_data=?,category='pokemon' WHERE id=? AND seller_id=?",[JSON.stringify(plan.after),candidate.id,candidate.userId]);
    if(!previous){for(const {key,quantity}of plan.refund)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[candidate.userId,key,quantity]);
     await c.execute("INSERT INTO corruption_receipts(id,user_id,operation,request_hash,result_json) VALUES(?,?,'uncorrupt',?,?)",[id,candidate.userId,createHash('sha256').update(JSON.stringify(row)).digest('hex'),JSON.stringify({...plan,location:candidate.kind})]);}
    await c.commit();
   }
   results.push({location:candidate.kind,pokemonUuid:row.uuid,species:row.pokemon_id,userId:candidate.userId,refund:previous?[]:plan.refund,duplicate:!!previous});
  }catch(e){if(apply)await c.rollback();throw e;}finally{if(apply)c.release();}
 }
 return{apply,affected:results.length,suspendedCopies,results};
}
module.exports={run,candidates};
if(require.main===module){const {dbPool}=require('../server/config/database');run(dbPool,{apply:process.argv.includes('--apply')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>dbPool.end());}

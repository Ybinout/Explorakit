// Reconcile genuine raid encounters; dry run unless --apply is explicitly used.
const codec=require('../server/game/drift/checkpointCodec');
function encounters(rows){
 const found=new Map();
 for(const row of rows){
  const run=codec.decode(row.snapshot);
  if(!run?.combat||!Array.isArray(run.combat.models)||run.rift?.training||!['active','won','lost'].includes(run.phase))continue;
  const boss=run.combat.boss,id=Number(boss?.data?.id);
  if(!Number.isInteger(id)||id<1||id>649)continue;
  const owners=new Set(run.combat.models.map(m=>Number(m.ownerId)));
  for(const member of run.members||[]){
   if(member.reserved||!owners.has(Number(member.id)))continue;
   const key=member.id+':'+id,old=found.get(key);
   found.set(key,{userId:Number(member.id),pokemonId:id,shiny:require('../server/game/models/shiny').isShiny(boss.shiny)||!!old?.shiny});
  }
 }
 return [...found.values()];
}
async function backfill(db,apply=false){
 const [rows]=await db.execute("SELECT snapshot FROM corruption_raids WHERE phase IN ('active','won','lost')");
 const entries=encounters(rows);
 if(apply)for(const e of entries)await db.execute(`INSERT INTO user_pokedex(user_id,pokemon_id,seen_count,caught_count,shiny_seen_count,first_seen_at)
 SELECT id,?,1,0,?,CURRENT_TIMESTAMP FROM users WHERE id=?
 ON DUPLICATE KEY UPDATE seen_count=GREATEST(seen_count,1),shiny_seen_count=GREATEST(shiny_seen_count,VALUES(shiny_seen_count)),first_seen_at=COALESCE(first_seen_at,CURRENT_TIMESTAMP)`,[e.pokemonId,e.shiny?1:0,e.userId]);
 return{apply,raids:rows.length,encounters:entries.length};
}
module.exports={encounters,backfill};
if(require.main===module){const {dbPool}=require('../server/config/database');backfill(dbPool,process.argv.includes('--apply')).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>dbPool.end());}

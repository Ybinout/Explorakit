const {dbPool,withTransaction}=require('../config/database');
const logic=require('../game/whitepeak/rankings');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
let revision=0,topCache=null;
function invalidate(){revision++;topCache=null;}
async function initialize(){return withTransaction(async c=>{
 const[[meta]]=await c.execute('SELECT initialized FROM whitepeak_ranking_meta WHERE id=1 FOR UPDATE');
 if(meta?.initialized)return;
 const[rows]=await c.execute("SELECT user_a,user_b,offers_json,result_json,phase FROM whitepeak_duels WHERE phase='finished' ORDER BY created_at,id");
 const[old]=await c.execute('SELECT * FROM whitepeak_duel_scores');
 for(const s of logic.history(rows,old))await c.execute('INSERT IGNORE INTO whitepeak_mode_scores(mode,user_id,wins,losses,draws,points) VALUES(?,?,?,?,?,?)',[s.mode,s.userId,s.wins,s.losses,s.draws,s.points]);
 await c.execute('UPDATE whitepeak_ranking_meta SET initialized=TRUE WHERE id=1');invalidate();
});}
async function record(c,row,offers,result){
 const mode=logic.modeOf(offers);if(!logic.MODES.includes(mode))return;
 for(const id of logic.participants(row,offers)){
  const o=logic.outcome(id,offers,result),side=offers.houseVersion?offers.sides.findIndex(s=>s.includes(id)):[Number(row.user_a),Number(row.user_b)].indexOf(id);
  const team=offers.rankingTeams?.[side]||null,format=offers.config?.format||6;
  await c.execute('INSERT INTO whitepeak_mode_scores(mode,user_id,wins,losses,draws,points,last_team,last_format,last_duel_id) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE wins=wins+VALUES(wins),losses=losses+VALUES(losses),draws=draws+VALUES(draws),points=GREATEST(0,CAST(points AS SIGNED)+?),last_team=VALUES(last_team),last_format=VALUES(last_format),last_duel_id=VALUES(last_duel_id)',[mode,id,o.wins,o.losses,o.draws,o.wins?30:0,team?JSON.stringify(team):null,format,row.id,o.wins?30:o.losses?-10:0]);
 }
}
async function page({mode='1v1',page=1,search='',userId=null}={}){
 if(!logic.MODES.includes(mode)||!Number.isSafeInteger(page)||page<1||page>100000||typeof search!=='string'||search.length>80)throw Object.assign(Error('Classement demandé invalide.'),{statusCode:409});
 const size=20,query=search.trim(),args=[mode],filter=query?' AND INSTR(LOWER(u.username),LOWER(?))>0':'';if(query)args.push(query);
 // Rank before filtering/pagination so a search never invents a new position.
 const sql='SELECT u.id,u.username,s.wins,s.losses,s.draws,s.points,s.last_team,s.last_format,ROW_NUMBER() OVER(ORDER BY s.points DESC,s.wins DESC,s.losses ASC,s.user_id) AS rank FROM whitepeak_mode_scores s JOIN users u ON u.id=s.user_id WHERE s.mode=?';
 const[count]=await dbPool.execute('SELECT COUNT(*) total FROM whitepeak_mode_scores s JOIN users u ON u.id=s.user_id WHERE s.mode=?'+filter,args);
 const total=Number(count[0].total),pages=Math.max(1,Math.ceil(total/size)),current=Math.min(page,pages);
 const[rows]=await dbPool.execute('SELECT * FROM ('+sql+') u WHERE 1=1'+(query?' AND INSTR(LOWER(u.username),LOWER(?))>0':'')+' ORDER BY u.rank LIMIT ? OFFSET ?',[...args,size,(current-1)*size]);
 const map=r=>({id:r.id,username:r.username,rank:Number(r.rank),wins:r.wins,losses:r.losses,draws:r.draws,points:r.points,winrate:r.wins+r.losses?Math.round(r.wins/(r.wins+r.losses)*1000)/10:0,team:parse(r.last_team)||[],format:r.last_format||6});
 const[top]=await dbPool.execute('SELECT * FROM ('+sql+') u ORDER BY u.rank LIMIT 3',[mode]);
 let own=null;if(userId){const[me]=await dbPool.execute('SELECT * FROM ('+sql+') u WHERE u.id=?',[mode,userId]);own=me[0]?map(me[0]):null;}
 return{mode,page:current,pages,total,rows:rows.map(map),top:top.map(map),own,revision};
}
async function top(){if(!topCache){const version=revision;topCache=dbPool.execute("SELECT u.id,u.username,s.wins,s.losses,s.points FROM whitepeak_mode_scores s JOIN users u ON u.id=s.user_id WHERE s.mode='1v1' ORDER BY s.points DESC,s.wins DESC,s.losses ASC,s.user_id LIMIT 3").then(([rows])=>({rows:rows.map((r,i)=>({...r,rank:i+1})),revision:version})).catch(e=>{topCache=null;throw e;});}return topCache;}
async function standings(userId,c=dbPool){
 const [rows]=await c.execute('SELECT * FROM (SELECT mode,user_id,wins,losses,draws,points,ROW_NUMBER() OVER(PARTITION BY mode ORDER BY points DESC,wins DESC,losses ASC,user_id) AS position FROM whitepeak_mode_scores) ranked WHERE user_id=?',[userId]);
 return logic.MODES.map(mode=>{const r=rows.find(r=>r.mode===mode);return {mode,position:r?Number(r.position):null,score:Number(r?.points)||0,wins:Number(r?.wins)||0,losses:Number(r?.losses)||0,draws:Number(r?.draws)||0};});
}
module.exports={initialize,record,page,top,standings,invalidate,get revision(){return revision;}};

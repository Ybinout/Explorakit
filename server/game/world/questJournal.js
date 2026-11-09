const catalog=require('../../../data/game/progression.json');
const definitions=Object.freeze(catalog.quests.filter(q=>q.journal).sort((a,b)=>a.order-b.order));
const READ_PREFIX='journal_read:';
const chain=['route_guard_defeated','aspha_route2_defeated','moonpunch_defeated','hoze_defeated','gwenn_route8_defeated','raphael_defeated','ana_defeated','wanda_defeated','gwenn_rochebrume_defeated','sevenp_defeated','lucie_freed','professor_lead','professor_lab_key','professor_defeated','lucie_rescued'];
const badges={lake_badge:'moonpunch_defeated',dune_badge:'hoze_defeated',bloom_badge:'raphael_defeated',ore_badge:'ana_defeated',tide_badge:'wanda_defeated',summit_badge:'sevenp_defeated'};
function factsView(facts={}){
 const flags={...facts.flags},items=new Set((facts.items||[]).filter(i=>typeof i==='string'||Number(i.quantity)>0).map(i=>typeof i==='string'?i:i.item_key));
 const earned=new Set((facts.badges||[]).filter(b=>b.earned!==false).map(b=>typeof b==='string'?b:b.badge_key||b.key));
 const battles=new Set((facts.battles||[]).map(b=>typeof b==='string'?b:b.battle_key||b.battleKey));
 for(const d of Object.values(catalog.npcBattles))if(battles.has(d.battleKey))for(const[k,v]of Object.entries(d.reward?.flags||{}))if(v==='true')flags[k]='true';
 for(const[key,flag]of Object.entries(badges))if(earned.has(key))flags[flag]='true';
 const ending=earned.has('violence_badge')||earned.has('pardon_badge');
 if(ending||flags.void_defeated==='true'||['won','complete'].includes(flags.mirror_stage)){
  flags.void_defeated=flags.void_intro=flags.void_found=flags.lucie_rescued='true';
 }
 let last=-1;chain.forEach((flag,i)=>{if(flags[flag]==='true')last=i;});
 // Journal projection only. Never grant flags, wins, badges or rewards from a
 // later proof, and never mistake the admin replay's private flags for a win.
 for(let i=0;i<=last;i++)flags[chain[i]]='true';
 if(items.has('dark_exploration_chart'))flags.dc2_chart_found='true';
 if(facts.map==='DC2_44')flags.dc2_arrived='true';
 if(facts.map==='void_arena')flags.journal_visit_void='true';
 if(items.has('void_teleporter')&&flags.lucie_rescued==='true')flags.void_found='true';
 if(['tour_rdc','tour_etage1','tour_etage2','tour_etage3'].includes(facts.map))flags.journal_visit_comptoir='true';
 if(/^super_tournament_(lobby|sas|room)$/.test(facts.map||'')||facts.hasTournamentProfile||Object.keys(flags).some(k=>/^visited_(region|town):super/.test(k)&&flags[k]==='true'))flags.journal_visit_super_island='true';
 if(/^jungle[1-9]$/.test(facts.map||'')||flags.dark_rules_read==='true'||Object.keys(flags).some(k=>/^visited_region:jungle[1-9]$/.test(k)&&flags[k]==='true'))flags.journal_visit_dark='true';
 if(flags.journal_legacy_comptoir==='true')flags.journal_visit_comptoir='true';
 return {...facts,flags,items,earned,ending,bestRooms:Math.max(0,Math.floor(Number(facts.bestRooms)||0))};
}
function derive(facts={}){
 const f=factsView(facts),stored=new Map((facts.quests||[]).map(q=>[q.quest_key||q.key,q])),entries=[],byKey=new Map();
 for(const d of definitions){
  const old=stored.get(d.key),previouslyCompleted=old?.status==='completed';
  if(!(d.after||[]).every(key=>byKey.get(key)?.status==='completed'))continue;
  if(d.requiresItem&&!f.items.has(d.requiresItem)&&!previouslyCompleted)continue;
  if(!(d.requiresQuestFlags||[]).every(key=>f.flags[key]==='true')&&!previouslyCompleted)continue;
  const complete=previouslyCompleted||(d.completeCounter?f[d.completeCounter]>=d.target:d.completeAnyFlags?d.completeAnyFlags.some(k=>f.flags[k]==='true'):d.completeValues?d.completeValues.includes(f.flags[d.completeFlag]):f.flags[d.completeFlag]==='true');
  const status=complete?'completed':'active',progress=complete?d.target:d.completeCounter?Math.min(d.target,f[d.completeCounter]):0;
  let description=d.description,map=d.map,destination=d.destination;
  if(d.key==='journal_comptoir'&&f.flags.mathilde_pikapika_defeated==='true')description='Mathilde t’a laissé passer. Traverse les Routes 5 et 6 depuis Valpierre, puis entre dans la grande tour du centre commercial.';
  if(d.key==='journal_gwenn'&&f.flags.gwenn_house_key_received==='true'){description='Tu as la clé. Entre dans la maison au toit orange de la Route 4 et remporte le défi de Gwenn pour libérer le tunnel de Rochebrume.';map='route4_maison';destination='Gwenn · Maison de la Route 4';}
  if(d.key==='journal_teleporter_use'&&Number(f.flags.void_charge)>=5)description='Le téléporteur est chargé. Utilise-le depuis ton sac pour découvrir où il mène.';
  if(d.key==='journal_rift'&&status==='active'&&!f.ending&&f.flags.void_claimed!=='true'){description='Avant de quitter l’arène oubliée, récupère le badge du Professeur. Retourne ensuite dans la maison de la Route 2 pour retrouver la faille.';map='void_arena';destination='Le Professeur · Arène oubliée';}
  const entry={key:d.key,section:d.section,order:d.order,title:d.title,description,map,destination,target:d.target,progress,status,unread:status==='active'&&f.flags[READ_PREFIX+d.key]!=='true',updatedAt:old?.updated_at||null,completedAt:old?.completed_at||null};
  entries.push(entry);byKey.set(d.key,entry);
 }
 return {version:1,entries,unreadCount:entries.filter(e=>e.unread).length,completedCount:entries.filter(e=>e.status==='completed').length};
}
function legacyComptoir(facts){const f=factsView(facts);return facts.flags?.journal_started!=='true'&&f.flags.ana_defeated==='true';}
function visitFlag(map){if(map==='DC2_44')return 'dc2_arrived';if(map==='void_arena')return 'journal_visit_void';return /^tour_(rdc|etage[123])$/.test(map||'')?'journal_visit_comptoir':/^super_tournament_(lobby|sas|room)$/.test(map||'')?'journal_visit_super_island':/^jungle[1-9]$/.test(map||'')?'journal_visit_dark':null;}
module.exports={definitions,READ_PREFIX,derive,factsView,legacyComptoir,visitFlag};

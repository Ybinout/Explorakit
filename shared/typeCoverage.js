// Display-only analysis using the battle engine's canonical type chart.
const {getEffectiveness,TYPE_EFFECTIVENESS}=require('../server/game/battle/typeChart');
const TYPES=Object.keys(TYPE_EFFECTIVENESS);
const absorptions={'Levitate':'Ground','Flash Fire':'Fire','Water Absorb':'Water','Dry Skin':'Water','Storm Drain':'Water','Volt Absorb':'Electric','Lightning Rod':'Electric','Motor Drive':'Electric','Sap Sipper':'Grass'};
const plates=Object.fromEntries(require('../data/game/items.json').items.filter(i=>i.abilityPlate).map(i=>[i.key,i.boost_type]));
function types(p){return p.__battle?.tempTypes?.length&&p.__battle.tempTypes || p.__battle?.formTypes?.length&&p.__battle.formTypes || (p.data?.id===493&&p.passiveAbility==='Multitype'&&plates[p.heldItem]?[plates[p.heldItem]]:null) || p.corruption?.modules?.type?.types || p.data?.type || [p.type1,p.type2].filter(Boolean);}
function defense(p,type){
 let m=types(p).reduce((v,t)=>v*getEffectiveness(type,t),1),a=p.passiveAbility;
 if(absorptions[a]===type || a==='Wonder Guard'&&m<=1)return 0;
 if(a==='Thick Fat'&&['Fire','Ice'].includes(type)||['Heatproof','Water Bubble'].includes(a)&&type==='Fire')m*=.5;
 if(a==='Dry Skin'&&type==='Fire')m*=1.25;
 if(a==='Fluffy'&&type==='Fire')m*=2;
 if(['Filter','Solid Rock','Prism Armor'].includes(a)&&m>1)m*=.75;
 return m;
}
function offensiveType(p,m){
 if((m.name||m.ename)==='Judgment')m={...m,type:plates[p.heldItem]||'Normal'};
 if(m.name==='Hidden Power'||m.ename==='Hidden Power'){
  if(p.hiddenPowerType)return p.hiddenPowerType;
  const keys=['hp','attack','defense','speed','specialAttack','specialDefense'],list=['Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark'];
  if(keys.every(k=>Number.isInteger(p.iv?.[k])))return list[Math.floor(keys.reduce((v,k,i)=>v+(p.iv[k]%2)*2**i,0)*15/63)];
 }
 if(p.passiveAbility==='Normalize')return 'Normal';
 if(p.passiveAbility==='Liquid Voice'&&m.sound)return 'Water';
 return m.type==='Normal'?({'Aerilate':'Flying','Pixilate':'Fairy','Refrigerate':'Ice','Galvanize':'Electric'})[p.passiveAbility]||m.type:m.type;
}
function offense(p,type,moves){
 return moves.filter(m=>m.damageClass!=='status'&&m.combat?.damage_class!=='status'&&m.type).map(m=>{
  const t=offensiveType(p,m),name=m.name||m.ename;let multiplier=getEffectiveness(t,type);
  if(m.fixedDamage)multiplier=multiplier===0?0:1;
  if(name==='Freeze-Dry'&&type==='Water')multiplier=2;
  if(name==='Flying Press')multiplier*=getEffectiveness('Flying',type);
  if(name==='Thousand Arrows'&&type==='Flying')multiplier=1;
  if(p.passiveAbility==='Scrappy'&&type==='Ghost'&&['Normal','Fighting'].includes(t))multiplier=1;
  return {name,type:t,multiplier};
 }).sort((a,b)=>b.multiplier-a.multiplier);
}
function analyze(team,lookup){
 const members=team.filter(p=>!p.isEgg).map(p=>({pokemon:p,moves:lookup(p).slice(0,4)}));
 const offenseRows=TYPES.map(type=>{const answers=members.map(({pokemon:p,moves},index)=>({index,moves:offense(p,type,moves)})).filter(x=>x.moves[0]?.multiplier>1);return {type,answers,count:answers.length,best:Math.max(0,...members.flatMap(({pokemon:p,moves})=>offense(p,type,moves).map(m=>m.multiplier)))};});
 const defenseRows=TYPES.map(type=>{const multipliers=members.map(({pokemon:p})=>defense(p,type));return {type,multipliers,weak:multipliers.filter(m=>m>1).length,resist:multipliers.filter(m=>m>0&&m<1).length,immune:multipliers.filter(m=>m===0).length};});
 if(!members.length)return {score:0,offenseScore:0,defenseScore:0,offense:offenseRows,defense:defenseRows};
 const o=offenseRows.reduce((v,r)=>v+(r.count? .8:0)+(r.count>=2?.2:0),0)/18;
 const d=defenseRows.reduce((v,r)=>v+Math.max(0,Math.min(1,(r.resist+r.immune>0?.85:.45)+(r.immune ? .15 : 0)-.5*r.weak/members.length-(r.weak>members.length/2&&r.resist+r.immune===0?.2:0))),0)/18;
 return {score:Math.round((.55*o+.45*d)*100),offenseScore:Math.round(o*100),defenseScore:Math.round(d*100),offense:offenseRows,defense:defenseRows};
}
module.exports={TYPES,types,defense,offense,analyze};

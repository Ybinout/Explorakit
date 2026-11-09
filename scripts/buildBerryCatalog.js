// Stable, versioned recipe families. Re-running preserves all pre-existing items.
const fs=require('node:fs');
const types=[['Normal','Ivoire'],['Fire','Braise'],['Water','Marée'],['Electric','Étincelle'],['Grass','Sylve'],['Ice','Givre'],['Fighting','Ferveur'],['Poison','Venin'],['Ground','Argile'],['Flying','Alizé'],['Psychic','Songe'],['Bug','Chrysalide'],['Rock','Silex'],['Ghost','Brume'],['Dragon','Écaille'],['Dark','Éclipse'],['Steel','Alliage'],['Fairy','Crépuscule']];
const stats=[['attack','Vigueur','Attaque'],['specialAttack','Oracle','Attaque Spéciale'],['defense','Rempart','Défense'],['specialDefense','Quiétude','Défense Spéciale'],['speed','Zéphyr','Vitesse'],['maxHp','Vitalité','PV maximum']];
const names=Object.fromEntries(stats.map(([k,,n])=>[k,n]));
const file='data/game/items.json',catalog=JSON.parse(fs.readFileSync(file)),base=catalog.items.filter(i=>!i.berryKind);
const classic=base.filter(i=>i.key.endsWith('_berry')&&i.category==='held');
if(classic.length!==39)throw Error('Classic berry catalog changed; review recipes.');
const definitions=[];
for(const i of classic)definitions.push({key:'corrupted_'+i.key,name:i.name+' (Corrompue)',category:'berry_material',berryKind:'ingredient',berryBase:i.key,description:'Récoltée dans une culture de cristaux. Ingrédient du Mutateur de baies : combiner trois baies corrompues.',sell_price:500});
const families=[...stats.map(([stat,name])=>({id:'stat_'+stat.toLowerCase(),name,bonus:{kind:'stat',stat}})),...types.map(([type,name])=>({id:'offense_'+type.toLowerCase(),name,bonus:{kind:'offense',type}})),...types.map(([type,name])=>({id:'defense_'+type.toLowerCase(),name:'Égide '+name,bonus:{kind:'defense',type}}))];
for(const [index,f] of families.entries()){
 const stat=stats[index%6][0],penalty=stats[(index+2)%6][0],entryStat=stats[(index+1)%5][0];
 f.ingredients=[classic[index%39].key,classic[(index+7)%39].key,classic[(index+19+Math.floor(index/39))%39].key].map(k=>'corrupted_'+k).sort();
 f.results={failed:'failed_mutation_berry'};
 for(const [rarity,amount,suffix] of [['common',.10,''],['rare',.18,' vive'],['legendary',.30,' souveraine']]){
  const effect={family:f.id,rarity,bonus:{...f.bonus,amount},...(rarity!=='common'?{penalty:{stat,factor:rarity==='rare'?.98:.75}}:{}),...(rarity==='legendary'?{entryStage:{stat:entryStat,stages:1}}:{})};
  // Avoid a bonus and its penalty cancelling the very same statistic.
  if(effect.penalty&&effect.penalty.stat===f.bonus.stat)effect.penalty.stat=penalty;
  // Ivoire souveraine: trade physical Defense rather than physical Attack.
  if(f.id==='offense_normal'&&rarity==='legendary')effect.penalty.stat='defense';
  const typeName={Normal:'Normal',Fire:'Feu',Water:'Eau',Electric:'Électrik',Grass:'Plante',Ice:'Glace',Fighting:'Combat',Poison:'Poison',Ground:'Sol',Flying:'Vol',Psychic:'Psy',Bug:'Insecte',Rock:'Roche',Ghost:'Spectre',Dragon:'Dragon',Dark:'Ténèbres',Steel:'Acier',Fairy:'Fée'}[f.bonus.type];
  const main=f.bonus.kind==='stat'?`+${amount*100} % de ${names[f.bonus.stat]}`:f.bonus.kind==='offense'?`+${amount*100} % de dégâts ${typeName}`:`−${amount*100} % de dégâts ${typeName} reçus`;
  const key='mutant_'+f.id+'_'+rarity+'_berry';f.results[rarity]=key;
  definitions.push({key,name:'Baie '+f.name+suffix,category:'held',berryKind:'mutation',mutationBerry:effect,permanentConsumption:true,description:main+(effect.entryStage?`, +1 niveau de ${names[effect.entryStage.stat]}`:'')+(effect.penalty?`, −${rarity==='rare'?2:25} % de ${names[effect.penalty.stat]}`:'')+'. Activée et consommée définitivement à l’entrée en combat. Effets perdus au retrait. Pour tous les Pokémon.',sell_price:rarity==='common'?1000:rarity==='rare'?2500:6000});
 }
}
definitions.push({key:'failed_mutation_berry',name:'Baie flétrie',category:'treasure',berryKind:'failed',description:'Une mutation sans résultat exploitable. Se revend uniquement ; aucun effet en combat.',sell_price:150});
const rebuilt=new Map([...base,...definitions].map(i=>[i.key,i]));
const ordered=catalog.items.map(i=>rebuilt.get(i.key));
const existing=new Set(catalog.items.map(i=>i.key));
ordered.push(...definitions.filter(i=>!existing.has(i.key)));
fs.writeFileSync(file,JSON.stringify({...catalog,items:ordered},null,2)+'\n');
const mutationCatalog={version:1,growthMs:1200000,seedMs:300000,crystalCost:10,rarities:[{key:'failed',weight:20},{key:'common',weight:50},{key:'rare',weight:25},{key:'legendary',weight:5}],classic:classic.map(i=>({key:i.key,name:i.name})),families};
for(const target of ['data/game/berryMutation.json','vue-explorakit/src/data/berryMutation.json'])fs.writeFileSync(target,JSON.stringify(mutationCatalog,null,2)+'\n');

fs.writeFileSync('vue-explorakit/src/data/berryItems.json',JSON.stringify([...classic.map(i=>({...i,classic:true})),...definitions],null,2)+'\n');

const heldFile='vue-explorakit/src/data/heldItems.json',held=JSON.parse(fs.readFileSync(heldFile));for(const i of definitions.filter(i=>i.category==='held'))held[i.key]={name:i.name,description:i.description};fs.writeFileSync(heldFile,JSON.stringify(held,null,2)+'\n');

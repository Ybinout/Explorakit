// Pinned singles additions for the 493-species playable Pokédex. Offline only.
const fs=require('node:fs'),path=require('node:path');
const {Dex}=require(process.env.ABILITY_DEX_PATH||'@pkmn/dex'),dex=Dex.mod('gen7');
const root=path.resolve(__dirname,'..'),file=path.join(root,'data/game/moves.json');
const catalog=JSON.parse(fs.readFileSync(file)),source=require('../data/vendor/pokeapi/learnsets.gen7.json');
const ids=[618,619,620,660,667,668,672,673,675,678,679,681,682,684,692,693,694,706,707,710,715];
const stat={atk:'attack',def:'defense',spa:'specialAttack',spd:'specialDefense',spe:'speed',accuracy:'accuracy',evasion:'evasion'};
const normalize=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
let next=Math.max(...catalog.map(m=>m.id))+1;
const added=[];
for(const sourceId of ids){
 const reference=source.moves[sourceId],move=dex.moves.get(reference.name);if(!move.exists)throw Error(reference.name);
 const old=catalog.find(m=>normalize(m.ename)===normalize(move.name));
 const effects=[];
 for(const[key,stages]of Object.entries(move.boosts||{}))effects.push({kind:'stat_stage',target:'opponent',stat:stat[key],stages});
 for(const[key,stages]of Object.entries(move.self?.boosts||{}))effects.push({kind:'stat_stage',target:'self',stat:stat[key],stages});
 if(move.name==='Toxic Thread')effects.push({kind:'status',target:'opponent',status:'poison',chance:1});
 if(move.name==='Strength Sap')effects.push({kind:'strength_sap'});
 if(move.name==='Laser Focus')effects.push({kind:'laser_focus',target:'self',turns:2});
 if(move.name==='Throat Chop')effects.push({kind:'sound_block',turns:2,chance:1,secondary:true});
 if(move.name==='Psychic Terrain')effects.push({kind:'field',field:'psychic_terrain',turns:5});
 if(move.name==='Aurora Veil')effects.push({kind:'field',field:'aurora_veil',turns:5});
 const target=move.target==='self'?'self':move.target==='allySide'?'self_side':move.target==='all'?'field':'single';
 const entry={id:old?.id??next++,sourceMoveId:sourceId,catalogueRevision:2,ename:move.name,type:move.type,
  category:{Physical:'phy',Special:'spe',Status:'sta'}[move.category],power:move.basePower||null,accuracy:move.accuracy===true?null:move.accuracy,pp:move.pp,
  combat:{damage_class:move.category.toLowerCase(),power_type:['Power Trip','Burn Up','Stomping Tantrum'].includes(move.name)?'special_case':move.category==='Status'?'status':'standard',
   priority:move.priority,crit_stage:(move.critRatio||1)-1,target,effects}};
 if(old)catalog[catalog.indexOf(old)]=entry;else catalog.push(entry);
 added.push(move.name);
}
// Force Poigne keeps its stable internal name; canonical aliases are resolved by
// the learnset generator. Existing numeric identifiers are never renumbered.
const stored=catalog.find(m=>m.ename==='Stored Power');stored.combat.power_type='special_case';
const bytes=JSON.stringify(catalog,null,4)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==bytes)throw Error('Stale move additions');}else fs.writeFileSync(file,bytes);
const flagsFile=path.join(root,'data/game/move_ability_flags.gen7.json'),flags=JSON.parse(fs.readFileSync(flagsFile));
for(const name of added){const m=dex.moves.get(name),value={};for(const k of ['contact','punch','bite','sound','bullet','pulse','powder','heal'])if(m.flags[k])value[k]=true;if(m.secondaries?.length)value.secondary=true;flags.moves[name]=value;}
const flagBytes=JSON.stringify(flags,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(flagsFile,'utf8')!==flagBytes)throw Error('Stale move flags');}else fs.writeFileSync(flagsFile,flagBytes);
const spreadFile=path.join(root,'data/vendor/pokeapi/spread-moves.json'),spread=JSON.parse(fs.readFileSync(spreadFile));
spread.moves=[...new Set([...spread.moves,...added.filter(name=>['allAdjacent','allAdjacentFoes','all'].includes(dex.moves.get(name).target)&&dex.moves.get(name).category!=='Status')])].sort();
const spreadBytes=JSON.stringify(spread,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(spreadFile,'utf8')!==spreadBytes)throw Error('Stale spread moves');}else fs.writeFileSync(spreadFile,spreadBytes);
console.log(JSON.stringify({total:catalog.length,added,checked:process.argv.includes('--check')}));

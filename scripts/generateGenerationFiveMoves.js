// The two USUM natural moves missing from the newly playable Gen5 species.
const fs=require('node:fs'),path=require('node:path');
const {Dex}=require(process.env.ABILITY_DEX_PATH||'@pkmn/dex'),dex=Dex.mod('gen7');
const root=path.resolve(__dirname,'..'),file=root+'/data/game/moves.json',catalog=JSON.parse(fs.readFileSync(file));
let next=Math.max(...catalog.map(m=>m.id))+1;
for(const name of['Gear Up','Fire Lash']){
 const m=dex.moves.get(name);if(!m.exists)throw Error(name);
 const effects=name==='Gear Up'?['attack','specialAttack'].map(stat=>({kind:'stat_stage',target:'self',stat,stages:1})):[{kind:'stat_stage',target:'opponent',stat:'defense',stages:-1,chance:1,secondary:true}];
 const old=catalog.find(move=>move.ename===name),entry={id:old?.id??next++,sourceMoveId:m.num,catalogueRevision:3,ename:name,type:m.type,category:m.category==='Status'?'sta':'phy',power:m.basePower||null,accuracy:m.accuracy===true?null:m.accuracy,pp:m.pp,
  combat:{damage_class:m.category.toLowerCase(),power_type:m.category==='Status'?'status':'standard',priority:m.priority,crit_stage:0,target:name==='Gear Up'?'plus_minus_allies':'single',effects}};
 if(old)catalog[catalog.indexOf(old)]=entry;else catalog.push(entry);
}
fs.writeFileSync(file,JSON.stringify(catalog,null,4)+'\n');
const flagsPath=root+'/data/game/move_ability_flags.gen7.json',flags=JSON.parse(fs.readFileSync(flagsPath));flags.moves['Fire Lash']={contact:true,secondary:true};flags.moves['Gear Up']={};fs.writeFileSync(flagsPath,JSON.stringify(flags,null,2)+'\n');

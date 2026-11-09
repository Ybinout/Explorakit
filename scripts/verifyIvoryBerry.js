// Focused internal balance verification; no database connection or public note.
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const key='mutant_offense_normal_legendary_berry',baseline='fb7e9a0f0ec772f5b754dfee77d62e0fabe67cea',clientBaseline='b95bfae25c0d84cca0e38878d8b2956acfc79e57';
for(const[file,client]of[['data/game/items.json',false],['src/data/berryItems.json',true],['src/data/heldItems.json',true]]){
 const current=JSON.parse(fs.readFileSync((client?'vue-explorakit/':'')+file)),old=JSON.parse(execFileSync('git',[...(client?['-C','vue-explorakit']:[]),'show',(client?clientBaseline:baseline)+':'+file],{maxBuffer:8e6}));
 const find=c=>file.includes('heldItems')?c[key]:(c.items||c).find(i=>i.key===key),item=find(current),prior=find(old);
 assert(item.description.includes('+30 % de dégâts Normal, +1 niveau de Défense, −25 % de Défense.'));
 item.description=prior.description;
 if(item.mutationBerry){assert.deepEqual(item.mutationBerry.penalty,{stat:'defense',factor:.75});item.mutationBerry.penalty=prior.mutationBerry.penalty;}
 assert.deepEqual(current,old,file+' must preserve every other field, item and order');
}
for(const file of['data/game/latest_patch.json','data/game/patch_history.json','data/game/berryMutation.json'])assert(fs.readFileSync(file).equals(execFileSync('git',['show',baseline+':'+file])),file);
const {make}=require('./calibrateCorruptionRaids'),{DoublesBattle}=require('../server/game/doubles/doublesBattle'),{RaidBattle}=require('../server/game/raids/RaidBattle'),p=()=>make(9,100,4,['Splash'],'Keen Eye');
for(const mode of['doubles','raid']){
 const a=p();a.heldItem=key;
 const sim=mode==='doubles'?new DoublesBattle(...[[a,p(),p()],[p(),p(),p()]].map((pokemons,id)=>({id,username:'Test'+id,equipe:{pokemons}})),{emit(){}}).sim:new RaidBattle([a,p(),p(),p()].map(pokemon=>({pokemon,ownerId:1,ownerName:'Test'})),p(),{seed:[1,2,3,4],now:()=>1000}).sim;
 const lead=sim.p1.active[0];assert.equal(lead.getStat('atk'),lead.storedStats.atk);assert(Math.abs(lead.getStat('def')-lead.storedStats.def*1.5*.75)<2);assert.equal(lead.getStat('spd'),lead.storedStats.spd);assert.equal(lead.boosts.def,1);
}
console.log(JSON.stringify({success:true,onlyIvoryLegendaryChanged:true,penalty:'defense',factor:.75,attackPreserved:true,defenseStagePreserved:true,realDoublesAndRaid:true,publicNotesUnchanged:true,allRecipesAndRaritiesUnchanged:true}));

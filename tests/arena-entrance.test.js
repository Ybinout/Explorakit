const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('champion splash art uses existing illustrations and only appears for arena encounters',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 const maps=['ville1_arene','ville_safe1_arene','gen_arene5','ville3_arene','ville4_arene','ville5_arene'];
 for(const map of maps){
  const champion=arenaChampion(map,'arena');assert(champion?.name);assert(champion.cityEn);
  assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',champion.portrait)));
  for(const kind of ['wild','pvp','colosseum','trainer',undefined])assert.equal(arenaChampion(map,kind),null);
 }
 for(const map of ['start','route1','ville_commerciale','__proto__','unknown'])assert.equal(arenaChampion(map,'arena'),null);
});
test('Aspha entrance identifies the actual trainer, not other encounters on Route 2',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 const portrait=arenaChampion('route2','trainer','aspha_route2');
 assert.equal(portrait.name,'Aspha');
 assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',portrait.portrait)));
 for(const key of [undefined,null,'challenge_route2','gwenn_route8'])assert.equal(arenaChampion('route2','trainer',key),null);
 for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(arenaChampion('route2',kind,'aspha_route2'),null);
 assert.equal(arenaChampion('route1','trainer','aspha_route2'),null);
});
test('Wayne uses his eyepatch portrait only for his actual opening trainer encounter',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 const dialogue=require('../data/game/interact.json').find(entry=>entry.name==='dia1');
 assert.equal(dialogue.map,'start');assert.equal(dialogue.end,'battle');assert.equal(dialogue.team,'timmy');
 const portrait=arenaChampion(dialogue.map,'trainer',dialogue.name);
 assert.equal(portrait.name,'Wayne');assert.equal(portrait.portrait,'wayne-eyepatch-v1.png');
 assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',portrait.portrait)));
 for(const key of [undefined,null,'timmy','dia1_after','challenge_start'])assert.equal(arenaChampion('start','trainer',key),null);
 for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(arenaChampion('start',kind,'dia1'),null);
 assert.equal(arenaChampion('route1','trainer','dia1'),null);
});
test('Mathilde splash is restricted to her own trainer encounter in Valpierre',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 const portrait=arenaChampion('ville_safe1','trainer','mathilde_pikapika');
 assert.equal(portrait.name,'Mathilde');
 assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',portrait.portrait)));
 for(const key of [undefined,null,'challenge_valpierre','champion_hoze'])assert.equal(arenaChampion('ville_safe1','trainer',key),null);
 for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(arenaChampion('ville_safe1',kind,'mathilde_pikapika'),null);
 assert.equal(arenaChampion('route5','trainer','mathilde_pikapika'),null);
});

test('Maria and Clément keep their own illustrated entrance without affecting other village encounters',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 for(const [key,name,portrait]of [['town_lina','Maria','maria-v2.png'],['town_bastien','Clément','clement-v2.png']]){
  assert.equal(arenaChampion('ville1','trainer',key).name,name);
  assert.equal(arenaChampion('ville1','trainer',key).portrait,portrait);
  assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',portrait)));
  assert.equal(arenaChampion('start','trainer',key),null);
  for(const mode of ['wild','pvp','arena','colosseum'])assert.equal(arenaChampion('ville1',mode,key),null);
 }
 assert.equal(arenaChampion('ville1','trainer','town_nadir'),null);
});

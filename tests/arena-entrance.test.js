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
test('Mathilde splash is restricted to her own trainer encounter in Valpierre',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');
 const portrait=arenaChampion('ville_safe1','trainer','mathilde_pikapika');
 assert.equal(portrait.name,'Mathilde');
 assert(fs.existsSync(path.join(__dirname,'../vue-explorakit/src/assets/image',portrait.portrait)));
 for(const key of [undefined,null,'challenge_valpierre','champion_hoze'])assert.equal(arenaChampion('ville_safe1','trainer',key),null);
 for(const kind of ['wild','pvp','colosseum','arena'])assert.equal(arenaChampion('ville_safe1',kind,'mathilde_pikapika'),null);
 assert.equal(arenaChampion('route5','trainer','mathilde_pikapika'),null);
});

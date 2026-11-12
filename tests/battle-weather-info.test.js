const test=require('node:test'),assert=require('node:assert/strict');
test('weather explanations cover actual RiftMon rules, bilingual and isolated from callers',async()=>{
 const {battleWeatherInfo:info}=await import('../vue-explorakit/src/services/battleWeatherInfo.js');
 assert.equal(info(null),null);assert.equal(info('invalid'),null);
 for(const [kind,count] of Object.entries({rain:3,sun:3,sandstorm:4,hail:4})){
  const fr=info(kind),en=info(kind,'en');assert.notEqual(fr.name,en.name);
  assert.equal(fr.effects.length,count);assert.equal(en.effects.length,count);assert(en.note&&fr.note);
  fr.effects.length=0;en.effects.length=0;
  assert.equal(info(kind).effects.length,count);assert.equal(info(kind,'en').effects.length,count);
 }
 assert.match(info('rain').effects[0],/Eau.*1,5.*Feu.*0,5/);
 assert.match(info('sandstorm').effects[0],/Roche.*Sol.*Acier.*sauf protection/);
 assert.match(info('sandstorm').effects[1],/Défense Spéciale.*Roche.*\+50 %.*Aucun bonus.*Sol ou Acier sans le type Roche/);
 assert.match(info('sandstorm','en').effects[1],/Rock.*\+50% Special Defense.*Ground or Steel.*without Rock.*do not get this bonus/);
 assert.match(info('hail').effects[0],/règles de la grêle.*non Glace.*¹⁄₁₆.*sauf protection/);
 assert.match(info('hail','en').effects[0],/hail rules.*non-Ice.*¹⁄₁₆.*unless protected/);
 assert.match(info('hail').effects[3],/Aucun bonus de Défense.*Glace/);
 assert.match(info('hail','en').effects[3],/Ice.*no Defense bonus/);
});
test('weather duration distinguishes map weather, bounded turn counters and legacy snapshots',async()=>{const {battleWeatherDuration:duration}=await import('../vue-explorakit/src/services/battleWeatherInfo.js');assert.match(duration({persistent:true,turns:0}),/sans limite/);assert.equal(duration({turns:1}),'1 tour restant');assert.equal(duration({turns:5},'en'),'5 turns remaining');assert.equal(duration({turns:Infinity}),'');assert.equal(duration({turns:0}),'');assert.equal(duration(undefined),'');assert.match(duration({turns:999}),/^99 tours/);});
test('stat effects report actual deltas and levels, including saturation and reversal',async()=>{const {battleConditionChanges:diff}=await import('../vue-explorakit/src/services/battleConditions.js');const p=s=>({uuid:'same',currentHp:20,status:'normal',__battle:{statStages:s}});assert.deepEqual(diff(p({attack:5}),p({attack:99})).map(({key,delta,from,to})=>({key,delta,from,to})),[{key:'attack',delta:1,from:5,to:6}]);assert.deepEqual(diff(p({speed:6}),p({speed:99})),[]);const changes=diff(p({attack:2,speed:-2}),p({attack:-1,speed:0}));assert.deepEqual(changes.map(({kind,delta})=>({kind,delta})),[{kind:'down',delta:-3},{kind:'up',delta:2}]);assert.deepEqual(diff(p({attack:1}),{...p({attack:2}),uuid:'other'}),[]);});

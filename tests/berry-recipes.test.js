const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('notebook keywords cover stat/type offense and defense without accents, with stable favorite order',async()=>{
 const {indexRecipes,findRecipes}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../vue-explorakit/src/services/berryRecipes.js'),'utf8')).toString('base64'));
 const catalog=new Map(require('../vue-explorakit/src/data/berryItems.json').map(i=>[i.key,i]));
 const make=(family,favorite=false)=>({key:family,name:'Mélange '+family,ingredients:['corrupted_oran_berry','corrupted_cheri_berry','corrupted_sitrus_berry'],results:Object.fromEntries(['common','rare','legendary'].map(r=>[r,'mutant_'+family+'_'+r+'_berry'])),favorite});
 const recipes=[make('defense_fairy'),make('stat_specialdefense'),make('offense_water'),make('stat_attack'),make('defense_fire',true)],index=indexRecipes(recipes,catalog);
 assert.deepEqual(findRecipes(index,'DÉFENSE').map(r=>r.key),['defense_fire','defense_fairy','stat_specialdefense','offense_water','stat_attack']);
 assert.deepEqual(findRecipes(index,'fEe').map(r=>r.key),['defense_fairy']);
 assert(findRecipes(index,'attaque').some(r=>r.key==='offense_water'));assert(findRecipes(index,'attaque').some(r=>r.key==='stat_attack'));
 assert.equal(findRecipes(index,'oran').length,5);assert.equal(findRecipes(index,'Eau attaque').length,1);
 assert.equal(findRecipes(index,'inexistant').length,0);assert.equal(findRecipes(index,'')[0].key,'defense_fire');
 assert.equal(recipes[0].key,'defense_fairy'); // never mutate the server payload ordering
});

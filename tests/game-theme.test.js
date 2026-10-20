const test=require('node:test'),assert=require('node:assert/strict');
test('legacy preferences keep the default blue/light theme, invalid themes cannot be applied',async()=>{
 const {normalizeGamePreferences}=await import('../vue-explorakit/src/services/gamePreferences.js');
 for(const value of [{},null,{themeColor:'unknown',themeMode:'unknown'}]){const p=normalizeGamePreferences(value);assert.equal(p.themeColor,'blue');assert.equal(p.themeMode,'light');}
 const p=normalizeGamePreferences({themeColor:'lavender',themeMode:'dark',masterVolume:20,language:'en'});assert.equal(p.themeMode,'dark');assert.equal(p.themeColor,'lavender');assert.equal(p.masterVolume,20);assert.equal(p.language,'en');
 const {applyGameTheme}=await import('../vue-explorakit/src/services/gameTheme.js');const root={dataset:{}};applyGameTheme(p,root);assert.deepEqual(root.dataset,{gameThemeColor:'lavender',gameThemeMode:'dark'});
});

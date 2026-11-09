const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const baseline='233d3baf7fdf4059de0c8ca8f03459dd888989ea',clientBaseline='bb894047d8077c3b4de62d64ad58c27a133960d9';
const old=file=>JSON.parse(execFileSync('git',['show',baseline+':'+file],{maxBuffer:32*1024*1024})),read=file=>JSON.parse(fs.readFileSync(file));
const prices={mega_candy:45000,supreme_candy:85000};
const prior=old('data/game/items.json'),items=read('data/game/items.json');assert.equal(prior.items.length,items.items.length);
for(const item of prior.items){const next=structuredClone(items.items.find(i=>i.key===item.key));if(prices[item.key]){assert.equal(next.buy_price,prices[item.key]);next.buy_price=item.buy_price;}assert.deepEqual(next,item,item.key);}
for(const file of['shop_offers.json','department_store.json']){const prior=old('data/game/'+file),next=read('data/game/'+file);function walk(before,after){for(const key of Object.keys(before)){if(prices[key]){assert.equal(after[key].price,prices[key]);after[key].price=before[key].price;}else if(before[key]&&typeof before[key]==='object')walk(before[key],after[key]);}}walk(prior,next);assert.deepEqual(next,prior,file);}
const changed=execFileSync('git',['diff','--name-only',baseline,'--','data']).toString().trim().split('\n').filter(Boolean);
assert.deepEqual(changed.sort(),['department_store','items','latest_patch','patch_history','shop_offers'].map(f=>'data/game/'+f+'.json').sort());
assert.equal(execFileSync('git',['-C','vue-explorakit','diff',clientBaseline,'--','src/services/worldMusic.js']).toString(),'');
const artDiff=execFileSync('git',['-C','vue-explorakit','diff','--name-status',clientBaseline,'--','src/assets']).toString().trim().split('\n').filter(Boolean);
assert(artDiff.every(l=>/^A\s+src\/assets\/battle\/dark-(?:continent2|pyramid)-/.test(l)),artDiff.join('\n'));
const oldHistory=old('data/game/patch_history.json').patches,newHistory=read('data/game/patch_history.json').patches;
for(const p of [...oldHistory,old('data/game/latest_patch.json')])assert.deepEqual(newHistory.find(n=>n.version===p.version),p);
for(const f of read('docs/dark-continent2-author-assets.json').files)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(f.target)).digest('hex'),f.sha256);
console.log(JSON.stringify({success:true,baseline,clientBaseline,allAuthoredMapsAndArtPreserved:true,allGameDataPreservedExceptTwoCandyPricesAndNewPublicNote:true,itemsPreserved:items.items.length,oldMusicUnchanged:true,oldPatchNotesPreserved:true}));

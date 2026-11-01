const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const bytes=fs.readFileSync(path.join(root,'data/game/whitepeak_layout.json'),'utf8');
const target=path.join(root,'vue-explorakit/src/data/whitepeakLayout.json');
if(process.argv.includes('--check')){
 if(fs.readFileSync(target,'utf8')!==bytes)throw Error('Whitepeak layout mirror is stale');
}else fs.writeFileSync(target,bytes);
console.log(JSON.stringify({checked:process.argv.includes('--check'),podiums:JSON.parse(bytes).podiums.length}));

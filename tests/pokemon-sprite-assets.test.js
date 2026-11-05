const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../vue-explorakit'),manifest=require('../vue-explorakit/src/data/pokemonSpriteManifest.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
test('every playable species has front/back normal/shiny animation and poster, with stable bounds across all frames',()=>{
 for(let id=1;id<=649;id++)for(const folder of['front','back','shiny/front','shiny/back']){
  const key=folder+'/'+id,m=manifest[key];assert(m,key);assert(m.frames>0&&m.durationMs>0);assert(m.bounds[0]>=0&&m.bounds[1]>=0&&m.bounds[2]<=m.size[0]&&m.bounds[3]<=m.size[1]);
  assert(fs.existsSync(root+'/public/img/pokemon/'+key+'.png'));assert(fs.existsSync(root+'/public/img/pokemon/animated/'+key+'.webp'));
 }
 for(const form of[10013,10014,10015,10017,10018])for(const folder of['front','back','shiny/front','shiny/back'])assert(manifest[folder+'/'+form]);
});
test('versioned asset packs reconstruct exactly the converted images; tampering and unsafe paths fail',()=>{
 const {unpack}=require('../vue-explorakit/scripts/unpackPokemonSprites.cjs'),packs=require('../vue-explorakit/assets/pokemon/manifest.json');let count=0;
 for(const pack of packs.packs){const buffer=fs.readFileSync(root+'/assets/pokemon/'+pack.file);assert.equal(sha(buffer),pack.sha256);unpack(buffer,pack.files,(name,data)=>{assert.equal(sha(fs.readFileSync(root+'/public/img/pokemon/'+name)),sha(data));count++;});}
 assert.equal(count,Object.keys(manifest).length*2);
 const first=packs.packs[0],buffer=fs.readFileSync(root+'/assets/pokemon/'+first.file),tar=zlib.gunzipSync(buffer);tar[512]^=1;assert.throws(()=>unpack(zlib.gzipSync(tar),first.files,()=>{}),/checksum/);
 const unsafe=Buffer.from(zlib.gunzipSync(buffer));unsafe.fill(0,0,100);unsafe.write('../escape.webp');unsafe.fill(32,148,156);const sum=[...unsafe.subarray(0,512)].reduce((n,b)=>n+b,0);unsafe.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);assert.throws(()=>unpack(zlib.gzipSync(unsafe),first.files,()=>{}),/Invalid sprite archive entry/);
});
test('the shared resolver handles gender, shiny forms, transformations, motion preferences and finite fallbacks',async()=>{
 let source=fs.readFileSync(root+'/src/services/pokemonSprites.js','utf8').replace("import manifest from '@/data/pokemonSpriteManifest.json';",'const manifest='+JSON.stringify(manifest)+';').replace(/process.env.BASE_URL/g,JSON.stringify('/'));
 const s=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const p={data:{id:648},shiny:true};assert(s.pokemonSprite(p,{animated:true}).includes('/animated/shiny/front/648.webp?v='));s.setPokemonSpriteMotion({animationsEnabled:false});assert(s.pokemonSprite(p,{animated:true}).includes('/shiny/front/648.png?v='));s.setPokemonSpriteMotion({animationsEnabled:true});
 assert(s.pokemonSprite({...p,__battle:{formSpriteId:10018}}).includes('/shiny/front/10018.png'));
 assert(s.pokemonSprite({...p,__battle:{illusion:{id:25,shiny:false}}}).includes('/front/25.png'));
 const image={tagName:'IMG',src:s.pokemonSprite(p,{side:'back',animated:true})};s.pokemonSpriteFallback({target:image});assert(image.src.includes('/shiny/back/648.png?v='));s.pokemonSpriteFallback({target:image});assert(image.src.includes('/back/648.png?v='));s.pokemonSpriteFallback({target:image});assert(image.src.startsWith('data:image/svg+xml,'));
});

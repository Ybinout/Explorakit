// Offline UI reference: battle numbers remain owned by the game's move catalog.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function buildReference(){
 const source=require('../data/vendor/pokeapi/reference-texts.fr.json');
 const overrides=require('../data/game/pokemon_reference_overrides.fr.json');
 const moves=require('../data/game/moves.json'),abilities=require('../data/game/abilities.gen7.json').abilities;
 const output={source:{revision:source.revision,maximumVersionGroup:source.maximumVersionGroup},moves:{},abilities:{}};
 for(const move of moves){
  const description=overrides.moves[move.ename]||source.moves[move.ename]?.text;
  if(!description)throw Error('Missing French move description: '+move.ename);
  output.moves[move.ename]={type:move.type,category:move.combat?.damage_class||{phy:'physical',spe:'special',sta:'status'}[move.category],power:move.power??null,powerKind:move.combat?.power_type||null,accuracy:move.accuracy??null,pp:move.pp,description};
 }
 for(const ability of abilities){
  const description=overrides.abilities[ability.name]||source.abilities[ability.name]?.text;
  if(!description)throw Error('Missing French ability description: '+ability.name);
  output.abilities[ability.name]=description;
 }
 return output;
}
if(require.main===module){
 const reference=buildReference(),file=path.join(root,'vue-explorakit/src/data/pokemonReference.fr.json'),bytes=JSON.stringify(reference,null,2)+'\n';
 if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==bytes)throw Error('Pokemon reference is stale; run node scripts/generatePokemonReference.js');}
 else fs.writeFileSync(file,bytes);
 console.log(JSON.stringify({moves:Object.keys(reference.moves).length,abilities:Object.keys(reference.abilities).length,bytes:Buffer.byteLength(bytes),checked:process.argv.includes('--check')}));
}
module.exports={buildReference};

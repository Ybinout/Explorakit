const fs=require('node:fs'),path=require('node:path');
const names=require('../vue-explorakit/src/data/gameNames.fr.json');
fs.writeFileSync(path.resolve(__dirname,'../data/game/corruption_labels.fr.json'),JSON.stringify({moves:names.moves,abilities:names.abilities},null,2)+'\n');
const {registry}=require('../server/game/corruption/modules');
const file=path.resolve(__dirname,'../vue-explorakit/src/data/corruptionModules.json');
fs.writeFileSync(file,JSON.stringify(Object.fromEntries(registry),null,2)+'\n');
console.log(`${registry.size} module definitions exported.`);

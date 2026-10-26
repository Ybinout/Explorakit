const test=require('node:test'),assert=require('node:assert/strict');
const data=require('../vue-explorakit/src/data/pokemonReference.fr.json');
const {buildReference}=require('../scripts/generatePokemonReference');
const factory=async()=>{const {createPokemonReference}=await import('../vue-explorakit/src/services/pokemonReference.js');return createPokemonReference(data);};
test('every game move and ability has French text; battle numbers match the current game catalog',()=>{
 assert.deepEqual(buildReference(),data);const moves=require('../data/game/moves.json'),abilities=require('../data/game/abilities.gen7.json').abilities;
 assert.equal(Object.keys(data.moves).length,moves.length);assert.equal(Object.keys(data.abilities).length,abilities.length);
 for(const move of moves){const entry=data.moves[move.ename];assert.equal(entry.power,move.power??null);assert.equal(entry.accuracy,move.accuracy??null);assert.equal(entry.pp,move.pp);assert.equal(entry.type,move.type);assert(entry.description.trim().length>15);}
 for(const ability of abilities)assert(data.abilities[ability.name].trim().length>10,ability.name);
 assert.equal(data.moves['Sucker Punch'].power,80,'Use RiftMon power, not a different generation’s number');
 const source=require('../data/vendor/pokeapi/reference-texts.fr.json');assert.equal(source.language,'fr');for(const entry of [...Object.values(source.moves),...Object.values(source.abilities)])assert(entry.versionGroup<=18);
});
test('party moves preserve order, exhausted PP and status/fixed/variable power without mutating the Pokemon',async()=>{
 const reference=await factory(),p={level:23,abilities:['Water Gun','Growl','Night Shade','Fissure'],movePp:[0,11,3,2]},before=JSON.stringify(p);const list=reference.moves(p);
 assert.deepEqual(list.map(m=>m.name),p.abilities);assert.equal(list[0].powerLabel,'40');assert.equal(list[0].pp,0);assert.equal(list[0].maxPp,25);assert.equal(list[1].powerLabel,'—');assert.equal(list[1].damageClass,'status');assert.equal(list[2].powerLabel,'23 PV');assert(list[2].fixedDamage);assert.equal(list[3].powerLabel,'K.O.');assert.equal(JSON.stringify(p),before);
});
test('PC move details retain server PP/max PP and are enriched with the same effect descriptions',async()=>{
 const reference=await factory(),p={moves:['Flamethrower','Recover'],moveDetails:[{name:'Flamethrower',type:'Fire',damageClass:'special',power:90,accuracy:100,pp:0,maxPp:15},{name:'Recover',type:'Normal',damageClass:'status',power:null,accuracy:null,pp:6,maxPp:10}]},before=JSON.stringify(p);
 const list=reference.moves(p);assert.equal(list[0].pp,0);assert.match(list[0].description,/brûler/);assert.equal(list[1].pp,6);assert.equal(list[1].maxPp,10);assert.equal(list[1].powerLabel,'—');assert.equal(JSON.stringify(p),before);
 assert.deepEqual(reference.moves({moveDetails:p.moveDetails}),list);
});
test('fixed damage, lowercase legacy names, transformed PP and missing definitions have safe labels',async()=>{
 const reference=await factory();assert.equal(reference.moves({abilities:['dragon rage']})[0].powerLabel,'40 PV');
 assert.equal(reference.moves({abilities:['Grass Knot']})[0].powerLabel,'Variable');
 assert.equal(reference.moves({abilities:['Tackle'],movePp:[0],__battle:{transformed:true}})[0].maxPp,5);
 const [unknown]=reference.moves({abilities:['Ancienne capacité'],movePp:[0]});assert.equal(unknown.pp,0);assert.equal(unknown.maxPp,null);assert.equal(unknown.powerLabel,'—');assert.match(unknown.description,/indisponible/);
 assert.equal(reference.moves({abilities:[]}).length,0);assert.equal(reference.moves({abilities:Array(8).fill('Tackle')}).length,4);
});
test('talent descriptions use the actual passive ability and handle missing/legacy values',async()=>{
 const reference=await factory();assert.match(reference.abilityDescription(' Torrent '),/50 %/);assert.match(reference.abilityDescription('levitate'),/Sol/);assert.match(reference.abilityDescription('Speed Boost'),/fin de chaque tour/);assert.match(reference.abilityDescription(null),/Aucun talent/);assert.match(reference.abilityDescription('Inconnu'),/indisponible/);
});
test('all type badges retain readable ink contrast',async()=>{
 const {typeBadgeStyle}=await import('../vue-explorakit/src/services/pokemonTypes.js');
 for(const type of new Set(Object.values(data.moves).map(m=>m.type))){const s=typeBadgeStyle(type),hex=s['--pokemon-type-color'],v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4),l=v[0]*.2126+v[1]*.7152+v[2]*.0722;const ratio=s['--pokemon-type-ink']==='#ffffff'?1.05/(l+.05):(l+.05)/.05;assert(ratio>=4.5,type+': '+ratio);}
});

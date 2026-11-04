const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),op=require('../server/game/experienceExchange/operation'),lab=require('../server/game/experienceExchange/laboratory');
const entry=(level,id=94)=>{const pokemon=factory.create(id,level,true);return {source:'team',raw:{uuid:pokemon.uuid},pokemon};};
test('XP totale intervertie, niveau recalculé avec la courbe propre à chacun, aucun apprentissage ni évolution',()=>{
 const a=entry(20),b=entry(81);a.pokemon.currentHp=4;b.pokemon.currentHp=0;a.pokemon.status='burn';a.pokemon.movePp[0]=0;a.pokemon.pendingMoves=[{move:'Shadow Ball'}];a.pokemon.evolutionState={deferredLevel:40};a.pokemon.heldItem='life_orb';
 b.pokemon.experience+=123;const before=[a,b].map(e=>JSON.parse(JSON.stringify(e.pokemon))),result=op.offer(a,b);
 for(const [i,e]of [a,b].entries()){
  assert.equal(e.pokemon.experience,before[1-i].experience);assert.equal(e.pokemon.level,e.pokemon.calculateLevelFromExperience(before[1-i].experience));
  for(const key of ['uuid','iv','ev','nature','k','abilities','movePp','heldItem','passiveAbility','pendingMoves','evolutionState','status'])assert.deepEqual(e.pokemon[key],before[i][key],key);
 }
 assert.equal(a.pokemon.currentHp,4);assert.equal(b.pokemon.currentHp,0);assert.equal(result.price,1000000);assert.equal(result.first.level,20);assert.equal(result.after[0].level,81);
});
test('Baisse de niveau : PV plafonnés, statistiques permanentes recalculées, aucun soin',()=>{
 const a=entry(90),b=entry(5),p=a.pokemon,old=p.maxHp;p.currentHp=old;p.currentSpeed=1;
 const result=op.changes(p,b.pokemon.experience);assert(p.maxHp<old);assert.equal(p.currentHp,p.maxHp);assert.equal(p.currentSpeed,p.speed);assert.equal(result.current_attack,p.attack);
});
test('Conditions : espèce, UUID distinct, expérience différente, œuf et XP invalide',()=>{
 const a=entry(20),b=entry(30);assert.throws(()=>op.validate(a,entry(20,9)),/espèce/);assert.throws(()=>op.validate(a,a),/différents/);assert.throws(()=>op.validate(a,entry(20)),/même expérience/);assert.throws(()=>op.validate(a,null),/disponible/);
 b.raw.isEgg=true;assert.throws(()=>op.validate(a,b),/Œuf/);delete b.raw.isEgg;b.pokemon.experience=Infinity;assert.throws(()=>op.validate(a,b),/expérience/);
});
test('Même espèce et courbes sauvegardées distinctes : échanger l’XP, pas le niveau',()=>{
 const a=entry(20),b=entry(50);a.pokemon.experienceRate*=2;const xp=b.pokemon.experience,level=b.pokemon.level;op.offer(a,b);assert.equal(a.pokemon.experience,xp);assert.notEqual(a.pokemon.level,level);
});
test('La signature détecte aussi les changements d’objet, de place ou de métadonnée',()=>{
 const a=entry(20),before=op.fingerprint(a);a.raw.held_item='leftovers';assert.notEqual(before,op.fingerprint(a));const next=op.fingerprint(a);a.source='box';a.box=3;a.slot=4;assert.notEqual(next,op.fingerprint(a));
});
test('Laboratoire : entrée existante accessible, mobilier bloqué, autre maison inchangée',()=>{
 const maps=require('../server/game/world/mapRepository'),original=maps.readMap('gen_maison2'),data=maps.readMap(lab.MAP),coll=data.layers.find(l=>l.name==='coll').data,changes=data.layers.find(l=>l.name==='change').data;
 assert.notStrictEqual(data,original);assert.strictEqual(maps.readMap('gen_maison2'),original);assert.equal(coll[16*28+13],0);assert.equal(changes[17*28+13],1);assert.equal(changes[17*28+14],1);assert.equal(coll[8*28+14],1);assert.equal(coll[10*28+14],0);assert.equal(changes.filter(Boolean).length,2);
 assert(lab.nearby({currentmap:lab.MAP,x:14*32+16,y:10*32+16}));assert(!lab.nearby({currentmap:'gen_maison2',x:464,y:336}));
 const actors=JSON.parse(require('fs').readFileSync('data/game/pnjs.jsonc'));const scientist=actors.pnjs.find(p=>p.name==='rochebrume_scientist');assert(scientist.block);assert.equal(scientist.map,lab.MAP);
});
test('La disponibilité du service partage les blocages de l’indicateur global',()=>{
 const available=require('../server/game/world/interactionTarget').available,p={currentmap:lab.MAP,x:464,y:336};assert(available({player:p}));for(const extra of[{blocked:true},{player:{...p,inbattle:true}},{player:{...p,inventoryBusy:true}}])assert(!available({player:p,...extra}));
});
function handlerFixture(store){const handlers=new Map(),events=[],socket={on:(event,fn)=>handlers.set(event,fn),emit:(event,data)=>events.push({event,data})},player={currentmap:lab.MAP,x:464,y:336,equipe:{pokemons:[]}},other={...player},state={canUse:true,canInteract:true};
 const handler=require('../server/realtime/handlers/experienceExchangeHandlers').registerExperienceExchangeHandlers({socket,userId:123,getPlayer:()=>player,getPeers:()=>[player,other],canUse:()=>state.canUse,canInteract:()=>state.canInteract,store});
 return {player,other,state,handler,events,call:async(event,data)=>{let reply;await handlers.get('experienceExchange:'+event)(data,r=>{reply=r;});return reply;}};
}
test('Réseau : proximité, combat, transition, inventaire et tournoi sont vérifiés avant tout accès SQL',async()=>{
 let calls=0;const f=handlerFixture({open:async()=>{calls++;return{};}});for(const [key,value]of[['inbattle',true],['inventoryBusy',true],['superTournamentActive',true],['currentmap','ville4']]){const old=f.player[key];f.player[key]=value;assert.equal((await f.call('open',{})).success,false);f.player[key]=old;}
 f.state.canUse=false;assert.equal((await f.call('open',{})).success,false);assert.equal(calls,0);f.state.canInteract=true;assert(await f.handler.interact());assert.equal(calls,1);
});
test('Réseau : inventaires verrouillés pendant SQL, équipe publiée après commit, erreur libère le verrou',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;}),f=handlerFixture({exchange:()=>pending});const call=f.call('confirm',{});assert(f.player.inventoryBusy);assert(f.other.inventoryBusy);assert.equal(f.events.length,0);resolve({equipe:{pokemons:[{uuid:'committed'}]},money:7});const result=await call;assert(result.success);assert.equal(f.player.equipe.pokemons[0].uuid,'committed');assert.equal(f.player.inventoryBusy,false);assert.equal(f.other.inventoryBusy,false);assert.deepEqual(f.events.map(e=>e.event),['teamStateChanged','experienceExchange:wallet']);
 const g=handlerFixture({exchange:async()=>{throw Object.assign(Error('storage'),{code:'SQL_CONNECTION_LOST'});}}),response=await g.call('confirm',{});assert.equal(response.success,false);assert.equal(response.uncertain,true);assert.equal(g.player.inventoryBusy,false);assert.equal(g.events.length,0);
});

const test=require('node:test'),assert=require('node:assert/strict');
const r=require('../server/game/whitepeak/rules'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
test('the full visible podium footprint is detected at the avatar feet, with a shared frontend layout',()=>{
 const fs=require('node:fs'),layout=require('../data/game/whitepeak_layout.json');
 assert.deepEqual(layout,require('../vue-explorakit/src/data/whitepeakLayout.json'));
 for(const [x,y,wanted]of[[240,224,0],[320,256,0],[272,208,0],[304,288,0],[560,240,1],[624,272,1],[448,260,-1],[208,180,-1]])assert.equal(r.podium({currentmap:r.HALL,x,y}),wanted,`${x},${y}`);
 assert.equal(r.podium({currentmap:'start',x:277,y:242}),-1);
 const source=fs.readFileSync(require('node:path').join(__dirname,'../vue-explorakit/src/services/whitepeakPodiums.js'),'utf8').replace(/^import .*;\n/m,'').replace(/export /g,'');
 const {occupiedPodiums}=new Function('layout',source+';return {occupiedPodiums};')(layout);
 for(let x=0;x<896;x+=16)for(let y=0;y<640;y+=16){const p={currentmap:r.HALL,x,y},pad=r.podium(p);assert.deepEqual(occupiedPodiums({a:p}),[pad===0,pad===1]);}
});
test('fixed levels raise and lower every battle clone, with matching XP/statistics and no Adventure change',()=>{
 const Pokemon=require('../server/game/models/Pokemon');
 for(const level of[25,50,75,100]){
  const team=[factory.create(94,90,true),factory.create(9,12,true),factory.create(373,150,true)],before=codec.encode(team);
  const copies=r.battleCopy({id:'a'},team,r.settings({level})).equipe.pokemons;
  for(const p of copies){assert.equal(p.level,level);assert.equal(p.calculateLevelFromExperience(p.experience),level);
   const q=new Pokemon(p.data.id,p.name,null,p.experience,p.iv,p.nature,p.k,p.ev,p.experienceRate);
   for(const key of['level','maxHp','attack','defense','specialAttack','specialDefense','speed'])assert.equal(p[key],q[key],key);
   assert.equal(p.currentHp,p.maxHp);
  }
  assert.deepEqual(codec.encode(team),before);
 }
});
test('European roulette covers 37 distinct pockets and applies zero, exact and simple payouts',()=>{
 assert.equal(new Set(r.WHEEL).size,37);assert.equal(r.RED.size,18);
 for(let n=0;n<=36;n++){assert.equal(r.payout({choice:{kind:'number',number:n},amount:100},n),3600);assert.equal(r.payout({choice:{kind:'number',number:(n+1)%37},amount:100},n),0);}
 for(const kind of ['red','black','odd','even','low','high']){assert.equal(r.payout({choice:{kind},amount:100},0),0);assert.equal(Array.from({length:37},(_,n)=>r.payout({choice:{kind},amount:100},n)).filter(Boolean).length,18);}
 assert.throws(()=>r.choice({kind:'number',number:37}));assert.throws(()=>r.payout({choice:{kind:'red'},amount:-100},7));
});
test('rule combinations validate inputs and enforce unique held items per team only when enabled',()=>{
 const config=r.settings({level:50,uniqueItems:true,money:10000,pokemonStake:true});assert.deepEqual(config,{level:50,legendaryLimit:true,uniqueItems:true,money:10000,pokemonStake:true});
 const team=[factory.create(94,100,true),factory.create(9,50,true)];team.forEach(p=>p.heldItem='leftovers');assert.throws(()=>r.validateTeam(team,config),/même objet/);assert.doesNotThrow(()=>r.validateTeam(team,r.settings()));
 for(const level of [0,40,101,'50',NaN])assert.throws(()=>r.settings({level}));for(const money of [-1,1.5,1000001,Infinity])assert.throws(()=>r.settings({money}));assert.throws(()=>r.settings({uniqueItems:'false'}));
});
test('fixed-level duels recalculate a healed clone and never rewrite Adventure identity, resources or order',()=>{
 const team=[factory.create(94,87,true),factory.create(9,12,true)];team[0].heldItem='choice_scarf';team[0].currentHp=1;team[0].movePp[0]=0;team[0].status='burn';const before=codec.encode(team);
 const normalized=r.battleCopy({id:'a',username:'Alice'},team,r.settings({level:50}));assert(normalized.equipe.pokemons.every(p=>p.level===50&&p.currentHp===p.maxHp&&p.status==='normal'));assert.equal(normalized.equipe.pokemons[0].uuid,team[0].uuid);assert.equal(normalized.equipe.pokemons[0].heldItem,'choice_scarf');assert.notEqual(normalized.equipe.pokemons[0].attack,team[0].attack);assert.deepEqual(normalized.equipe.pokemons.map(p=>p.iv),team.map(p=>p.iv));assert.deepEqual(codec.encode(team),before);assert.equal(normalized.userId,null);
 const free=r.battleCopy({id:'a'},team,r.settings({level:null}));assert.deepEqual(free.equipe.pokemons.map(p=>p.level),[87,12]);assert.deepEqual(codec.encode(team),before);
});

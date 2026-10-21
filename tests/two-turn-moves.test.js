const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const twoTurn=require('../server/game/battle/twoTurnMoves'),factory=require('../server/game/drift/pokemonFactory');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(moves=['Dig','Tackle'],id=19){const p=factory.create(id,25,true);p.passiveAbility=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.currentHp=p.maxHp=1000;return p;}
function hit(name,a,b,f=engine.createBattleState(),extra={}){return engine.useattack(name,a,b,{battleState:f,attackerSide:f.sides.player,defenderSide:f.sides.enemy,attackerTeam:[a],defenderTeam:[b],...extra});}
function random(value,work){const old=Math.random;try{Math.random=()=>value;return work();}finally{Math.random=old;}}

test('all catalogued two-turn moves prepare without damage/effects, release once and spend one PP',()=>random(.5,()=>{
 for(const name of Object.keys(twoTurn.RULES)){
  const a=mon([name,'Tackle']),b=mon([],63),f=engine.createBattleState();a.movePp[0]=1;
  const start=hit(name,a,b,f);assert.equal(start.phase,'prepare',name);assert.equal(start.damage,0,name);assert.equal(b.currentHp,1000,name);
  assert.equal(a.movePp[0],0,name);assert.equal(resources.getChargingMove(a),name);assert.deepEqual(resources.getUsableMoveIndexes(a,f),[0]);
  assert.equal(engine.canSwitchOut(a,b,f),false);assert.deepEqual(require('../server/game/drift/colosseumAI').chooseAction({team:[a],opponent:b,field:f,wave:16,memory:{},version:5}),{action:'attack',number:0});f.turn++;
  const release=hit('Tackle',a,b,f);assert.equal(release.moveName,name);assert.equal(release.phase,'strike');assert.equal(a.movePp[0],0);assert.equal(a.movePp[1],35);
  assert.equal(resources.getChargingMove(a),null);assert.equal(a.__battle.semiInvulnerable,null);assert.equal(engine.canSwitchOut(a,b,f),true);
  if(name==='Geomancy')assert.equal(a.__battle.statStages.specialAttack,2);else assert(release.damage>0,name);
 }
}));

test('semi-invulnerable moves avoid ordinary damage/status and always-hit moves; named counters and No Guard/Lock-On work',()=>random(.5,()=>{
 for(const [name,counter]of [['Dig','Earthquake'],['Fly','Gust'],['Dive','Surf'],['Bounce','Twister']]){
  const a=mon([name]),b=mon(['Tackle','Swift','Growl',counter]),f=engine.createBattleState();hit(name,a,b,f);
  for(const ordinary of ['Tackle','Swift','Growl']){const r=hit(ordinary,b,a,f);assert(r.missed,`${name}/${ordinary}`);assert.equal(r.damage,0);}
  const normal=mon();const base=hit(counter,b,normal,f).damage,boosted=hit(counter,b,a,f).damage;assert(boosted>=base*2-1,`${name}/${counter}`);
  b.passiveAbility='No Guard';assert(hit('Tackle',b,a,f).damage>0);b.passiveAbility=null;
  engine.ensureBattleData(b).lockOnTurns=2;b.__battle.lockOnTargetId=a.uuid;assert(hit('Tackle',b,a,f).damage>0);
 }
 const a=mon(['Fly']),b=mon(['Thunder','Hurricane','Sky Uppercut']),f=engine.createBattleState();hit('Fly',a,b,f);
 for(const n of b.abilities)assert(hit(n,b,a,f).damage>0,n);
}));

test('preparation is cancellable by status, grounding, faint and switch; no stale invisibility or second PP charge',()=>random(.5,()=>{
 for(const name of ['Dig','Fly','Dive','Phantom Force','Solar Beam']){
  const a=mon([name]),b=mon(),f=engine.createBattleState();hit(name,a,b,f);a.status='paralyze';f.turn++;
  const pp=a.movePp[0];const r=random(0,()=>hit(name,a,b,f));assert.equal(r.damage,0);assert.equal(a.__battle.chargeMove,null);assert.equal(a.__battle.semiInvulnerable,null);assert.equal(a.movePp[0],pp);
  a.status='normal';hit(name,a,b,f);const party=[a,mon()];assert(switchPokemonByIndex(party,1));assert.equal(a.__battle,undefined);
 }
 for(const counter of ['Gravity','Smack Down']){
  const a=mon(['Fly'],16),b=mon([counter]),f=engine.createBattleState();hit('Fly',a,b,f);const pp=a.movePp[0];
  const r=hit(counter,b,a,f);assert(r.success,counter);assert.equal(a.__battle.chargeMove,null);assert.equal(a.__battle.semiInvulnerable,null);
  assert.equal(hit('Fly',a,b,f).damage,0);assert.equal(a.movePp[0],pp);f.turn++;
  if(counter==='Gravity')assert(hit('Fly',a,b,f).blocked);else assert.equal(hit('Fly',a,b,f).phase,'prepare');
 }
 const a=mon(['Dig']),b=mon(['Earthquake']);hit('Dig',a,b);a.currentHp=1;hit('Earthquake',b,a);assert.equal(a.currentHp,0);assert.equal(a.__battle.chargeMove,null);
}));

test('sun skips Solar Beam charge, rain weakens its damage, suppressed weather does neither; Skull Bash boosts once and Geomancy on release',()=>random(.5,()=>{
 const a=mon(['Solar Beam']),b=mon(),sun=engine.createBattleState();sun.weather={kind:'sun'};
 assert(hit('Solar Beam',a,b,sun).damage>0);assert.equal(resources.getChargingMove(a),null);
 const dry=engine.createBattleState();hit('Solar Beam',a,b,dry);const normal=hit('Solar Beam',a,b,dry).damage;
 const wet=engine.createBattleState();wet.weather={kind:'rain'};hit('Solar Beam',a,b,wet);assert(hit('Solar Beam',a,b,wet).damage<=normal/2+1);
 b.passiveAbility='Cloud Nine';assert.equal(hit('Solar Beam',a,b,sun).phase,'prepare');hit('Solar Beam',a,b,sun);b.passiveAbility=null;
 const skull=mon(['Skull Bash']);hit('Skull Bash',skull,b);assert.equal(skull.__battle.statStages.defense,1);hit('Skull Bash',skull,b);assert.equal(skull.__battle.statStages.defense,1);
 const geo=mon(['Geomancy']);hit('Geomancy',geo,b);assert.equal(geo.__battle.statStages.speed,0);hit('Geomancy',geo,b);assert.equal(geo.__battle.statStages.speed,2);
}));

test('Phantom/Shadow Force disappear then bypass Protect, but not type immunity; secondaries happen only on release',()=>random(0,()=>{
 for(const name of ['Phantom Force','Shadow Force']){
  const a=mon([name]),b=mon(['Protect'],63);hit(name,a,b);assert(hit('Tackle',b,a).missed);engine.ensureBattleData(b).protect=true;
  assert(hit(name,a,b).damage>0);assert.equal(b.__battle.protect,false);
  const normal=mon();hit(name,a,normal);assert.equal(hit(name,a,normal).damage,0);
 }
 for(const name of ['Bounce','Freeze Shock','Ice Burn']){const a=mon([name]),b=mon();hit(name,a,b);assert.equal(b.status,'normal');hit(name,a,b);assert.equal(b.status,name==='Ice Burn'?'burn':'paralyze');}
}));

test('Sky Drop carries and releases one target, stops its action, refuses heavy/substitute targets and releases on interruption',()=>random(.5,()=>{
 const a=mon(['Sky Drop']),b=mon(),f=engine.createBattleState();hit('Sky Drop',a,b,f);assert.equal(b.__battle.skyDropBy,a.uuid);assert(hit('Tackle',b,a,f).blocked);assert.equal(engine.canSwitchOut(b,a,f),false);
 f.turn++;assert(hit('Sky Drop',a,b,f).damage>0);assert.equal(b.__battle.skyDropBy,undefined);assert(hit('Tackle',b,a,f).blocked);f.turn++;assert(hit('Tackle',b,a,f).damage>0);
 for(const id of [95,208]){const heavy=mon([],id);assert(hit('Sky Drop',a,heavy,f).blocked);}
 const flying=mon([],16);hit('Sky Drop',a,flying,f);f.turn++;assert.equal(hit('Sky Drop',a,flying,f).effectiveness,0);
 const carried=mon(),carrier=mon(['Sky Drop']);hit('Sky Drop',carrier,carried,f);carrier.currentHp=1;carrier.status='poison';engine.processEndOfRound(carrier,carried,f.sides.player,f.sides.enemy,f);assert.equal(carried.__battle.skyDropBy,undefined);assert.equal(carried.__battle.semiInvulnerable,null);
 const carried2=mon(),carrier2=mon(['Sky Drop']);hit('Sky Drop',carrier2,carried2,f);carried2.currentHp=1;carried2.status='poison';engine.processEndOfRound(carrier2,carried2,f.sides.player,f.sides.enemy,f);assert.equal(carrier2.__battle.chargeMove,null);assert.equal(carrier2.__battle.semiInvulnerable,null);
 const locked=mon(),lockUser=mon(['Sky Drop']);hit('Sky Drop',lockUser,locked,f);const roarer=mon(['Roar']);roarer.passiveAbility='No Guard';assert.equal(hit('Roar',roarer,lockUser,f).forceSwitch,false);
 const stale=mon();hit('Sky Drop',a,stale,f);const replacement=mon();f.turn++;assert.equal(hit('Sky Drop',a,replacement,f).blocked,true);assert.equal(replacement.currentHp,1000);
 const c=mon();hit('Sky Drop',a,c,f);f.turn++;a.status='paralyze';random(0,()=>hit('Sky Drop',a,c,f));assert.equal(c.__battle.skyDropBy,undefined);assert.equal(c.__battle.semiInvulnerable,null);
}));

for(const mode of ['rift','colosseum'])test(`${mode}: real battle automatically continues last-PP Dig and checkpoint preserves preparation`,()=>random(.5,()=>{
 const a=mon(['Dig']),b=mon(['Tackle']);a.currentSpeed=999;a.movePp=[1];
 const p={userId:1,currentmap:'ville1_arene',run:{mode},equipe:{pokemons:[a]},drifts:[],equipped:[],items:{},chain:0};
 const enemy={npc:true,equipe:{pokemons:[b]},drifts:[],equipped:[],chain:0},events=[];
 const battle=new DriftBattle(p,enemy,{emit:(_p,event,payload)=>events.push({event,payload:structuredClone(payload)}),paceMs:0});
 assert(battle.action(p,{action:'attack',number:0,turnId:battle.token}));assert.equal(b.currentHp,1000);assert.equal(a.currentHp,1000);assert.equal(a.__battle.semiInvulnerable,'underground');
 const restored=codec.decode(codec.encode(battle));restored.emit=(_p,event,payload)=>events.push({event,payload:structuredClone(payload)});restored.onUpdate=null;restored.now=Date.now;restored.random=Math.random;
 const requests=events.filter(e=>e.event==='requestAction').length;restored.tick();assert.equal(restored.active(0).__battle.chargeMove,null);assert(restored.active(1).currentHp<1000);assert.equal(restored.active(0).movePp[0],0);
 assert.equal(events.filter(e=>e.event==='requestAction').length,requests);assert(events.some(e=>e.event==='battleMoveAnimation'&&e.payload.phase==='prepare'));assert(events.some(e=>e.event==='battleMoveAnimation'&&e.payload.phase==='strike'));
 battle.finish(null,'fled');restored.finish(null,'fled');
}));

test('Rift PvP: locked release waits for the other player, cannot be replaced with another action and keeps real move priority',()=>random(.5,()=>{
 const make=(id)=>({userId:id,equipe:{pokemons:[mon(['Fly','Quick Attack'])]},drifts:[],equipped:[],items:{},chain:0});const p=make(1),q=make(2);q.equipe.pokemons[0].abilities=['Tackle'];q.equipe.pokemons[0].movePp=[35];p.equipe.pokemons[0].currentSpeed=999;
 const battle=new DriftBattle(p,q,{type:'pvp',emit:()=>{},paceMs:0});battle.action(p,{action:'attack',number:0,turnId:battle.token});battle.action(q,{action:'attack',number:0,turnId:battle.token});
 battle.tick();assert(battle.pending.has(p));assert(!battle.action(p,{action:'attack',number:1,turnId:battle.token}));assert(battle.action(q,{action:'attack',number:0,turnId:battle.token}));assert.equal(p.equipe.pokemons[0].movePp[0],14);assert.equal(p.equipe.pokemons[0].movePp[1],30);
 battle.finish(null,'forfeit');
}));

test('battle text translates the four Morphéo moves and longer names once, with readable bounded trainer timing',async()=>{
 const {createBattleTextLocalizer,trainerSpeechDuration}=await import('../vue-explorakit/src/services/battleText.js');const names=require('../vue-explorakit/src/data/gameNames.fr.json').moves,localize=createBattleTextLocalizer(names);
 for(const n of ['Weather Ball','Thunder','Ice Beam','Rain Dance'])assert.equal(localize(`Morphéo utilise ${n} !`),`Morphéo utilise ${names[n]} !`);
 assert.equal(localize('Thunder Wave puis Thunder !'),'Cage Éclair puis Fatal-Foudre !');assert.equal(localize('Restant, Thunderous, Flygon'),'Restant, Thunderous, Flygon');
 assert.equal(localize('Weather Ball','en'),'Weather Ball');assert.equal(localize('Ball’Météo et Tunnel'),'Ball’Météo et Tunnel');assert.equal(trainerSpeechDuration('Court'),6000);assert.equal(trainerSpeechDuration('x'.repeat(1000)),10000);
});

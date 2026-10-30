const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const resources=require('../server/game/battle/battleResources'),ai=require('../server/game/battle/humanTrainerAI');
const model=require('../server/game/battle/humanTrainerModel'),{switchPokemonByIndex}=require('../server/game/battle/battleTeam');
function mon(id=143,moves=['Splash'],extra={}){
 const p=factory.create(id,50,true);Object.assign(p,{uuid:`review-${id}`,type1:'Normal',type2:null,currentHp:1000,maxHp:1000,
  attack:100,currentAttack:100,defense:100,currentDefense:100,specialAttack:100,currentSpecialAttack:100,specialDefense:100,currentSpecialDefense:100,speed:100,currentSpeed:100,
  passiveAbility:null,heldItem:null,status:'normal',abilities:moves,movePp:moves.map(resources.getMaxMovePp)},extra);engine.ensureBattleData(p);return p;
}
function fixed(work){const random=Math.random;Math.random=()=>.5;try{return work();}finally{Math.random=random;}}
function fixture(move,own={},foe={},side='player'){
 const a=mon(143,[move,'Splash'],own),b=mon(9,['Splash'],foe),field=engine.createBattleState();
 const cast=(name=move,p=a,q=b)=>engine.useattack(name,p,q,{battleState:field,attackerSide:field.sides[p===a?side:side==='player'?'enemy':'player'],defenderSide:field.sides[p===a?(side==='player'?'enemy':'player'):side],attackerTeam:[p],defenderTeam:[q]});
 return {a,b,field,cast};
}
const powers=[
 ['Eruption',{}, {},150],['Eruption',{currentHp:500},{},75],['Eruption',{currentHp:1},{},1],
 ['Water Spout',{currentHp:500},{},75],['Water Spout',{currentHp:1},{},1],
 ['Brine',{}, {currentHp:500},130],['Brine',{}, {currentHp:501},65],
 ['Hex',{}, {status:'burn'},130],['Hex',{}, {status:'poison'},130],['Hex',{}, {status:'normal',__battle:{confusionTurns:3}},65],
 ['Venoshock',{}, {status:'badly_poison'},130],['Venoshock',{}, {status:'burn'},65],
 ['Acrobatics',{}, {},110],['Acrobatics',{heldItem:'leftovers'}, {},55],
 ['Smelling Salts',{}, {status:'paralyze'},140],['Smelling Salts',{}, {},70],
 ['Wake-Up Slap',{}, {status:'sleep'},140],['Wake-Up Slap',{}, {},70],
 ['Wake-Up Slap',{}, {passiveAbility:'Comatose'},140],
];
for(const side of ['player','enemy'])for(const[name,own,foe,power]of powers)test(`${side}: ${name} conditional power ${power} ${JSON.stringify(own)} ${JSON.stringify(foe)}`,()=>fixed(()=>{
 const {a,b,cast}=fixture(name,own,foe,side),move=engine.getMoveByName(name);
 const expected=engine.calculateDamage(structuredClone(a),structuredClone(b),{...move,ename:'Review fixed-power oracle',power});
 const hp=b.currentHp,result=cast();assert.equal(result.damage,Math.min(hp,expected));assert.equal(a.movePp[0],move.pp-1);
}));
for(const name of ['Wake-Up Slap','Smelling Salts'])test(`${name} cures only a real HP hit, after its boosted damage`,()=>fixed(()=>{
 const status=name==='Wake-Up Slap'?'sleep':'paralyze';
 for(const defense of ['normal','substitute','protect','immune']){
  const {a,b,cast}=fixture(name,{}, {status});
  if(defense==='substitute')b.__battle.substituteHp=900;if(defense==='protect')b.__battle.protect=true;if(defense==='immune')b.type1='Ghost';
  const r=cast();assert.equal(b.status,defense==='normal'?'normal':status);if(defense!=='normal')assert.equal(r.damage,0);
 }
}));
for(const name of ['Revenge','Avalanche'])test(`${name} doubles only after a hit by this target during this turn`,()=>fixed(()=>{
 const damage=[];for(const condition of ['none','current','previous','other-source']){
  const {a,b,field,cast}=fixture(name);Object.assign(a.__battle,{lastDamageTaken:30,lastDamageSource:condition==='other-source'?'another':b.uuid,lastDamageTurn:condition==='previous'?0:condition==='none'?-1:1});
  const move=engine.getMoveByName(name),power=condition==='current'?120:60;
  const expected=engine.calculateDamage(structuredClone(a),structuredClone(b),{...move,ename:'Oracle',power});damage.push(cast().damage);assert.equal(damage.at(-1),expected);
 }
 assert(damage[1]>damage[0]);
}));
test('Payback doubles after an actual opposing move, but not before it or after switching in',()=>fixed(()=>{
 for(const acted of [false,true]){const {a,b,field,cast}=fixture('Payback');if(acted)cast('Splash',b,a);const m=engine.getMoveByName('Payback');assert.equal(cast().damage,engine.calculateDamage(a,b,{...m,ename:'Oracle',power:acted?100:50}));}
}));
test('Assurance recognizes current damage and does not reuse previous-turn damage',()=>fixed(()=>{
 for(const turn of [0,1]){const {a,b,cast}=fixture('Assurance');Object.assign(b.__battle,{lastDamageTurn:turn,lastDamageTaken:5});const m=engine.getMoveByName('Assurance');assert.equal(cast().damage,engine.calculateDamage(a,b,{...m,ename:'Oracle',power:turn===1?120:60}));}
}));
for(const name of ['Psyshock','Psystrike','Secret Sword'])test(`${name} uses Sp. Attack against Defense and the special screen`,()=>fixed(()=>{
 const f=fixture(name,{}, {defense:50,currentDefense:50,specialDefense:300,currentSpecialDefense:300});
 const reference={...f.b,specialDefense:50,currentSpecialDefense:50};const expected=engine.calculateDamage(f.a,reference,{...engine.getMoveByName(name),ename:'Oracle'});
 assert.equal(f.cast().damage,expected);
 const reflect=fixture(name),light=fixture(name);reflect.field.sides.enemy.screens.reflectTurns=5;light.field.sides.enemy.screens.lightScreenTurns=5;
 assert(reflect.cast().damage>light.cast().damage);
}));
test('Foul Play borrows target Attack/stages, while Choice Band belongs to its user',()=>fixed(()=>{
 const f=fixture('Foul Play',{attack:10,currentAttack:10,heldItem:'choice_band'},{attack:300,currentAttack:300});f.b.__battle.statStages.attack=2;
 const reference=structuredClone(f.a);reference.attack=reference.currentAttack=300;reference.__battle.statStages.attack=2;
 const expected=engine.calculateDamage(reference,f.b,{...engine.getMoveByName('Foul Play'),ename:'Oracle'});assert.equal(f.cast().damage,expected);
 const weak=fixture('Foul Play',{attack:999,currentAttack:999},{attack:10,currentAttack:10});assert(weak.cast().damage<expected);
}));
for(const name of ['Chip Away','Sacred Sword'])test(`${name} ignores defensive stages in either direction`,()=>fixed(()=>{
 const baseline=fixture(name).cast().damage;for(const stage of [-6,6]){const f=fixture(name);f.b.__battle.statStages.defense=stage;assert.equal(f.cast().damage,baseline);}
}));
test('critical hits ignore negative offense and positive defense but preserve beneficial stages',()=>fixed(()=>{
 const baseline=fixture('Frost Breath'),clean=baseline.cast();assert(clean.critical);
 const f=fixture('Frost Breath');f.a.__battle.statStages.specialAttack=-6;f.b.__battle.statStages.specialDefense=6;assert.equal(f.cast().damage,clean.damage);
 const boosted=fixture('Frost Breath');boosted.a.__battle.statStages.specialAttack=2;boosted.b.__battle.statStages.specialDefense=-2;assert(boosted.cast().damage>clean.damage);
 const armored=fixture('Frost Breath',{}, {passiveAbility:'Battle Armor'});armored.a.__battle.statStages.specialAttack=-6;assert(!armored.cast().critical);
}));
for(const [type,expected]of [['Water',2],['Dragon',2],['Water/Dragon',4],['Water/Steel',1]])test(`Freeze-Dry effectiveness against ${type} is ${expected}`,()=>fixed(()=>{
 const f=fixture('Freeze-Dry',{}, {type1:type.split('/')[0],type2:type.split('/')[1]||null});assert.equal(f.cast().effectiveness,expected);
}));
test('Freeze-Dry can pass Wonder Guard on Water and Flying Press combines its two matchups',()=>fixed(()=>{
 const f=fixture('Freeze-Dry',{}, {type1:'Water',passiveAbility:'Wonder Guard'});assert(f.cast().damage>0);
 for(const [type,effectiveness]of [['Grass',2],['Rock',1],['Bug',1],['Ghost',0]]){const f=fixture('Flying Press',{}, {type1:type});assert.equal(f.cast().effectiveness,effectiveness);}
}));
for(const name of ['Wring Out','Crush Grip'])test(`${name} never exceeds 120 power and has a floor of 1`,()=>{
 const {a,b}=fixture(name),move=engine.getMoveByName(name);for(const[hp,power]of [[1000,120],[500,60],[1,1]]){b.currentHp=hp;assert.equal(engine.getSpecialMoveResolution(move,a,b).power,power);}
});
test('Punishment does not count Focus Energy as an offensive/defensive stat boost',()=>{
 const {a,b}=fixture('Punishment');b.__battle.statStages.critical=3;b.__battle.statStages.attack=2;assert.equal(engine.getSpecialMoveResolution(engine.getMoveByName('Punishment'),a,b).power,100);
});
test('Dream Eater fails awake, drains a sleeping target and obeys Comatose',()=>fixed(()=>{
 for(const asleep of [false,true]){const f=fixture('Dream Eater',{currentHp:300},{status:asleep?'sleep':'normal'}),r=f.cast();assert.equal(r.damage>0,asleep);assert.equal(f.a.movePp[0],14);assert.equal(f.a.currentHp>300,asleep);}
 const f=fixture('Dream Eater',{}, {passiveAbility:'Comatose'});assert(f.cast().damage>0);
}));
test('Focus Punch fails after incoming attack damage but works if the target used a status move',()=>fixed(()=>{
 for(const incoming of ['Tackle','Growl']){const f=fixture('Focus Punch');f.b.abilities=[incoming];f.b.movePp=[35];f.cast(incoming,f.b,f.a);assert.equal(f.cast().damage>0,incoming==='Growl');assert.equal(f.a.movePp[0],19);}
}));
test('Synchronoise requires at least one shared current type',()=>fixed(()=>{
 for(const shared of [false,true]){const f=fixture('Synchronoise',{type1:'Psychic'},{type1:shared?'Psychic':'Water'});assert.equal(f.cast().damage>0,shared);}
}));
test('Last Resort requires other move use, and resets its requirement on switching',()=>fixed(()=>{
 const f=fixture('Last Resort');assert(!f.cast().success);f.cast('Splash');assert(f.cast().damage>0);const team=[f.a,mon(1)];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);assert(!f.cast().success);
 const single=fixture('Last Resort');single.a.abilities=['Last Resort'];single.a.movePp=[5];assert(!single.cast().success);
}));
test('Growth doubles both stages only in effective sunlight',()=>fixed(()=>{
 for(const suppression of [false,true]){const f=fixture('Growth');f.field.weather={kind:'sun',turns:5};if(suppression)f.b.passiveAbility='Cloud Nine';f.cast();assert.equal(f.a.__battle.statStages.attack,suppression?1:2);assert.equal(f.a.__battle.statStages.specialAttack,suppression?1:2);}
}));
test('Acupressure chooses a non-maxed stat including accuracy/evasion, and fails when all are capped',()=>fixed(()=>{
 const f=fixture('Acupressure');for(const stat of ['attack','defense','specialAttack','specialDefense','speed','accuracy'])f.a.__battle.statStages[stat]=6;
 assert(f.cast().success);assert.equal(f.a.__battle.statStages.evasion,2);f.a.__battle.statStages.evasion=6;assert(!f.cast().success);
}));
function options(a,b,reserve){const field=engine.createBattleState();return {team:[a],opponentTeam:reserve?[b,reserve]:[b],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{habits:{turns:10,switches:10,moves:{}}},round:1,skill:1};}
for(const name of ['Return','Frustration','Grass Knot','Gyro Ball'])test(`AI gives ${name} the same immunity penalty as an equivalent fixed-power move`,()=>{
 const type=name==='Grass Knot'?'Flying':name==='Gyro Ball'?'Water':'Ghost',a=mon(128,[name,'Waterfall'],{currentHp:1}),b=mon(94,['Sludge Bomb'],{type1:type}),reserve=mon(143,['Tackle']);
 if(name==='Grass Knot')b.passiveAbility='Sap Sipper';if(name==='Gyro Ball')b.passiveAbility='Wonder Guard';
 const o=options(a,b,reserve),move=engine.getMoveByName(name),power=move.power;const before=JSON.stringify(o),normal=ai.analyse(o);
 try{move.power=102;assert.deepEqual(ai.analyse(o).candidates,normal.candidates);}finally{move.power=power;}
 assert.equal(JSON.stringify(o),before);
});
test('AI values Return damage, respects Ghost immunity, Scrappy, PP and the Choice lock',()=>{
 const a=mon(128,['Return','Crunch']),b=mon(94,['Splash'],{type1:'Ghost',type2:'Poison'}),o=options(a,b);assert.equal(ai.chooseAction(o).number,1);
 b.type1='Normal';b.type2=null;assert.equal(ai.chooseAction(o).number,0);a.movePp[0]=0;assert.equal(ai.chooseAction(o).number,1);a.movePp[0]=20;a.heldItem='choice_band';a.__battle.choiceMove='Return';assert.equal(ai.chooseAction(o).number,0);
 b.type1='Ghost';a.passiveAbility='Scrappy';assert.equal(ai.chooseAction(o).number,0);
});
for(const[name,own,foe]of [['Eruption',{currentHp:200},{}],['Hex',{}, {status:'burn'}],['Venoshock',{}, {status:'poison'}],['Acrobatics',{},{}],['Psyshock',{}, {currentDefense:50,defense:50,currentSpecialDefense:200,specialDefense:200}],['Freeze-Dry',{}, {type1:'Water'}],['Growth',{},{}]])test(`AI projection agrees with real ${name} without mutation or RNG`,()=>{
 const {a,b,field,cast}=fixture(name,own,foe);if(name==='Growth')field.weather={kind:'sun',turns:5};
 const ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,damage:(p,q,m,side,state,extra)=>engine.estimateDamage(p,q,m,{battleState:state,defenderSide:side,...extra})};
 const before=JSON.stringify({a,b,field}),random=Math.random;Math.random=()=>{throw Error('AI consumed combat RNG');};let out;
 try{out=model.project(a,b,engine.getMoveByName(name),engine.getMoveByName('Splash'),ctx,{first:true});}finally{Math.random=random;}
 assert.equal(JSON.stringify({a,b,field}),before);fixed(()=>{cast();engine.processEndOfRound(a,b,field.sides.player,field.sides.enemy,field);});
 assert.equal(out.own.currentHp,a.currentHp);assert.equal(out.foe.currentHp,b.currentHp);assert.deepEqual(out.own.__battle.statStages,a.__battle.statStages);
});
for(const name of ['Jump Kick','High Jump Kick'])test(`${name} crash costs half max HP after miss, Protect, immunity or unreachable target only`,()=>{
 for(const outcome of ['hit','miss','protect','ghost','hidden','magic-guard','paralysis','empty-pp']){
  const f=fixture(name);if(outcome==='protect')f.b.__battle.protect=true;if(outcome==='ghost')f.b.type1='Ghost';
  if(outcome==='hidden'){f.b.__battle.semiInvulnerable='airborne';f.b.__battle.chargeMove='Fly';}
  if(outcome==='magic-guard'){f.a.passiveAbility='Magic Guard';f.b.type1='Ghost';}
  if(outcome==='paralysis')f.a.status='paralyze';if(outcome==='empty-pp')f.a.movePp[0]=0;
  const random=Math.random;Math.random=()=>outcome==='miss'?.999:outcome==='paralysis'?.1:.5;
  let result;try{result=f.cast();}finally{Math.random=random;}
  assert.equal(f.a.currentHp,['miss','protect','ghost','hidden'].includes(outcome)?500:1000,outcome);
  if(['miss','protect','ghost','hidden'].includes(outcome))assert(result.messages.some(m=>m.includes('retombant')));
 }
 assert.equal(engine.getMoveByName('Jump Kick').power,100);
});
test('a resisted low-power hit has a one HP minimum, while genuine immunity remains zero',()=>fixed(()=>{
 const f=fixture('Eruption',{currentHp:1,currentSpecialAttack:1,specialAttack:1},{type1:'Water',currentSpecialDefense:9999,specialDefense:9999});assert.equal(f.cast().damage,1);
 const immune=fixture('Return',{}, {type1:'Ghost'});assert.equal(immune.cast().damage,0);
}));
for(const name of ['Fissure','Guillotine','Horn Drill','Sheer Cold'])test(`${name} ignores accuracy/evasion boosts and cannot hit a higher level even with No Guard/Lock-On`,()=>fixed(()=>{
 const f=fixture(name);f.a.__battle.statStages.accuracy=6;f.b.__battle.statStages.evasion=-6;f.field.field.gravityTurns=5;
 const move=engine.getMoveByName(name),base=name==='Sheer Cold'?.2:.3;assert.equal(engine.getMoveHitChance(move,f.a,f.b,f.field),base);
 f.a.passiveAbility='Compound Eyes';assert.equal(engine.getMoveHitChance(move,f.a,f.b,f.field),base);
 f.b.level=51;f.a.passiveAbility='No Guard';f.a.__battle.lockOnTurns=2;f.a.__battle.lockOnTargetId=f.b.uuid;
 assert.equal(engine.getMoveHitChance(move,f.a,f.b,f.field),0);assert.equal(f.cast().damage,0);assert.equal(f.a.movePp[0],move.pp-1);
}));
test('Sheer Cold uses 30% for Ice users, 20% otherwise, and cannot hit Ice targets',()=>fixed(()=>{
 const f=fixture('Sheer Cold',{type1:'Ice'}),m=engine.getMoveByName('Sheer Cold');assert.equal(engine.getMoveHitChance(m,f.a,f.b,f.field),.3);
 f.b.type1='Ice';f.a.passiveAbility='No Guard';assert.equal(engine.getMoveHitChance(m,f.a,f.b,f.field),0);assert.equal(f.cast().damage,0);
}));
test('No Guard and Lock-On permit a reachable hit; always-hit alone does not bypass Fly, while self moves remain usable',()=>{
 const f=fixture('Swift'),m=engine.getMoveByName('Swift');Object.assign(f.b.__battle,{semiInvulnerable:'airborne',chargeMove:'Fly'});
 assert.equal(engine.getMoveHitChance(m,f.a,f.b,f.field),0);assert.equal(engine.getMoveHitChance(engine.getMoveByName('Growth'),f.a,f.b,f.field),1);
 f.a.passiveAbility='No Guard';assert.equal(engine.getMoveHitChance(m,f.a,f.b,f.field),1);f.a.passiveAbility=null;f.a.__battle.lockOnTurns=2;f.a.__battle.lockOnTargetId=f.b.uuid;assert.equal(engine.getMoveHitChance(m,f.a,f.b,f.field),1);
});
test('Belch unlocks after actually eating a berry, remains usable after switching, and throwing a berry does not unlock it',()=>fixed(()=>{
 const f=fixture('Belch',{heldItem:'sitrus_berry',currentHp:400});assert(!f.cast().success);
 engine.processEndOfRound(f.a,f.b,f.field.sides.player,f.field.sides.enemy,f.field);assert.equal(f.a.heldItem,null);assert(f.cast().damage>0);
 const team=[f.a,mon(1)];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);assert(f.cast().damage>0);
 const thrown=fixture('Belch');thrown.a.__battle.consumedHeldItem='sitrus_berry';assert(!thrown.cast().success);
}));
test('Assurance is doubled by entry hazards, but not by hazards from a previous turn',()=>fixed(()=>{
 for(const sameTurn of [true,false]){const f=fixture('Assurance');f.field.sides.enemy.hazards.stealthRock=true;engine.applySwitchInEffects(f.b,f.field.sides.enemy,f.field.sides.player,f.field,f.a);if(!sameTurn)f.field.turn++;
 const m=engine.getMoveByName('Assurance'),expected=engine.calculateDamage(f.a,f.b,{...m,ename:'Oracle',power:sameTurn?120:60});assert.equal(f.cast().damage,expected);}
}));
test('AI models OHKO damage and its chance, but respects Sturdy and level immunity',()=>{
 const a=mon(128,['Fissure','Splash'],{passiveAbility:'No Guard'}),b=mon(143,['Splash']),o=options(a,b);assert.equal(ai.chooseAction(o).number,0);
 const current=ai.analyse(o).candidates.find(c=>c.number===0).score;b.passiveAbility='Sturdy';assert(ai.analyse(o).candidates.find(c=>c.number===0).score<current);
 b.passiveAbility=null;b.level=51;assert(ai.analyse(o).candidates.find(c=>c.number===0).score<current);
});
test('the planner never mutates shared berry history when projecting a consumption',()=>{
 const {a,b,field}=fixture('Belch',{currentHp:400,heldItem:'sitrus_berry'});field.berryEaters=['somebody-else'];
 const before=JSON.stringify({a,b,field}),ctx={field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,damage:(p,q,m,s,f,e)=>engine.estimateDamage(p,q,m,{battleState:f,defenderSide:s,...e})};
 model.project(a,b,engine.getMoveByName('Belch'),engine.getMoveByName('Splash'),ctx,{first:true});assert.equal(JSON.stringify({a,b,field}),before);
});
const {DriftBattle}=require('../server/game/drift/driftBattle');
for(const mode of [{name:'Rift wild',type:'wild',mode:'rift',npc:true},{name:'Rift PvP',type:'pvp',mode:'rift',npc:false},{name:'Colosseum',type:'arena',mode:'colosseum',npc:true},{name:'Super Tournament',type:'trainer',npc:true}]){
 for(const move of ['Return','Brine','Eruption','Freeze-Dry','High Jump Kick','Focus Punch'])test(`${mode.name}: real ${move} result, PP and HP are shared correctly`,()=>fixed(()=>{
  const a=mon(143,[move],{currentSpeed:move==='Focus Punch'?1:999}),b=mon(9,[move==='Focus Punch'?'Tackle':'Splash'],{currentSpeed:move==='Focus Punch'?999:1});
  if(['Return','High Jump Kick'].includes(move))b.type1='Ghost';if(move==='Brine')b.currentHp=500;if(move==='Eruption')a.currentHp=250;if(move==='Freeze-Dry')b.type1='Water';
  const expected=['Return','High Jump Kick','Focus Punch'].includes(move)?0:engine.calculateDamage(structuredClone(a),structuredClone(b),{...engine.getMoveByName(move),ename:move==='Freeze-Dry'?move:'Oracle',power:move==='Eruption'?37:move==='Brine'?130:70});
  const p=(id,pokemon)=>({userId:id,socketId:'review-'+id,equipe:{pokemons:[pokemon]},items:{},money:0,drifts:[],equipped:[],defeated:new Set(),chain:0});
  const own=p(1,a),foe=p(2,b),events=[];own.run={mode:mode.mode};foe.npc=mode.npc;
  const battle=new DriftBattle(own,foe,{type:mode.type,random:()=>.5,now:()=>0,paceMs:0,rules:{report:false,rewards:false,permanentDeaths:false},emit:(p,event,data)=>{if(p===own)events.push({event,data});}});
  try{assert(battle.action(own,{action:'attack',number:0,turnId:battle.token}));if(!foe.npc)assert(battle.action(foe,{action:'attack',number:0,turnId:battle.token}));
   const result=events.find(e=>e.event==='battleMoveResult'&&e.data.actor==='player').data;assert.equal(result.damage,expected);assert.equal(a.movePp[0],resources.getMaxMovePp(move)-1);
   if(move==='High Jump Kick')assert.equal(a.currentHp,500);if(move==='Focus Punch')assert.equal(result.blocked,true);
  }finally{battle.finish(null,'fled');}
 }));
}
for(const [label,iv,type]of [
 ['all perfect',{hp:31,attack:31,defense:31,speed:31,specialAttack:31,specialDefense:31},'Dark'],
 ['all even',{hp:30,attack:30,defense:30,speed:30,specialAttack:30,specialDefense:30},'Fighting'],
 ['Ice spread',{hp:31,attack:30,defense:30,speed:31,specialAttack:31,specialDefense:31},'Ice']
])test(`Hidden Power ${label}: IV type, battle button, real hit and catalogue isolation`,()=>fixed(()=>{
 const f=fixture('Hidden Power',{iv}),move=engine.getMoveByName('Hidden Power'),before=JSON.stringify(move);
 assert.equal(engine.resolveWeatherMove(move,f.a,f.b,f.field).type,type);assert.equal(engine.battleMoveTypes(f.a,f.b,f.field)[0],type);
 const r=f.cast();assert.equal(r.move.type,type);assert.equal(f.a.__battle.revealedHiddenPowerType,type);assert.equal(JSON.stringify(move),before);
}));
test('Hidden Power retains Normalize and uses known own IVs without exposing opposing IVs',()=>fixed(()=>{
 const iv={hp:31,attack:31,defense:31,speed:31,specialAttack:31,specialDefense:31};
 const f=fixture('Hidden Power',{iv,passiveAbility:'Normalize'});assert.equal(f.cast().move.type,'Normal');assert.equal(f.a.__battle.revealedHiddenPowerType,undefined);
 const a=mon(143,['Hidden Power'],{iv}),b=mon(9,['Hidden Power']);Object.defineProperty(b,'iv',{get(){throw Error('Private IV read');}});
 const o=options(a,b),view=ai.publicPokemon(b);assert.equal(engine.resolveWeatherMove(engine.getMoveByName('Hidden Power'),view,a,o.field).type,'Normal');assert(ai.analyse(o).candidates.length);
 b.__battle.revealedHiddenPowerType='Ice';assert.equal(engine.resolveWeatherMove(engine.getMoveByName('Hidden Power'),ai.publicPokemon(b),a,o.field).type,'Ice');
}));
for(const[key,type,power]of [['oran_berry','Poison',80],['sitrus_berry','Psychic',80],['liechi_berry','Grass',100],['salac_berry','Fighting',100],['pomeg_berry','Ice',90]])test(`Natural Gift ${key}: actual berry type/power and one consumption`,()=>fixed(()=>{
 const f=fixture('Natural Gift',{heldItem:key});const move=engine.getMoveByName('Natural Gift');
 const reference=structuredClone(f.a);reference.heldItem=null;const expected=engine.calculateDamage(reference,f.b,{...move,ename:'Oracle',type,power});
 assert.equal(engine.battleMoveTypes(f.a,f.b,f.field)[0],type);const r=f.cast();assert.equal(r.move.type,type);assert.equal(r.damage,expected);assert.equal(f.a.heldItem,null);assert(!f.field.berryEaters?.includes(f.a.uuid));assert.equal(f.cast().damage,0);
}));
test('Natural Gift cannot use a suppressed item or a berry under Unnerve',()=>fixed(()=>{
 for(const disabled of ['Magic Room','Klutz','Unnerve']){const f=fixture('Natural Gift',{heldItem:'oran_berry'});if(disabled==='Magic Room')f.field.field.magicRoomTurns=5;if(disabled==='Klutz')f.a.passiveAbility='Klutz';if(disabled==='Unnerve')f.b.passiveAbility='Unnerve';assert.equal(f.cast().damage,0);assert.equal(f.a.heldItem,'oran_berry');}
}));
for(const[key,power]of [['choice_band',10],['life_orb',30],['rocky_helmet',60]])test(`Fling ${key} uses its own power after item removal, without the item's stat/damage boost`,()=>fixed(()=>{
 const f=fixture('Fling',{heldItem:key}),move=engine.getMoveByName('Fling'),reference=structuredClone(f.a);reference.heldItem=null;
 const expected=engine.calculateDamage(reference,f.b,{...move,ename:'Oracle',power});const r=f.cast();assert.equal(r.damage,expected);assert.equal(f.a.heldItem,null);assert.equal(f.a.currentHp,1000);
}));
for(const name of ['Chip Away','Sacred Sword'])test(`${name} also ignores evasion, without ignoring the user's accuracy penalty`,()=>{
 const f=fixture(name),move=engine.getMoveByName(name);f.b.__battle.statStages.evasion=6;assert.equal(engine.getMoveHitChance(move,f.a,f.b,f.field),1);f.a.__battle.statStages.accuracy=-2;assert.equal(engine.getMoveHitChance(move,f.a,f.b,f.field),.5);
});
for(const mode of ['rift','colosseum','super_tournament'])test(`${mode}: crash KO at one HP still resolves the opponent's residual damage exactly once`,()=>fixed(()=>{
 const a=mon(143,['High Jump Kick'],{currentHp:1,currentSpeed:999}),b=mon(9,['Splash'],{type1:'Ghost',status:'burn',currentSpeed:1});
 const own={userId:1,run:{mode},equipe:{pokemons:[a]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()},foe={npc:true,equipe:{pokemons:[b]},drifts:[],equipped:[]};
 const battle=new DriftBattle(own,foe,{type:'trainer',random:()=>.5,now:()=>0,paceMs:0,rules:{report:false,rewards:false,permanentDeaths:false},emit(){}});
 try{assert(battle.action(own,{action:'attack',number:0,turnId:battle.token}));assert.equal(a.currentHp,0);assert.equal(b.currentHp,938);assert(battle.finished);}finally{battle.finish(null,'fled');}
}));
test('a failed conditional move still locks a Choice item after its normal PP cost',()=>fixed(()=>{
 const f=fixture('Dream Eater',{heldItem:'choice_specs'});assert(!f.cast().success);assert.equal(f.a.__battle.choiceMove,'Dream Eater');assert.equal(f.a.movePp[0],14);const pp=f.a.movePp[1];assert(f.cast('Splash').blocked);assert.equal(f.a.movePp[1],pp);
}));

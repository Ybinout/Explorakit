const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {getMapWeather}=require('../server/game/world/mapWeather');
const codec=require('../server/game/drift/checkpointCodec'),{DriftBattle}=require('../server/game/drift/driftBattle');
function mon(id=61,ability='Run Away'){const p=factory.create(id,30,true);p.passiveAbility=ability;p.abilities=['Tackle'];p.maxHp=500;p.currentHp=400;return p;}
function end(a,b,s){return engine.processEndOfRound(a,b,s.sides.player,s.sides.enemy,s);}
function actor(id,map='start'){return {userId:id,currentmap:map,equipe:{pokemons:[mon()]},drifts:[],equipped:[],items:{},defeated:new Set(),chain:0,money:0};}
test('outdoor snowfall starts persistent ice weather before actions in Adventure, Rift and Colosseum',()=>{
 const expected={kind:'hail',turns:0,persistent:true,source:'map'};
 for(const map of ['route13','route14']){
  assert.equal(getMapWeather(map).ambience.snow,3);
  const state=engine.createBattleState({mapName:map});assert.deepEqual(state.weather,expected);
  const a=mon(),b=mon(19);for(let i=0;i<8;i++)end(a,b,state);assert.deepEqual(state.weather,expected);
  for(const mode of ['rift','colosseum'])for(const npc of [true,false]){
   const a=actor(1,map),b={...actor(2,map),npc},events=[];a.run={mode};
   const battle=new DriftBattle(a,b,{emit:(p,event,payload)=>events.push({p,event,payload}),paceMs:0});
   assert.deepEqual(battle.state.weather,expected);
   for(const p of [a,b].filter(p=>!p.npc)){
    assert.deepEqual(events.find(e=>e.p===p&&e.event==='battletrigger').payload.field.weather,expected);
    assert(events.findIndex(e=>e.p===p&&e.event==='battleFieldState')<events.findIndex(e=>e.p===p&&e.event==='requestAction'));
   }
   battle.finished=true;
  }
  assert.equal(engine.createBattleState({mapName:map,opponentMap:'centre'}).weather.kind,null);
 }
 for(const map of ['cave_rochebrume3','centre','ville5','gen_arene1','ville5_arene','ville5_shop'])assert.equal(engine.createBattleState({mapName:map}).weather.kind,null);
});
test('inherited snowfall activates ice abilities, Blizzard, Weather Ball and Forecast with normal hail damage and immunities',()=>{
 for(const mapName of ['route13','route14']){
  const field=engine.createBattleState({mapName}),dry=engine.createBattleState(),normal=mon(19),ice=mon(361);
  const normalHp=normal.currentHp,iceHp=ice.currentHp;end(normal,ice,field);
  assert.equal(normal.currentHp,normalHp-Math.floor(normal.maxHp/16));assert.equal(ice.currentHp,iceHp);
  normal.passiveAbility='Ice Body';const hp=normal.currentHp;end(normal,ice,field);assert.equal(normal.currentHp,hp+Math.floor(normal.maxHp/16));
  normal.passiveAbility='Slush Rush';assert.equal(engine.getBattleSpeed(normal,field.sides.player,field,ice),engine.getBattleSpeed(normal,dry.sides.player,dry,ice)*2);
  assert.equal(engine.weatherMoveAccuracy(engine.getMoveByName('Blizzard'),normal,ice,field),-1);
  const ball=engine.resolveWeatherMove(engine.getMoveByName('Weather Ball'),normal,ice,field);assert.equal(ball.type,'Ice');assert.equal(ball.power,100);
  const castform=mon(351,'Forecast');engine.applySwitchInEffects(castform,field.sides.player,field.sides.enemy,field,ice);assert.equal(castform.__battle.abilityForm,'Castform-Snowy');
  ice.passiveAbility='Cloud Nine';assert.equal(engine.getBattleSpeed(normal,field.sides.player,field,ice),engine.getBattleSpeed(normal,dry.sides.player,dry,ice));
  assert.equal(engine.resolveWeatherMove(engine.getMoveByName('Weather Ball'),normal,ice,field).type,'Normal');
  normal.passiveAbility='Run Away';const sheltered=normal.currentHp;end(normal,ice,field);assert.equal(normal.currentHp,sheltered);
 }
});
test('Rochebrume sand is inherited outdoors in all modes, persists and preserves sand immunities; Wanda and other interiors stay dry',()=>{
 for (const mapName of ['ville4','route12']) {
 const expected={kind:'sandstorm',turns:0,persistent:true,source:'map'},field=engine.createBattleState({mapName});
 assert.deepEqual(field.weather,expected);const normal=mon(19),rock=mon(74),hp=normal.currentHp,rockHp=rock.currentHp;end(normal,rock,field);
 assert(normal.currentHp<hp);assert.equal(rock.currentHp,rockHp);assert.deepEqual(field.weather,expected);
 for(const mode of ['rift','colosseum']){const a=actor(1,mapName),b={...actor(2,mapName),npc:true};a.run={mode};const battle=new DriftBattle(a,b,{emit(){},paceMs:0});assert.deepEqual(battle.state.weather,expected);battle.finished=true;}
 }
 for(const map of ['ville4_arene','ville4_shop','ville4_maison1','centre','route11','ville_safe1'])assert.equal(engine.createBattleState({mapName:map}).weather.kind,null);
 assert.equal(engine.createBattleState({mapName:'ville4',opponentMap:'centre'}).weather.kind,null);
});
test('map rain comes only from server climate; configured arena shares rain; other interiors and mismatched duels are dry',()=>{assert.equal(getMapWeather('start').kind,'rain');for(const map of ['route1','route2']){assert.deepEqual(getMapWeather(map).ambience,{wind:1,rain:1});assert.deepEqual(engine.createBattleState({mapName:map}).weather,{kind:'rain',turns:0,persistent:true,source:'map'});}assert.equal(engine.createBattleState({mapName:'start',weather:'sun'}).weather.kind,'rain');for(const map of ['route3','maison2','cave1','ville_safe1','__proto__',null,undefined])assert.equal(engine.createBattleState({mapName:map}).weather.kind,null);assert.equal(engine.createBattleState({mapName:'start',opponentMap:'maison2'}).weather.kind,null);});
test('map rain persists across rounds, boosts Water, reduces Fire and activates speed/healing abilities immediately',()=>{const wet=engine.createBattleState({mapName:'start'}),dry=engine.createBattleState(),a=mon(),b=mon(19);const damage=(move,field)=>engine.estimateDamage(a,b,engine.getMoveByName(move),{battleState:field});assert(damage('Water Pulse',wet)>damage('Water Pulse',dry)*1.4);assert(damage('Ember',wet)<damage('Ember',dry)*.6);a.passiveAbility='Swift Swim';assert.equal(engine.getBattleSpeed(a,wet.sides.player,wet,b),engine.getBattleSpeed(a,dry.sides.player,dry,b)*2);b.passiveAbility='Cloud Nine';assert.equal(engine.getBattleSpeed(a,wet.sides.player,wet,b),engine.getBattleSpeed(a,dry.sides.player,dry,b));b.passiveAbility='Run Away';a.passiveAbility='Rain Dish';const hp=a.currentHp;end(a,b,wet);assert(a.currentHp>hp);for(let i=0;i<9;i++)end(a,b,wet);assert.deepEqual(wet.weather,{kind:'rain',turns:0,persistent:true,source:'map'});});
test('moves and entry abilities replace map weather with their normal finite duration',()=>{for(const mapName of ['start','route13','route14'])for(const mode of ['move','ability']){const s=engine.createBattleState({mapName}),a=mon(),b=mon(19);if(mode==='move')engine.useattack('Sunny Day',a,b,{battleState:s,attackerSide:s.sides.player,defenderSide:s.sides.enemy});else{a.passiveAbility='Drought';engine.applySwitchInEffects(a,s.sides.player,s.sides.enemy,s,b);}assert.deepEqual(s.weather,{kind:'sun',turns:5});for(let i=0;i<5;i++)end(a,b,s);assert.equal(s.weather.kind,null);}});
test('Rift and Colosseum exploration publish rain before actions; both duel perspectives share it and dry arenas stay dry',()=>{for(const map of ['start','route1','route2'])for(const mode of ['rift','colosseum'])for(const npc of [true,false]){const a=actor(1,map),b=actor(2,map),events=[];a.run={mode};b.npc=npc;const battle=new DriftBattle(a,b,{emit:(p,event,payload)=>events.push({p,event,payload}),paceMs:0});assert.equal(battle.state.weather.kind,'rain');for(const p of [a,b].filter(p=>!p.npc)){const trigger=events.find(e=>e.p===p&&e.event==='battletrigger');assert.equal(trigger.payload.field.weather.kind,'rain');assert(events.findIndex(e=>e.p===p&&e.event==='battleFieldState')<events.findIndex(e=>e.p===p&&e.event==='requestAction'));}battle.finished=true;}const a=actor(1,'gen_arene1'),b={...actor(2),npc:true};const battle=new DriftBattle(a,b,{type:'arena',npcKey:'colosseum_1',emit(){},paceMs:0});assert.equal(battle.state.weather.kind,null);battle.finished=true;});
test('reconnection/checkpoint retain the captured climate and never reapply it over an ability or move',()=>{for(const map of ['start','route13','route14']){const a=actor(1,map),b={...actor(2,map),npc:true};const battle=new DriftBattle(a,b,{emit(){},paceMs:0});a.currentmap='maison2';let restored=codec.decode(codec.encode({battle})).battle;const events=[];restored.emit=(_p,event,payload)=>events.push({event,payload});restored.resume(restored.a);assert.deepEqual(events.find(e=>e.event==='battleFieldState').payload.weather,battle.state.weather);battle.state.weather={kind:'sun',turns:2};restored=codec.decode(codec.encode({battle})).battle;restored.emit=()=>{};restored.resume(restored.a);assert.deepEqual(restored.state.weather,{kind:'sun',turns:2});battle.finished=true;restored.finished=true;}});
test('shared client clears field weather and terrain when the server sends a dry state',()=>{const fs=require('node:fs'),source=fs.readFileSync(require('node:path').join(__dirname,'../vue-explorakit/src/components/battle/BattleOverlay.vue'),'utf8');const script=require('../vue-explorakit/node_modules/vue-template-compiler').parseComponent(source).script.content;const ast=require('../vue-explorakit/node_modules/@babel/parser').parse(script,{sourceType:'module'});const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,methods=component.properties.find(n=>n.key.name==='methods'),method=methods.value.properties.find(n=>n.key.name==='updateFieldState');const update=new Function(`return ({${script.slice(method.start,method.end)}}).updateFieldState;`)(),vm={fieldState:{}};update.call(vm,{weather:{kind:'rain',persistent:true},terrain:'electric_terrain'});assert.deepEqual(vm.fieldState,{weather:'rain',terrain:'electric_terrain'});update.call(vm,{weather:{kind:null,turns:0},terrain:{kind:null,turns:0}});assert.deepEqual(vm.fieldState,{weather:null,terrain:null});});

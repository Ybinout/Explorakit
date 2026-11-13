const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const factory=require('../server/game/drift/pokemonFactory');
const engine=require('../server/game/battle/battleEngine');
const resources=require('../server/game/battle/battleResources');
const {RaidBattle}=require('../server/game/raids/RaidBattle');
const {make}=require('../scripts/calibrateCorruptionRaids');
const mon=(id=9)=>{const p=make(id,100,4,['Tackle','Splash'],'Keen Eye');p.heldItem=null;return p;};

test('all Magic Island maps share the Dark Continent soundtrack',()=>{
    const c={};vm.runInNewContext(fs.readFileSync('vue-explorakit/src/services/worldMusic.js','utf8').replace(/export /g,''),c);
    for(const map of ['ile2_01','ile2_02','ile2_03','ile2_04','jungle1','DC2_44'])assert.equal(c.worldMusicTrack(map),'dark');
    assert.equal(c.worldMusicTrack('route1'),'route');
});
test('only the two bench floor cells change collision, using matching native floor pixels',()=>{
    const map=require('../server/game/world/mapRepository'),original=JSON.parse(fs.readFileSync('data/maps/ville_safe1.json'));
    const before=original.layers.find(l=>l.name==='coll').data,after=map.loadCollisionData('ville_safe1');
    for(let y=0;y<20;y++)for(let x=0;x<28;x++)assert.equal(after[y][x],x===25&&[8,9].includes(y)?0:before[y*28+x]);
    const config=require('../data/game/worldDecorEdits.json');assert.deepEqual(config,require('../vue-explorakit/src/data/worldDecorEdits.json'));
    assert.equal(config.patches[0].rows.length,32);for(const runs of config.patches[0].rows)assert.equal(runs.reduce((n,r)=>n+r[1],0),16);
});
test('Dark wild plate odds gain three points in every column, Jungle9 and all mainland maps',()=>{
    const dc=require('../server/game/world/darkContinent');
    for(const [map,rate] of [['jungle1',.24],['jungle4',.24],['jungle7',.24],['jungle2',.31],['jungle5',.31],['jungle8',.31],['jungle3',.35],['jungle6',.35],['jungle9',.41],['DC2_01',.41],['DC2_48',.41]])assert.equal(dc.lootProfile(map).plateChance,rate);
    assert.deepEqual(dc.loot(mon(),()=>0,'jungle1').filter(i=>!i.plateType).map(i=>i.quantity),[5,2,2]);
    assert.deepEqual(require('../server/game/items/wildCrystals').roll(()=>0).map(i=>i.quantity),[2,2,2]);
});
test('all House PvE opponents are K4 at each party size and normalized or free levels',()=>{
    const trainers=require('../server/game/whitepeak/trainers');
    for(const entry of trainers.list())for(const size of [1,3,6])for(const level of [null,100]){
        const own=Array.from({length:size},()=>factory.create(9,40,true));
        const team=trainers.create(entry.key,own,level).pokemons;
        assert.equal(team.length,size,entry.key);assert(team.every(p=>p.k===4),entry.key);
        for(const p of team){assert.equal(p.level,level||40);const expected=p.attack;p.recalculateStats();assert.equal(p.attack,expected);}
    }
});
test('Tower keeps a deliberate Sash but eliminates the generic third-slot Sash',()=>{
    const content=require('../server/game/superTournament/content');
    const items=content.roster.flatMap((_,i)=>content.createTeam(i).pokemons.map(p=>p.heldItem));
    assert.equal(items.filter(i=>i==='focus_sash').length,1);assert(items.includes('focus_sash'));
});
function raid(){return new RaidBattle(Array.from({length:4},()=>({ownerId:1,ownerName:'Test',pokemon:mon()})),mon(143),{seed:[1,2,3,4],reactive:true});}
function damage(b,source,target,move='tackle') {b.sim.prng.setSeed('1,2,3,4');return b.sim.actions.getDamage(source,target,b.sim.dex.getActiveMove(move));}
for(const sourceSide of [0,1])test(`raid burn leaves 75% physical damage on side ${sourceSide}; Facade/Guts and special damage unchanged`,()=>{
    const b=raid(),source=b.sim.sides[sourceSide].active[0],target=b.sim.sides[1-sourceSide].active[0];
    const normal=damage(b,source,target);source.setStatus('brn',source,b.sim.dex.moves.get('willowisp'));
    const burned=damage(b,source,target);assert(Math.abs(burned-normal*.75)<=2,[normal,burned]);
    const special=damage(b,source,target,'watergun');source.cureStatus();assert.equal(damage(b,source,target,'watergun'),special);
    source.ability='guts';const unburned=damage(b,source,target);source.setStatus('brn',source,b.sim.dex.moves.get('willowisp'));
    assert(damage(b,source,target)>unburned,'Guts keeps its own bonus, without a second burn multiplier');
    source.ability='keeneye';const facade=damage(b,source,target,'facade');source.cureStatus();assert(facade>damage(b,source,target,'facade')*1.8);
});
test('ordinary singles retain the 50% burn penalty',()=>{
    const p=mon(),q=mon(143),state=engine.createBattleState(),move=resources.getMoveDefinition('Tackle');
    const normal=engine.estimateDamage(p,q,move,{battleState:state});p.status='burn';
    assert(Math.abs(engine.estimateDamage(p,q,move,{battleState:state})/normal-.5)<.03);
});
for(const key of ['corrupted_choice_band','corrupted_choice_scarf','corrupted_choice_specs'])test(key+' reduces incoming move damage by 3% in singles, doubles and raids; suppression cancels it',()=>{
    assert.equal(require('../vue-explorakit/src/data/heldItems.json')[key].description,
        require('../data/game/items.json').items.find(i=>i.key===key).description);
    const p=mon(),q=mon(143),field=engine.createBattleState(),move=resources.getMoveDefinition('Tackle');
    q.corruption={version:1,permanent:true,modules:{}};
    const normal=engine.estimateDamage(p,q,move,{battleState:field});q.heldItem=key;
    assert(Math.abs(engine.estimateDamage(p,q,move,{battleState:field})-normal*.97)<=1);
    field.field.magicRoomTurns=2;assert.equal(engine.estimateDamage(p,q,move,{battleState:field}),normal);
    const {DoublesBattle}=require('../server/game/doubles/doublesBattle');
    const double=new DoublesBattle(...[0,1].map(i=>({id:'item'+i,username:'Test',equipe:{pokemons:[mon(),mon()]}})),{emit(){}});
    const raidBattle=raid();
    for(const b of [{sim:double.sim},raidBattle]){
        const source=b.sim.p2.active[0],target=b.sim.p1.active[0];target.set.rift.corrupted=true;
        const base=damage(b,source,target);target.setItem(key.replaceAll('_',''));
        assert(Math.abs(damage(b,source,target)-base*.97)<=1);
        target.addVolatile('embargo',source,b.sim.dex.moves.get('embargo'));assert.equal(damage(b,source,target),base);
    }
});
test('Confusion and Disable survive the native raid snapshot and appear on the correct ally',()=>{
    let b=raid();const p=b.sim.p1.active[0];p.addVolatile('confusion',p,b.sim.dex.moves.get('confuseray'));
    p.lastMove=b.sim.dex.moves.get('tackle');p.addVolatile('disable',b.bossPokemon,b.sim.dex.moves.get('disable'));
    b=RaidBattle.restore(require('../server/game/drift/checkpointCodec').decode(require('../server/game/drift/checkpointCodec').encode(b.snapshot())));
    assert.equal(b.viewPokemon(b.sim.p1.active[0],0).effects.confusion,true);
    assert.equal(b.viewPokemon(b.sim.p1.active[0],0).effects.disabledMove,'Charge');
    assert.equal(b.viewPokemon(b.sim.p1.active[1],1).effects.confusion,false);
});
test('six-for-six PC exchange is atomic, preserves resources and rejects stale or corrupt parties',()=>{
    const storage=require('../server/game/storage/pokemonStorage');
    const team=Array.from({length:6},()=>mon()),entries=Array.from({length:6},(_,i)=>({box:3,slot:i,pokemon:mon(143)}));
    entries[0].pokemon.currentHp=5;entries[0].pokemon.heldItem='leftovers';entries[0].pokemon.movePp[0]=1;
    const payload={action:'swapParty',expectedTeam:team.map(p=>p.uuid),moves:entries.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}}))};
    const before=JSON.stringify({team,entries}),plan=storage.planAction(team,entries,payload);
    assert.deepEqual(plan.team.map(p=>p.uuid),entries.map(e=>e.pokemon.uuid));assert.deepEqual(plan.entries.map(e=>e.pokemon.uuid),team.map(p=>p.uuid));
    assert.equal(plan.team[0].currentHp,5);assert.equal(plan.team[0].heldItem,'leftovers');assert.equal(plan.team[0].movePp[0],1);assert.equal(JSON.stringify({team,entries}),before);
    assert.throws(()=>storage.planAction(plan.team,plan.entries,payload),/changé/);
    for(const patch of [{moves:payload.moves.slice(1),teamIndex:2},{expectedTeam:[]},{moves:Array(6).fill(payload.moves[0])}])assert.throws(()=>storage.planAction(team,entries,{...payload,...patch}));
    for(const e of entries.slice(0,2))e.pokemon.corruption={version:1,permanent:true,modules:{}};
    assert.throws(()=>storage.planAction(team,entries,payload),/corrompu/);
});
test('trash validates quantities, confirmation, duplicates and protected key items',()=>{
    const trash=require('../server/game/housing/trash');
    assert.deepEqual(trash.selection({confirm:true,items:[{key:'potion',quantity:4}]}),[{key:'potion',quantity:4}]);
    for(const items of [[{key:'potion',quantity:-1}],[{key:'potion',quantity:1.5}],[{key:'professional_trainer_card',quantity:1}],[{key:'potion',quantity:1},{key:'potion',quantity:1}],[{key:'not-an-item',quantity:1}]])assert.throws(()=>trash.selection({confirm:true,items}));
    assert.throws(()=>trash.selection({items:[{key:'potion',quantity:1}]}));
});
test('trainer switch memory is bounded and reverse switching is penalized without reading intentions',()=>{
    const ai=require('../server/game/battle/humanTrainerAI');const a=mon(),b=mon(3),memory={};
    for(let round=0;round<20;round++)ai.recordSwitch(memory,a,b,round);
    assert.equal(memory.switchHistory.length,6);assert.equal(memory.lastSwitchRound,19);
    const state=engine.createBattleState();a.abilities=['Tackle'];b.abilities=['Solar Beam'];const foe=mon(6);
    memory.switchHistory=[{from:b.uuid,to:a.uuid,round:1}];memory.lastSwitchRound=1;
    const options={team:[a,b],opponentTeam:[foe],field:state,ownSide:state.sides.enemy,enemySide:state.sides.player,memory,round:2};
    Object.defineProperty(state,'turnActions',{get(){throw Error('Player action inspected');}});
    assert(!ai.analyse(options).candidates.some(c=>c.action==='change'&&c.number===1));
});

const test=require('node:test'),assert=require('node:assert/strict');
const scene=require('../server/game/world/mirrorRift'),{mirrorTeam}=require('../server/game/battle/mirrorTeam');
const factory=require('../server/game/drift/pokemonFactory'),terrain=require('../server/game/world/mapRepository');
function progress(ending='pardon_badge'){return {badges:[...scene.requiredBadges,ending].map(key=>({key,earned:true})),flags:{}};}
test('secret requires the six earned gym badges and either actual ending badge',()=>{
  assert.equal(scene.requiredBadges.length,6);for(const b of scene.endingBadges)assert(scene.unlocked(progress(b)));
  for(const missing of [...scene.requiredBadges,'pardon_badge']){const p=progress();p.badges=p.badges.filter(b=>b.key!==missing);assert(!scene.unlocked(p));}
  assert(!scene.unlocked({flags:{true_ending:'true'},badges:[]}));assert(!scene.unlocked({badges:progress().badges.map(b=>({...b,earned:false}))}));
});
test('opening works along the entire bookshelf perimeter; approach and clone retain their own positions',()=>{
  const p=progress(),player={currentmap:scene.config.map,x:7*32+16,y:4*32+16};
  assert.equal(terrain.loadCollisionData(player.currentmap)[4][7],0);assert.equal(scene.interaction(player,p),'open');
  const collision=terrain.loadCollisionData(player.currentmap);
  for(const [x,y]of [[7,4],[8,4],[9,5],[9,6],[7,7],[8,7]]){
    assert.equal(collision[y][x],0,`accessible beside the shelf: ${x},${y}`);
    assert.equal(scene.interaction({...player,x:x*32+16,y:y*32+16},p),'open',`${x},${y}`);
    assert.equal(scene.interaction({...player,x:x*32+16,y:y*32+16},{flags:{professor_defeated:'true'},badges:[]}),null,'professor flags alone cannot bypass the ending badges');
  }
  for(const [x,y]of [[7,5],[8,6],[6,4],[9,4],[10,6],[7,8]])assert.equal(scene.interaction({...player,x:x*32+16,y:y*32+16},p),null,'inside furniture, diagonal corners and distant cells cannot trigger');
  assert.equal(scene.interaction({...player,y:8*32+16},p),null);assert.equal(scene.interaction({...player,currentmap:'route2'},p),null);
  p.flags.mirror_stage='open';assert.equal(scene.interaction({...player,x:13*32+16,y:12*32+16},p),'emerge');
  p.flags.mirror_stage='clone';assert.equal(scene.interaction({...player,x:13*32+16,y:12*32+16},p),'battle');
  p.flags.mirror_stage='complete';assert.equal(scene.interaction(player,p),null);
});
test('rift cells and clone are solid, leaving the room exit and the route open',()=>{
  const p=progress();p.flags.mirror_stage='clone';
  for(const[x,y]of[[13,9],[12,10],[13,10],[14,10],[13,11],[11,10],[15,10],[13,13]])assert(scene.blocked(scene.config.map,x,y,p));
  assert(!scene.blocked('route2',13,10,p));assert(!scene.blocked(scene.config.map,13,18,p));
  p.flags.mirror_stage='complete';assert(scene.blocked(scene.config.map,13,10,p));assert(!scene.blocked(scene.config.map,13,13,p));
});
test('private admin preview does not rewrite the completed permanent ruin',()=>{
  const p=progress();Object.assign(p.flags,{mirror_stage:'complete',mirror_ruined:'true',admin_mirror_replay:'true',admin_mirror_stage:'sealed',admin_mirror_ruined:'false'});
  assert.equal(scene.state(p).stage,'sealed');assert.equal(scene.state(p).ruined,false);assert(!scene.blocked(scene.config.map,13,10,p));delete p.flags.admin_mirror_replay;assert.equal(scene.state(p).stage,'complete');assert(scene.state(p).ruined);
});
test('mirror copies exact HP, PP, IV, EV, nature, K, ability, items and stats without sharing objects or identities',()=>{
  const a=factory.create(94,250,true),b=factory.create(9,42,true);a.currentHp=13;a.heldItem='choice_scarf';a.status='burn';a.abilities=['Shadow Ball','Sludge Bomb'];a.movePp=[3,0];a.k=4;a.iv.speed=31;a.ev.speed=252;a.nature='Timid';a.__battle={statStages:{speed:6}};b.currentHp=0;b.heldItem='leftovers';
  const before=JSON.stringify([a,b]),copy=mirrorTeam({pokemons:[a,b]});assert.equal(copy.pokemons.length,2);
  for(const[p,i]of copy.pokemons.entries()){const original=[a,b][p];assert.notEqual(i.uuid,original.uuid);assert.equal(typeof i.getAtkName,'function');
    for(const key of ['currentHp','movePp','iv','ev','nature','k','status','passiveAbility','heldItem','abilities','level','maxHp','attack','speed'])assert.deepEqual(i[key],original[key],key);
    assert.equal(i.__battle,undefined);
  }
  copy.pokemons[0].iv.speed=0;copy.pokemons[0].currentHp=0;copy.pokemons[0].abilities[0]='Splash';assert.equal(JSON.stringify([a,b]),before);
});
test('mirror refuses an empty, oversized or fully KO team; eggs do not become enemies',()=>{
  assert.throws(()=>mirrorTeam({pokemons:[]}));const p=factory.create(1,5,true);p.currentHp=0;assert.throws(()=>mirrorTeam({pokemons:[p]}));
  assert.throws(()=>mirrorTeam({pokemons:Array(7).fill(p)}));p.currentHp=1;const egg={...p,isEgg:true};assert.equal(mirrorTeam({pokemons:[p,egg]}).pokemons.length,1);
});
test('cinematic has bounded shake, persistent endpoints and a motion-free alternative',async()=>{
  const{mirrorScenePose}=await import('../vue-explorakit/src/services/mirrorRiftRenderer.js');
  for(const phase of ['opening','emerging','closing'])for(const now of [0,1500,5000,10000]){const scene={phase,startedAt:0,duration:8600},p=mirrorScenePose(scene,now);assert(p.t>=0&&p.t<=1);assert(Math.abs(p.shakeX)<=6.1);assert(Math.abs(p.shakeY)<=4.3);const reduced=mirrorScenePose(scene,now,false);assert.equal(reduced.shakeX,0);assert.equal(reduced.shakeY,0);}
  assert.equal(mirrorScenePose({phase:'opening',startedAt:0,duration:8600},8600).spread,1);
  assert.equal(mirrorScenePose({phase:'closing',startedAt:0,duration:6200},6200).spread,0);
});

test('central rift and clone use free terrain, with a reachable southern action tile',()=>{
  assert.deepEqual(scene.config.rift,{x:13,y:10});assert.equal(scene.config.openingMs,8000);
  const c=terrain.loadCollisionData(scene.config.map),p=progress();p.flags.mirror_stage='open';
  assert.equal(c[scene.config.rift.y][scene.config.rift.x],0);assert.equal(c[scene.config.clone.y][scene.config.clone.x],0);
  assert(!scene.blocked(scene.config.map,13,12,p));assert.equal(scene.interaction({currentmap:scene.config.map,x:432,y:400},p),'emerge');
  assert(!scene.blocked(scene.config.map,7,4,p));assert(!scene.blocked(scene.config.map,13,17,p));
  for(const stage of ['open','complete']){
    p.flags.mirror_stage=stage;
    const spawn=require('../server/realtime/playerState').sanitizeSpawnPosition(432,336,c,scene.config.map,{blocked:(map,x,y)=>scene.blocked(map,x,y,p)});
    assert(!scene.blocked(scene.config.map,Math.floor(spawn.x/32),Math.floor(spawn.y/32),p));
  }
});
test('opening keeps moving late in the sequence and camera returns to the player without changing world coordinates',async()=>{
  const {mirrorScenePose,mirrorCameraTarget,riftCenter}=await import('../vue-explorakit/src/services/mirrorRiftRenderer.js');
  const s={phase:'opening',map:scene.config.map,startedAt:0,duration:8000},player={x:240,y:144},state={rift:scene.config.rift};
  assert.deepEqual(riftCenter(state),{x:432,y:336});
  assert(mirrorScenePose(s,6400).spread<.95);assert(mirrorScenePose(s,7600).spread>mirrorScenePose(s,6400).spread);
  assert.deepEqual(mirrorCameraTarget(s,0,player,state),player);assert.deepEqual(mirrorCameraTarget(s,8000,player,state),player);
  assert.deepEqual(mirrorCameraTarget(s,4000,player,state),{x:432,y:336});
  assert.deepEqual(mirrorCameraTarget(null,4000,player,state),player);assert.deepEqual(player,{x:240,y:144});
});

test('mirror awakening is in the upstairs blue bed, with a free exit and unchanged ordinary blackout destination',()=>{
  const wake=scene.config.wake,c=terrain.loadCollisionData(wake.map),safe=require('../server/realtime/playerState').sanitizeSpawnPosition(wake.x,wake.y,c,wake.map);
  assert.deepEqual(wake,{map:'etage',x:592,y:336});assert.deepEqual(safe,{x:wake.x,y:wake.y});assert.equal(c[10][17],0);
  assert.deepEqual(require('../server/game/world/playerRecovery').HOME_RESPAWN_POINT,{map:'maison',x:272,y:432});
});
test('floor fragments use the authored board height and bounded offsets, never sample furniture',async()=>{
  const{mirrorFloorBoards,riftCenter}=await import('../vue-explorakit/src/services/mirrorRiftRenderer.js'),center=riftCenter({rift:scene.config.rift});
  for(const spread of [0,.2,.5,.8,1])for(const b of mirrorFloorBoards(center,spread)){
    assert.equal(b.height,22);assert([80,96].includes(b.width));assert(Math.abs(b.dx)<=8);assert(b.y>=290&&b.y+b.height<=378);
    assert(b.x>=336&&b.x+b.width<=528);if(b.y+b.height>350)assert(b.x+b.width<=512);
  }
});

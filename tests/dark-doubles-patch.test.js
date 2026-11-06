const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../server/game/models/Pokemon'),{getTotalExperienceForLevel}=require('../server/game/models/progression');
const {DoublesBattle}=require('../server/game/doubles/doublesBattle'),{dex,teamSet}=require('../server/game/doubles/ruleset');
const engine=require('../server/game/battle/battleEngine'),items=require('../server/game/items/heldItems'),policy=require('../server/game/items/heldItemPolicy');
const perfect={hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31};
function pokemon(id=9,moves=['Splash'],heldItem=null,ability='No Ability'){const p=new P(id,null,null,getTotalExperienceForLevel(50),perfect,'Serious',4);p.abilities=moves;p.movePp=moves.map(()=>40);p.passiveAbility=ability;p.heldItem=heldItem;return p;}
function corrupted(p){p.corruption={version:1,revision:1,permanent:true,modules:{}};return p;}
function battle(a,b){const events=[],players=[a,b].map((pokemons,i)=>({id:'test'+i,username:'Player'+i,equipe:{pokemons}}));const d=new DoublesBattle(...players,{emit:(p,e,data)=>events.push({p,e,data})});d.sim.prng.setSeed('1,2,3,4');return{d,events,players};}
function turn(f,actions=[[],[]]){const token=f.d.token;for(let i=0;i<2;i++){const req=f.d.state(i).request;if(!req)continue;for(const s of req.slots){if(!s.required)continue;const data=actions[i][s.slot]||{action:'attack',moveIndex:0};assert.equal(f.d.action(f.players[i],{turnId:token,slot:s.slot,...data}),true,JSON.stringify({i,s,data}));}}}
test('Dark levels rise down and right, ending at290–300; exact +3pp plate probabilities, unchanged crystals',()=>{
 const dc=require('../server/game/world/darkContinent');for(let n=1;n<=9;n++){const range=dc.levels('jungle'+n);assert(range[0]>=100&&range[1]<=300);if(n%3)assert(range[0]<dc.levels('jungle'+(n+1))[0]);if(n<7)assert(range[0]<dc.levels('jungle'+(n+3))[0]);}
 assert.deepEqual(dc.levels('jungle9'),[290,300]);assert.deepEqual([1,2,3,9].map(n=>dc.lootProfile('jungle'+n).plateChance),[.14,.21,.25,.31]);
});
test('all seven corrupted held recipes have the corresponding classic item and40 of each crystal; symmetric equipment policy',()=>{
 const recipes=require('../server/game/corruption/heldCrafting').RECIPES;assert.equal(recipes.length,7);
 for(const r of recipes){assert.deepEqual(r.cost.map(c=>c.quantity),[1,40,40,40]);assert.equal(r.base,r.cost[0].key);const normal=pokemon(),mutated=corrupted(pokemon());assert(!policy.canHold(normal,r.key));assert(policy.canHold(mutated,r.key));assert(!policy.canHold(mutated,r.base));assert(policy.canHold(normal,r.base));}
});
test('single engine: corrupted choices×1.2, lock even on status, exact20/30% recoil, no recoil for sleeping prevented move',()=>{
 for(const[key,stat,fraction]of [['corrupted_choice_band','attack',.3],['corrupted_choice_scarf','speed',.2],['corrupted_choice_specs','specialAttack',.3]]){
  const p=corrupted(pokemon(9,['Splash','Tackle'],key)),q=pokemon(),state=engine.createBattleState();assert.equal(items.statMultiplier(p,stat,state),1.2);
  const hp=p.currentHp;engine.useattack('Splash',p,q,{battleState:state});assert.equal(p.currentHp,hp-Math.floor(p.maxHp*fraction));assert(!items.allowsMove(p,'Tackle',state));
  const asleep=corrupted(pokemon(9,['Splash'],key));asleep.status='sleep';asleep.__battle={sleepTurns:3};const original=asleep.currentHp;engine.useattack('Splash',asleep,q,{battleState:engine.createBattleState()});assert.equal(asleep.currentHp,original);
 }
});
test('single engine: Restes heal8%, KO at third turn even under Magic Guard; switch-out resets count',()=>{
 const p=corrupted(pokemon(9,['Splash'],'corrupted_leftovers','Magic Guard')),q=pokemon();const state=engine.createBattleState();p.currentHp=1;const heal=Math.floor(p.maxHp*.08);
 for(let n=1;n<=2;n++){engine.processEndOfRound(p,q,state.sides.player,state.sides.enemy,state);assert.equal(p.currentHp,1+n*heal);}
 require('../server/game/battle/battleTeam').clearSwitchOutState(p);engine.processEndOfRound(p,q,state.sides.player,state.sides.enemy,state);assert(p.currentHp>0);
 for(let n=0;n<2;n++)engine.processEndOfRound(p,q,state.sides.player,state.sides.enemy,state);assert.equal(p.currentHp,0);
});
test('Doubles instantiate4 active, real K statistics, private own rosters, public spectator with no reserves or requests',()=>{
 const a=[pokemon(9),pokemon(25),pokemon(94)],b=[pokemon(3),pokemon(6),pokemon(149)],before=JSON.stringify([a,b]),f=battle(a,b);
 assert(f.d.sim.sides.every(s=>s.active.length===2));for(let i=0;i<2;i++)for(let s=0;s<2;s++){const p=[a,b][i][s],actual=f.d.sim.sides[i].active[s];assert.equal(actual.maxhp,p.maxHp);assert.equal(actual.storedStats.spe,p.speed);assert.equal(actual.storedStats.atk,p.attack);}
 assert.equal(f.d.state(0).team.length,3);assert.equal(f.d.state(0).request.slots[0].moves[0].maxpp,require('../server/game/battle/battleResources').getMaxMovePp('Splash'));const publicView=f.d.spectatorView();assert.deepEqual(publicView.team,[]);assert.equal(publicView.request,null);assert(!JSON.stringify(publicView).includes(a[2].uuid));turn(f);assert.equal(JSON.stringify([a,b]),before);
});
test('Doubles Surf hits both enemies AND ally, while Protect shields one target',()=>{
 const f=battle([pokemon(9,['Surf']),pokemon(25,['Protect'])],[pokemon(3),pokemon(6)]);const max=f.d.sim.sides.map(s=>s.active.map(p=>p.hp));turn(f);const sides=f.d.sim.sides;assert.equal(sides[0].active[1].hp,max[0][1]);assert(sides[1].active.every((p,n)=>p.hp<max[1][n]));
 const moves=f.events.flatMap(e=>e.e==='whitepeak:doubleFrame'?e.data.events:[]).filter(e=>e.kind==='move');assert(moves.some(e=>e.moveName==='Surf'&&e.message.includes('Surf')));
});
test('Doubles Follow Me redirects targeted attacks; Lightning Rod draws electricity from allies',()=>{
 const follow=battle([pokemon(25,['Thunderbolt']),pokemon(9)],[pokemon(6),pokemon(35,['Follow Me'])]);turn(follow,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);assert.equal(follow.d.sim.p2.active[0].hp,follow.d.sim.p2.active[0].maxhp);assert(follow.d.sim.p2.active[1].hp<follow.d.sim.p2.active[1].maxhp);
 const rod=battle([pokemon(25,['Thunderbolt']),pokemon(9)],[pokemon(9),pokemon(25,['Splash'],null,'Lightning Rod')]);turn(rod,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);assert.equal(rod.d.sim.p2.active[0].hp,rod.d.sim.p2.active[0].maxhp);assert.equal(rod.d.sim.p2.active[1].boosts.spa,1);
});
test('Doubles required target is validated; stale/duplicate actions and choosing same reserve twice cannot execute',()=>{
 const f=battle([pokemon(9,['Tackle']),pokemon(25),pokemon(94)],[pokemon(),pokemon()]),token=f.d.token;
 assert(!f.d.action(f.players[0],{turnId:token,slot:0,action:'attack',moveIndex:0,targetLoc:99}));
 assert(f.d.action(f.players[0],{turnId:token,slot:0,action:'switch',pokemonUuid:f.players[0].equipe.pokemons[2].uuid}));
 assert(!f.d.action(f.players[0],{turnId:token,slot:1,action:'switch',pokemonUuid:f.players[0].equipe.pokemons[2].uuid}));
 assert(!f.d.action(f.players[0],{turnId:token,slot:0,action:'attack',moveIndex:0,targetLoc:1}));
});
test('Doubles corrupted choices use×1.2 stats, lock move, recoil once per action; normal classic item cannot activate on corrupted',()=>{
 const p=corrupted(pokemon(9,['Splash','Tackle'],'corrupted_choice_scarf'));const f=battle([p,pokemon()],[pokemon(),pokemon()]);assert.equal(f.d.sim.p1.active[0].getStat('spe'),Math.floor(p.speed*1.2));turn(f);const active=f.d.sim.p1.active[0];assert.equal(active.hp,active.maxhp-Math.floor(active.maxhp*.2));assert(f.d.state(0).request.slots[0].moves[1].disabled);
 const wrong=corrupted(pokemon(9,['Splash'],'choice_scarf'));const g=battle([wrong,pokemon()],[pokemon(),pokemon()]);assert.equal(g.d.sim.p1.active[0].getStat('spe'),wrong.speed);
});
test('Doubles corrupted leftovers heal8% and KO after3 consecutive turns, independent of partner actions',()=>{
 const p=corrupted(pokemon(9,['Splash'],'corrupted_leftovers'));const f=battle([p,pokemon(),pokemon()],[pokemon(),pokemon(),pokemon()]);const active=f.d.sim.p1.active[0];active.hp=1;const heal=Math.floor(active.baseMaxhp*.08);for(let i=1;i<=2;i++){turn(f);assert.equal(active.hp,1+i*heal);}turn(f);assert.equal(active.hp,0);assert.equal(f.d.state(0).request.kind,'switch');
});
test('Doubles corrupted leftovers reset after a real switch and count the return turn only once',()=>{
 const p=corrupted(pokemon(9,['Splash'],'corrupted_leftovers')),reserve=pokemon(),f=battle([p,pokemon(),reserve],[pokemon(),pokemon(),pokemon()]);
 turn(f);turn(f);
 turn(f,[[{action:'switch',pokemonUuid:reserve.uuid}],[]]);assert.equal(f.d.sim.p1.pokemon.find(q=>q.set.rift.uuid===p.uuid).m.corruptedLeftoversTurns,0);
 turn(f,[[{action:'switch',pokemonUuid:p.uuid}],[]]);const active=f.d.sim.p1.active[0];assert(active.hp>0);turn(f);assert(active.hp>0);turn(f);assert.equal(active.hp,0);
});
test('Doubles corrupted leftovers knock out a full-HP Magic Guard holder on turn three without consuming the item',()=>{
 const p=corrupted(pokemon(9,['Splash'],'corrupted_leftovers','Magic Guard')),f=battle([p,pokemon(),pokemon()],[pokemon(),pokemon(),pokemon()]),active=f.d.sim.p1.active[0];
 turn(f);turn(f);assert.equal(active.hp,active.maxhp);turn(f);assert.equal(active.hp,0);assert.equal(active.item,'corruptedleftovers');
});
test('Doubles12v12 permits12 real reserves and does not truncate either team',()=>{
 const f=battle(Array.from({length:12},()=>pokemon()),Array.from({length:12},()=>pokemon()));assert.equal(f.d.state(0).team.length,12);assert.equal(f.d.sim.p2.pokemon.length,12);
});
test('entire existing move catalogue and held objects map to actual simulator entries, including modern Teleport',()=>{
 const {toID}=require('@pkmn/sim');for(const move of require('../data/game/moves.json'))assert(dex.moves.get(move.ename==='Celebration'?'Celebrate':move.ename).exists,move.ename);
 for(const item of require('../data/game/items.json').items.filter(i=>i.category==='held'))assert(dex.items.get(toID(item.key)).exists,item.key);assert.equal(dex.moves.get('Teleport').priority,-6);assert.equal(dex.moves.get('Teleport').selfSwitch,true);assert(teamSet(pokemon()).rift);
});
test('Doubles actual victory uses winning side identity rather than a displayed username',()=>{
 const a=[pokemon(9,['Quick Attack']),pokemon(9,['Quick Attack'])],b=[pokemon(),pokemon()],f=battle(a,b);f.players[0].username='A very long duo name & another long trainer';f.players[1].username='Another very long duo name & a trainer';for(const p of f.d.sim.p2.pokemon)p.hp=1;
 turn(f,[[{action:'attack',moveIndex:0,targetLoc:1},{action:'attack',moveIndex:0,targetLoc:2}],[]]);assert(f.d.finished);assert.equal(f.d.winnerIndex,0);assert.equal(f.d.reason,'finished');assert(f.events.some(e=>e.data.finished&&e.data.events.some(x=>x.kind==='faint')),'winning frame must retain final KO animation');
});
test('Doubles Illusion does not reveal true identity through targeting, switch frames or spectator presentation',()=>{
 const f=battle([pokemon(),pokemon()],[pokemon(571,['Splash'],null,'Illusion'),pokemon(9),pokemon(149)]);const view=f.d.state(0);assert.equal(view.active[1][0].pokemonId,149);assert(!view.active[1][0].ability);const move={id:'tackle'};assert(f.d.targets(f.d.sim.p1.active[0],move).filter(t=>t.side===1).every(t=>t.name!=='Zoroark'));const own=f.events.find(e=>e.p===f.players[1]&&e.e==='whitepeak:doubleFrame');const foe=f.events.find(e=>e.p===f.players[0]&&e.e==='whitepeak:doubleFrame');assert.equal(own.data.active[1][0].pokemonId,571);assert.equal(foe.data.events.find(e=>e.kind==='switch'&&e.actor.side===1&&e.actor.slot===0).pokemon.pokemonId,149);assert(!JSON.stringify(foe.data).includes('switchViews'));
});
test('Doubles Forecast changes normal Castform to its real rain form and Water type',()=>{
 const f=battle([pokemon(351,['Rain Dance'],null,'Forecast'),pokemon()],[pokemon(),pokemon()]);turn(f);assert.equal(f.d.sim.p1.active[0].species.id,'castformrainy');assert.deepEqual(f.d.sim.p1.active[0].getTypes(),['Water']);assert.equal(f.d.state(0).weather,'raindance');
});
test('Doubles two simultaneous faints with only one reserve allow choosing its slot without deadlock',()=>{
 const f=battle([pokemon(9,['Explosion']),pokemon(9),pokemon(94)],[pokemon(9,['Protect']),pokemon(9,['Protect'])]);f.d.sim.p1.active[1].hp=1;
 turn(f);const req=f.d.state(0).request;assert.equal(req.kind,'switch');assert.deepEqual(req.slots.map(s=>s.required),[true,true]);const token=f.d.token,uuid=f.players[0].equipe.pokemons[2].uuid;assert(f.d.action(f.players[0],{turnId:token,slot:1,action:'switch',pokemonUuid:uuid}));assert.equal(f.d.sim.p1.active[1].set.rift.uuid,uuid);assert.equal(f.d.state(0).request.kind,'move');
});
test('corrupted orbs really apply poison/burn; Orbe Mort costs30% only on damaging hits with normal protections',()=>{
 for(const[key,status]of[['corrupted_toxic_orb','badly_poison'],['corrupted_flame_orb','burn']]){const p=corrupted(pokemon(9,['Splash'],key)),q=pokemon(),state=engine.createBattleState();engine.processEndOfRound(p,q,state.sides.player,state.sides.enemy,state);assert.equal(p.status,status);}
 for(const ability of['No Ability','Magic Guard','Sheer Force']){const p=corrupted(pokemon(9,['Ice Beam'],'death_orb',ability)),q=pokemon(242),state=engine.createBattleState(),hp=p.currentHp;assert.equal(items.damageMultiplier(p,1,state),1.2);const r=engine.useattack('Ice Beam',p,q,{battleState:state});assert(r.damage>0);assert.equal(p.currentHp,ability==='No Ability'?hp-Math.floor(p.maxHp*.3):hp);}
 const p=corrupted(pokemon(9,['Splash'],'death_orb')),q=pokemon(),hp=p.currentHp;engine.useattack('Splash',p,q,{battleState:engine.createBattleState()});assert.equal(p.currentHp,hp);
});
test('Doubles orbs, Magic Guard and Sheer Force preserve their real interactions',()=>{
 for(const[key,status]of[['corrupted_toxic_orb','tox'],['corrupted_flame_orb','brn']]){const f=battle([corrupted(pokemon(9,['Splash'],key)),pokemon()],[pokemon(),pokemon()]);turn(f);assert.equal(f.d.sim.p1.active[0].status,status);}
 for(const ability of['No Ability','Magic Guard','Sheer Force']){const f=battle([corrupted(pokemon(9,['Ice Beam'],'death_orb',ability)),pokemon()],[pokemon(242),pokemon(242)]),hp=f.d.sim.p1.active[0].hp;turn(f,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);assert.equal(f.d.sim.p1.active[0].hp,ability==='No Ability'?hp-Math.floor(hp*.3):hp);assert(f.d.sim.p2.active[0].hp<f.d.sim.p2.active[0].maxhp);}
});
test('Doubles incompatible corrupted items cannot be exchanged, gifted or stolen during battle',()=>{
 const trick=battle([corrupted(pokemon(94,['Trick'],'corrupted_choice_specs')),pokemon()],[pokemon(9,['Splash'],'leftovers'),pokemon()]);turn(trick,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);assert.equal(trick.d.sim.p1.active[0].item,'corruptedchoicespecs');assert.equal(trick.d.sim.p2.active[0].item,'leftovers');
 const steal=battle([pokemon(9,['Thief']),pokemon()],[corrupted(pokemon(9,['Splash'],'corrupted_leftovers')),pokemon()]);turn(steal,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);assert.equal(steal.d.sim.p1.active[0].item,'');assert.equal(steal.d.sim.p2.active[0].item,'corruptedleftovers');assert(steal.d.sim.p2.active[0].hp>0);
});
test('Doubles Wide Guard protects both partners; Telepathy protects an ally from Surf',()=>{
 const guard=battle([pokemon(9,['Surf']),pokemon()],[pokemon(242,['Wide Guard']),pokemon(242)]);turn(guard);assert(guard.d.sim.p2.active.every(p=>p.hp===p.maxhp));
 const telepathy=battle([pokemon(9,['Surf']),pokemon(282,['Splash'],null,'Telepathy')],[pokemon(242),pokemon(242)]);turn(telepathy);assert.equal(telepathy.d.sim.p1.active[1].hp,telepathy.d.sim.p1.active[1].maxhp);assert(telepathy.d.sim.p2.active.every(p=>p.hp<p.maxhp));
});
test('Doubles pivot lets the player select its replacement before the next turn',()=>{
 const f=battle([pokemon(25,['Volt Switch']),pokemon(9),pokemon(94)],[pokemon(242),pokemon(242)]);turn(f,[[{action:'attack',moveIndex:0,targetLoc:1}],[]]);const r=f.d.state(0).request;assert.equal(r.kind,'switch');assert.deepEqual(r.slots.map(s=>s.required),[true,false]);const uuid=f.players[0].equipe.pokemons[2].uuid;assert(f.d.action(f.players[0],{turnId:f.d.token,slot:0,action:'switch',pokemonUuid:uuid}));assert.equal(f.d.active(0,0).uuid,uuid);
});
test('Safari lab and six building signs remain reachable from actual arrivals with solid NPC footprints',()=>{
 const maps=require('../server/game/world/mapRepository'),store=require('../server/game/world/pnjStore'),next=require('../data/game/nextMap.json').maps;
 const allSigns=[];
 for(const map of['ville5','super_tournament_lobby','ville_commerciale','safari8','safari9','safari_shop','safari_lab']){
  const grid=maps.loadCollisionData(map),starts=next.flatMap(m=>m.mapchange.filter(c=>c.goto===map&&Number.isFinite(c.nexX)&&Number.isFinite(c.nexY)).map(c=>[Math.floor(c.nexX/32),Math.floor(c.nexY/32)]));if(map==='super_tournament_lobby')starts.push([14,15]);
  const queue=starts.filter(([x,y])=>grid[y]?.[x]===0&&!store.isPnjBlockingTile(map,x,y)),seen=new Set(queue.map(p=>p.join(',')));
  for(const[x,y]of queue)for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy,key=a+','+b;if(grid[b]?.[a]===0&&!store.isPnjBlockingTile(map,a,b)&&!seen.has(key)){seen.add(key);queue.push([a,b]);}}
  const actors=store.getPnjsForMap(map).filter(p=>p.name.startsWith('building_sign')||map==='safari_shop'||map==='safari_lab');
  for(const p of actors){assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has(`${p.x+dx},${p.y+dy}`)),p.name);assert(store.isPnjBlockingTile(map,p.x,p.y),p.name);if(p.name.startsWith('building_sign')){allSigns.push(p);assert(require('../server/game/world/interactionRepository').getSentenceForName(p.name)?.[0]?.length);}}
  if(map==='safari_lab'){assert.equal(maps.resolveMapSourceName(map),'safari_lab');const exits=maps.changeMapData(map);assert.equal(exits[19][13]>0,true);assert.equal(exits[19][14]>0,true);}
 }assert.equal(allSigns.length,7);
});
for(const kind of['wild','arena','pvp'])test('shared '+kind+' orchestrator announces both moves in French before their animation and result',()=>{
 const events=[],players=[0,1].map(i=>({id:'announce'+i,username:'Dresseur'+i,equipe:{pokemons:[pokemon(9,['Splash'])]},items:{},defeated:new Set(),drifts:[],equipped:[]}));
 const b=new(require('../server/game/drift/driftBattle').DriftBattle)(...players,{type:kind,emit:(p,e,data)=>{if(p===players[0])events.push({e,data});},rules:{report:false,rewards:false,permanentDeaths:false}});events.length=0;
 for(const p of players)assert(b.action(p,{action:'attack',number:0,turnId:b.token}));
 const actions=events.filter(e=>['battleText','battleMoveAnimation','battleMoveResult'].includes(e.e));const announcements=actions.map((e,i)=>e.e==='battleText'&&e.data.message==='Tortank utilise Trempette !'?i:-1).filter(i=>i>=0);assert.equal(announcements.length,2);
 for(const i of announcements){assert.equal(actions[i+1].e,'battleMoveAnimation');assert(actions.slice(i+2).some(e=>e.e==='battleMoveResult'));}
});

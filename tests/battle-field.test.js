const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const held = require('../server/game/items/heldItems');
const pokemon = (extra={}) => ({uuid:Math.random().toString(),name:'Test',truename:'Test',level:50,type1:'Normal',type2:null,maxHp:240,currentHp:240,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,status:'normal',abilities:['Pound'],...extra});
function fixture() {
    const state=engine.createBattleState(),a=pokemon(),b=pokemon();
    const attack=(name,reverse=false)=>engine.useattack(name,reverse?b:a,reverse?a:b,{battleState:state,attackerSide:state.sides[reverse?'enemy':'player'],defenderSide:state.sides[reverse?'player':'enemy'],attackerTeam:[a],defenderTeam:[b],consumePp:false,skipTurnStart:true});
    const end=()=>engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);
    const enter=(p,side='enemy')=>engine.applySwitchInEffects(p,state.sides[side],state.sides[side==='enemy'?'player':'enemy'],state,side==='enemy'?a:b);
    return {state,a,b,attack,end,enter};
}
function random(value,work){const previous=Math.random;Math.random=()=>value;try{return work();}finally{Math.random=previous;}}

for(const [move,key] of [['Trick Room','trickRoomTurns'],['Magic Room','magicRoomTurns'],['Wonder Room','wonderRoomTurns']]) test(`${move}: five turns, restart removes it, no negative timer`,()=>{
    const f=fixture();assert.equal(f.attack(move).success,true);assert.equal(f.state.field[key],5);
    assert.equal(f.attack(move,true).success,true);assert.equal(f.state.field[key],0);
    f.attack(move);for(let i=0;i<4;i++)f.end();assert.equal(f.state.field[key],1);
    assert(f.end().some(m=>/termin|dissip|normal/i.test(m)));assert.equal(f.state.field[key],0);f.end();assert.equal(f.state.field[key],0);
});
test('Trick Room reverses only speed, retains priority; Tailwind doubles speed',()=>{
    const f=fixture();f.a.currentSpeed=150;f.b.currentSpeed=50;
    const order=(am='Pound',bm='Pound')=>engine.orderBattleActions([{pokemon:f.a,moveName:am,side:f.state.sides.player},{pokemon:f.b,moveName:bm,side:f.state.sides.enemy}],f.state)[0].pokemon;
    assert.equal(order(),f.a);f.attack('Trick Room');assert.equal(order(),f.b);assert.equal(order('Quick Attack'),f.a);
    f.attack('Tailwind');assert.equal(engine.getBattleSpeed(f.a,f.state.sides.player,f.state),300);
});
test('hazards target the side, bypass Protect, a substitute, type immunity and an airborne target',()=>{
    for(const name of ['Stealth Rock','Spikes','Toxic Spikes','Sticky Web']) {
        const f=fixture();Object.assign(engine.ensureBattleData(f.b),{protect:true,substituteHp:60,semiInvulnerable:'airborne',chargeMove:'Fly'});f.b.type1='Flying';f.b.passiveAbility='Levitate';
        const result=f.attack(name);assert.equal(result.success,true,name);assert(Object.values(f.state.sides.enemy.hazards).some(Boolean),name);
    }
});
test('hazards have capped layers and fail at the cap without a fake successful placement',()=>{
    for(const [name,key,max]of [['Spikes','spikes',3],['Toxic Spikes','toxicSpikes',2],['Stealth Rock','stealthRock',1],['Sticky Web','stickyWeb',1]]){
        const f=fixture();for(let i=0;i<max;i++)assert.equal(f.attack(name).success,true);assert.equal(f.attack(name).success,false,name);assert.equal(Number(f.state.sides.enemy.hazards[key]),max);
    }
});
test('Stealth Rock type damage and Spikes grounded layers; Magic Guard only prevents damage',()=>{
    const f=fixture();f.attack('Stealth Rock');const fireFlying=pokemon({type1:'Fire',type2:'Flying'});f.enter(fireFlying);assert.equal(fireFlying.currentHp,120);
    const g=fixture();for(let i=0;i<3;i++)g.attack('Spikes');const grounded=pokemon(),flying=pokemon({type1:'Flying'}),levitate=pokemon({passiveAbility:'Levitate'});g.enter(grounded);g.enter(flying);g.enter(levitate);assert.equal(grounded.currentHp,180);assert.equal(flying.currentHp,240);assert.equal(levitate.currentHp,240);
    g.attack('Toxic Spikes');const guard=pokemon({passiveAbility:'Magic Guard'});g.enter(guard);assert.equal(guard.currentHp,240);assert.equal(guard.status,'poison');
});
test('Toxic Spikes respect Misty Terrain, ignore Safeguard and are absorbed by grounded Poison types',()=>{
    const f=fixture();f.attack('Toxic Spikes');f.attack('Toxic Spikes');f.attack('Misty Terrain');const protectedMon=pokemon();f.enter(protectedMon);assert.equal(protectedMon.status,'normal');
    f.state.terrain.kind=null;f.state.sides.enemy.screens.safeguardTurns=5;const poisoned=pokemon();f.enter(poisoned);assert.equal(poisoned.status,'badly_poison');
    f.enter(pokemon({type1:'Steel'}));assert.equal(f.state.sides.enemy.hazards.toxicSpikes,2);f.enter(pokemon({type1:'Poison'}));assert.equal(f.state.sides.enemy.hazards.toxicSpikes,0);
});
test('Sticky Web triggers Contrary/Defiant correctly and does not affect airborne entrants',()=>{
    const f=fixture();f.attack('Sticky Web');const contrary=pokemon({passiveAbility:'Contrary'}),defiant=pokemon({passiveAbility:'Defiant'}),flying=pokemon({type1:'Flying'});
    f.enter(contrary);f.enter(defiant);f.enter(flying);assert.equal(contrary.__battle.statStages.speed,1);assert.equal(defiant.__battle.statStages.speed,-1);assert.equal(defiant.__battle.statStages.attack,2);assert.equal(flying.__battle.statStages.speed,0);
});
test('Defog removes both hazards and only the target screens; Tailwind and Lucky Chant remain',()=>{
    const f=fixture();for(const side of Object.values(f.state.sides)){Object.assign(side.hazards,{spikes:3,toxicSpikes:2,stealthRock:true,stickyWeb:true});Object.keys(side.screens).forEach(k=>side.screens[k]=4);}
    f.attack('Defog');for(const side of Object.values(f.state.sides))assert(Object.values(side.hazards).every(v=>!v));
    assert.equal(f.state.sides.enemy.screens.reflectTurns,0);assert.equal(f.state.sides.enemy.screens.safeguardTurns,0);assert.equal(f.state.sides.enemy.screens.tailwindTurns,4);assert.equal(f.state.sides.enemy.screens.luckyChantTurns,4);assert.equal(f.state.sides.player.screens.reflectTurns,4);
});
test('Rapid Spin clears own hazards and bindings only on a hit; Ghost immunity leaves hazards intact',()=>{
    for(const ghost of [false,true]){const f=fixture();f.state.sides.player.hazards.spikes=2;f.state.sides.enemy.hazards.stealthRock=true;Object.assign(engine.ensureBattleData(f.a),{trappedTurns:3,leechSeedSource:f.b});if(ghost)f.b.type1='Ghost';random(.5,()=>f.attack('Rapid Spin'));assert.equal(f.state.sides.player.hazards.spikes,ghost?2:0);assert.equal(f.a.__battle.trappedTurns,ghost?3:0);assert.equal(Boolean(f.a.__battle.leechSeedSource),ghost);assert.equal(f.state.sides.enemy.hazards.stealthRock,true);assert.equal(f.a.__battle.statStages.speed,0);}
});
test('Brick Break removes screens before calculating damage, fails to break through Protect or Ghost',()=>{
    for(const block of ['none','protect','ghost']){const f=fixture();f.state.sides.enemy.screens.reflectTurns=4;f.state.sides.enemy.screens.lightScreenTurns=4;if(block==='protect')engine.ensureBattleData(f.b).protect=true;if(block==='ghost')f.b.type1='Ghost';const result=random(.5,()=>f.attack('Brick Break'));assert.equal(f.state.sides.enemy.screens.reflectTurns,block==='none'?0:4);if(block==='none'){const g=fixture();assert.equal(result.damage,random(.5,()=>g.attack('Brick Break')).damage);}}
});
test('Mist prevents opposing stat drops including Intimidate; self drops and Infiltrator remain possible',()=>{
    const f=fixture();f.attack('Mist');f.attack('Growl',true);assert.equal(f.a.__battle.statStages.attack,0);
    f.b.passiveAbility='Intimidate';engine.applySwitchInEffects(f.b,f.state.sides.enemy,f.state.sides.player,f.state,f.a);assert.equal(f.a.__battle.statStages.attack,0);
    f.b.passiveAbility='Infiltrator';f.attack('Growl',true);assert.equal(f.a.__battle.statStages.attack,-1);
    random(.5,()=>f.attack('Superpower'));assert.equal(f.a.__battle.statStages.attack,-2);
});
test('Reflect/Light Screen halve their damage class; criticals and Infiltrator ignore them',()=>{
    for(const [screen,move]of [['Reflect','Pound'],['Light Screen','Water Gun']]){const base=fixture(),f=fixture();f.attack(screen,true);const normal=random(.5,()=>base.attack(move)).damage;assert.equal(random(.5,()=>f.attack(move)).damage,Math.floor(normal/2));const crit=fixture();crit.attack(screen,true);assert.equal(random(0,()=>crit.attack(move)).damage,random(0,()=>fixture().attack(move)).damage);const infiltrator=fixture();infiltrator.attack(screen,true);infiltrator.a.passiveAbility='Infiltrator';assert.equal(random(.5,()=>infiltrator.attack(move)).damage,normal);}
});
test('Wonder Room swaps underlying defenses, not the defense stages',()=>{
    const f=fixture();f.b.currentDefense=50;f.b.currentSpecialDefense=200;engine.ensureBattleData(f.b).statStages.defense=2;f.attack('Wonder Room');const result=random(.5,()=>f.attack('Pound'));
    const g=fixture();g.b.currentDefense=200;engine.ensureBattleData(g.b).statStages.defense=2;assert.equal(result.damage,random(.5,()=>g.attack('Pound')).damage);
});
test('Magic Room disables choice items and restores them on cancellation without consuming them',()=>{
    const f=fixture();f.a.heldItem='choice_scarf';assert.equal(engine.getBattleSpeed(f.a,null,f.state),150);f.attack('Magic Room');assert.equal(held.enabled(f.a,f.state),false);assert.equal(engine.getBattleSpeed(f.a,null,f.state),100);f.attack('Magic Room');assert.equal(engine.getBattleSpeed(f.a,null,f.state),150);assert.equal(f.a.heldItem,'choice_scarf');
});

test('Magic Room clears prior choice locks and Quick Guard includes ability-granted priority',()=>{
    const f=fixture();f.a.heldItem='choice_scarf';engine.ensureBattleData(f.a).choiceMove='Pound';f.attack('Magic Room');assert.equal(f.a.__battle.choiceMove,undefined);f.attack('Magic Room');assert.equal(held.allowsMove(f.a,'Water Gun',f.state),true);
    const g=fixture();g.attack('Quick Guard',true);g.a.passiveAbility='Prankster';assert.equal(g.attack('Thunder Wave').blocked,true);assert.equal(g.b.status,'normal');
});
test('Gravity raises accuracy, grounds flyers for hazards and wears off without permanent grounding',()=>{
    const f=fixture();const before=random(.8,()=>f.attack('Hypnosis'));assert.equal(before.missed,true);f.attack('Gravity');assert.equal(random(.8,()=>f.attack('Hypnosis')).success,true);f.attack('Spikes');const p=pokemon({type1:'Flying'});f.enter(p);assert.equal(p.currentHp,210);for(let i=0;i<5;i++)f.end();const q=pokemon({type1:'Flying'});f.enter(q);assert.equal(q.currentHp,240);
});
test('Misty Terrain blocks confusion for grounded targets only',()=>{
    const f=fixture();f.attack('Misty Terrain');f.attack('Confuse Ray');assert.equal(f.b.__battle.confusionTurns,0);f.b.type1='Flying';f.attack('Confuse Ray');assert(f.b.__battle.confusionTurns>0);
});
test('Grassy Terrain weakens Earthquake only for grounded targets and heals 1/16',()=>{
    const base=fixture(),f=fixture();f.attack('Grassy Terrain');const normal=random(.5,()=>base.attack('Earthquake')).damage;assert.equal(random(.5,()=>f.attack('Earthquake')).damage,Math.floor(normal/2));f.a.currentHp=100;f.end();assert.equal(f.a.currentHp,115);
});
test('Fairy Lock prevents switching next turn, expires, and Ghosts can still leave',()=>{
    const f=fixture();f.attack('Fairy Lock');assert.equal(f.attack('Fairy Lock').success,false);f.end();assert.equal(engine.canSwitchOut(f.a,f.b,f.state),false);f.a.type1='Ghost';assert.equal(engine.canSwitchOut(f.a,f.b,f.state),true);f.a.type1='Normal';f.end();assert.equal(engine.canSwitchOut(f.a,f.b,f.state),true);
});
test('Ion Deluge turns Normal moves Electric for the current turn then expires',()=>{
    const f=fixture();f.b.type1='Ground';f.attack('Ion Deluge');assert.equal(random(.5,()=>f.attack('Pound')).effectiveness,0);f.end();assert.equal(random(.5,()=>f.attack('Pound')).effectiveness,1);
});
test('a Pokemon knocked out by entry hazards cannot activate its entry ability',()=>{
    const f=fixture();f.attack('Stealth Rock');const p=pokemon({currentHp:1,passiveAbility:'Drizzle'});f.enter(p);assert.equal(p.currentHp,0);assert.equal(f.state.weather.kind,null);
});

test('Electric/Grassy/Psychic terrain boosts apply only to grounded attackers',()=>{
    for(const [terrain,move] of [['electric_terrain','Thunderbolt'],['grassy_terrain','Energy Ball'],['psychic_terrain','Psychic']]) {
        const base=fixture(),f=fixture();f.state.terrain={kind:terrain,turns:5};
        const damage=random(.5,()=>base.attack(move)).damage,boosted=random(.5,()=>f.attack(move)).damage;assert(boosted>=damage*1.5-1 && boosted<=damage*1.5+2);
        const air=fixture();air.a.passiveAbility='Levitate';air.state.terrain={kind:terrain,turns:5};assert.equal(random(.5,()=>air.attack(move)).damage,damage);
    }
});
test('Psychic terrain blocks opposing priority against grounded targets, not levitating targets',()=>{
    const f=fixture();f.state.terrain={kind:'psychic_terrain',turns:5};assert.equal(f.attack('Quick Attack').blocked,true);
    f.b.passiveAbility='Levitate';assert.equal(random(.5,()=>f.attack('Quick Attack')).damage>0,true);
    f.b.__battle.grounded=true;assert.equal(f.attack('Quick Attack').blocked,true);
});
test('weather/terrain/screens cannot be refreshed while active; expiration leaves neither negative timers nor stale effects',()=>{
    const f=fixture();for(const move of ['Rain Dance','Electric Terrain','Reflect','Light Screen','Safeguard','Mist','Tailwind','Lucky Chant','Gravity','Mud Sport','Water Sport']){assert.equal(f.attack(move).success,true,move);assert.equal(f.attack(move).success,false,move);}
    for(let i=0;i<5;i++)f.end();assert.equal(f.state.weather.kind,null);assert.equal(f.state.terrain.kind,null);assert(Object.values(f.state.sides.player.screens).every(n=>n===0));assert(Object.values(f.state.field).every(n=>n===0));
});
test('Mud Sport and Water Sport reduce their type to one third, even for airborne attackers',()=>{
    for(const [sport,move]of [['Mud Sport','Thunderbolt'],['Water Sport','Flamethrower']]){const f=fixture(),g=fixture();f.a.type1=g.a.type1='Flying';f.attack(sport);assert.equal(random(.5,()=>f.attack(move)).damage,Math.floor(random(.5,()=>g.attack(move)).damage/3));}
});
test('Safeguard blocks confusion and status; Haze resets stages on both sides without clearing terrain',()=>{
    const f=fixture();f.attack('Safeguard',true);f.attack('Confuse Ray');f.attack('Toxic');assert.equal(f.b.status,'normal');assert.equal(f.b.__battle.confusionTurns,0);
    f.a.__battle.statStages.attack=4;f.b.__battle.statStages.speed=-3;f.attack('Grassy Terrain');f.attack('Haze');assert.equal(f.a.__battle.statStages.attack,0);assert.equal(f.b.__battle.statStages.speed,0);assert.equal(f.state.terrain.kind,'grassy_terrain');
});

test('Magic Bounce still reflects hazards exactly once, and Defog cannot lower evasion through Mist before clearing it',()=>{
    for(const move of ['Spikes','Toxic Spikes','Stealth Rock','Sticky Web']){const f=fixture();f.b.passiveAbility='Magic Bounce';f.attack(move);assert(Object.values(f.state.sides.player.hazards).some(Boolean),move);assert(!Object.values(f.state.sides.enemy.hazards).some(Boolean),move);}
    const f=fixture();f.attack('Mist',true);f.attack('Defog');assert.equal(f.b.__battle.statStages.evasion,0);assert.equal(f.state.sides.enemy.screens.mistTurns,0);
});

test('Wide Guard stops spread attacks, not single-target moves; Mat Block allows status moves; guards expire at round end',()=>{
    const f=fixture();f.attack('Wide Guard',true);assert.equal(f.attack('Earthquake').blocked,true);assert.equal(f.attack('Blizzard').blocked,true);assert.equal(random(.5,()=>f.attack('Pound')).blocked,false);assert.equal(f.attack('Growl').blocked,false);f.end();assert.equal(random(.5,()=>f.attack('Earthquake')).blocked,false);
    const g=fixture();g.attack('Mat Block',true);assert.equal(g.attack('Pound').blocked,true);assert.equal(g.attack('Growl').blocked,false);g.end();engine.ensureBattleData(g.b).activeMoveActions=2;assert.equal(g.attack('Mat Block',true).blocked,true);
});
test('Quick Guard and Crafty Shield protect only their intended class, without blocking hazards',()=>{
    const f=fixture();f.attack('Quick Guard',true);assert.equal(f.attack('Quick Attack').blocked,true);assert.equal(random(.5,()=>f.attack('Pound')).blocked,false);f.end();
    f.attack('Crafty Shield',true);assert.equal(f.attack('Growl').blocked,true);assert.equal(random(.5,()=>f.attack('Pound')).blocked,false);assert.equal(f.attack('Spikes').success,true);
});

test('Transform can copy and activate an entry talent using the correct sides under Mist',()=>{
    const f=fixture();f.b.passiveAbility='Intimidate';f.attack('Mist',true);assert.doesNotThrow(()=>f.attack('Transform'));
    assert.equal(f.a.passiveAbility,'Intimidate');assert.equal(f.b.__battle.statStages.attack,0);
});

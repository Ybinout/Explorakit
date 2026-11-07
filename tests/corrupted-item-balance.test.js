const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const held = require('../server/game/items/heldItems');
const policy = require('../server/game/items/heldItemPolicy');
const {clearSwitchOutState} = require('../server/game/battle/battleTeam');
const {DoublesBattle} = require('../server/game/doubles/doublesBattle');
const {RaidBattle} = require('../server/game/raids/RaidBattle');
const {make} = require('../scripts/calibrateCorruptionRaids');
const codec = require('../server/game/drift/checkpointCodec');
const catalog = require('../data/game/items.json').items;

function mon(item = null, ability = 'Keen Eye', moves = ['Splash']) {
    const p = make(9, 100, 4, moves, ability);
    p.heldItem = item;
    if (item?.startsWith('corrupted_') || item === 'death_orb') {
        p.corruption = {version: 1, revision: 1, permanent: true, modules: {}};
    }
    return p;
}
function singleRound(p, q, state) {
    return engine.processEndOfRound(p, q, state.sides.player, state.sides.enemy, state);
}
function doubles(p, reserves = []) {
    const players = [[p, mon(), ...reserves], [mon(), mon(), mon()]].map((pokemons, id) => ({id, username: 'Test'+id, equipe: {pokemons}}));
    const b = new DoublesBattle(...players, {emit() {}});
    b.sim.prng.setSeed('1,2,3,4');
    return {b, players};
}
function doubleRound(f, lead = {action: 'attack', moveIndex: 0}) {
    const token = f.b.token;
    for (let i = 0; i < 2; i++) for (const slot of f.b.state(i).request.slots) {
        if (!slot.required) continue;
        assert(f.b.action(f.players[i], {turnId: token, slot: slot.slot, ...(i===0 && slot.slot===0 ? lead : {action:'attack', moveIndex:0})}));
    }
}
function raid(p, reactive = true) {
    return new RaidBattle([p, mon(), mon(), mon()].map(pokemon => ({pokemon, ownerId: 1, ownerName: 'Test'})), mon(), {seed: [1,2,3,4], reactive, now: () => 1000});
}
function raidRound(b, moveIndex = 0, targetLoc) {
    const turn = b.sim.turn;
    let count = 0;
    while (!b.finished && b.sim.turn === turn) {
        const slot = b.flowVersion===2 ? b.view(1).currentSlot : count;
        b.action(1, {token: b.token, slot, action: 'attack', moveIndex: slot===0 ? moveIndex : 0, ...(slot===0 && targetLoc ? {targetLoc} : {})});
        assert(++count <= 4);
    }
}

test('catalogue retains the same unique recipes, descriptions and exclusive corrupted equipment policy', () => {
    for (const [key, recoil] of [['death_orb',.15], ['corrupted_choice_band',.05], ['corrupted_choice_specs',.05], ['corrupted_choice_scarf',.05]]) {
        const matches = catalog.filter(i => i.key===key);
        assert.equal(matches.length,1);
        assert.equal(matches[0].recoilFraction,recoil);
        assert(matches[0].description.includes(recoil===.15?'15 %':'5 %'));
        assert(!policy.canHold(mon(),key));
        assert(policy.canHold(mon(key),key));
    }
    const item=catalog.find(i=>i.key==='corrupted_leftovers');
    assert.equal(item.healFraction,.07); assert.equal(item.recoilFraction,.2); assert.equal(item.maxActiveTurns,3);
    assert(!item.description.includes('K.O.'));
});

test('single Restes cycle heals before recoil, including at full HP, and never becomes an automatic KO', () => {
    const p=mon('corrupted_leftovers'), q=mon(), state=engine.createBattleState();
    p.maxHp=1000;p.currentHp=500;
    for (const expected of [570,640,510,580,650,520]) {singleRound(p,q,state);assert.equal(p.currentHp,expected);}
    p.currentHp=1000;
    for(let n=0;n<3;n++)singleRound(p,q,state);
    assert.equal(p.currentHp,800,'full-health healing is capped before subtracting the cost');
    p.currentHp=1;for(let n=0;n<3;n++)singleRound(p,q,state);
    assert.equal(p.currentHp,11,'the heal occurs before the turn-three penalty');
});

test('single Restes respect Magic Guard, Heal Block, suppression, substitutes, Endure and a real switch', () => {
    const p=mon('corrupted_leftovers'), q=mon(), s=engine.createBattleState();
    p.maxHp=1000;p.currentHp=500;engine.ensureBattleData(p);
    p.__battle.healBlockTurns=8;
    for(let n=0;n<3;n++)singleRound(p,q,s);
    assert.equal(p.currentHp,300,'Heal Block cannot remove the penalty');
    p.__battle.healBlockTurns=8;p.__battle.endure=true;p.__battle.substituteHp=200;p.currentHp=100;
    for(let n=0;n<3;n++){p.__battle.endure=true;singleRound(p,q,s);}
    assert.equal(p.currentHp,0);assert.equal(p.__battle.substituteHp,200);
    const guard=mon('corrupted_leftovers','Magic Guard');guard.maxHp=1000;guard.currentHp=500;
    for(let n=0;n<3;n++)singleRound(guard,q,s);
    assert.equal(guard.currentHp,710);
    const klutz=mon('corrupted_leftovers','Klutz');klutz.maxHp=1000;klutz.currentHp=500;
    for(let n=0;n<3;n++)singleRound(klutz,q,s);
    assert.equal(klutz.currentHp,500);klutz.passiveAbility='Keen Eye';singleRound(klutz,q,s);assert.equal(klutz.currentHp,570);
    clearSwitchOutState(klutz);singleRound(klutz,q,s);assert.equal(klutz.currentHp,640);assert.equal(klutz.__battle.corruptedActiveTurns,1);
});

test('all three Choice items lock, cost5% once on a status or protected move, and reset on switch', () => {
    for(const [key,stat] of [['corrupted_choice_band','attack'],['corrupted_choice_specs','specialAttack'],['corrupted_choice_scarf','speed']]) {
        const p=mon(key,'Keen Eye',['Splash','Tackle']), q=mon(), state=engine.createBattleState(), hp=p.currentHp;
        assert.equal(held.statMultiplier(p,stat,state),1.35);
        const first=engine.useattack('Splash',p,q,{battleState:state});assert(first.attempted);
        assert.equal(p.currentHp,hp-Math.floor(p.maxHp*.05));assert(!held.allowsMove(p,'Tackle',state));
        const before=p.currentHp;const blocked=engine.useattack('Tackle',p,q,{battleState:state});assert(blocked.blocked);assert.equal(p.currentHp,before);
        clearSwitchOutState(p);q.__battle={protect:true};engine.useattack('Tackle',p,q,{battleState:state});
        assert.equal(p.currentHp,before-Math.floor(p.maxHp*.05));assert.equal(p.__battle.choiceMove,'Tackle');
    }
});

test('Choice recoil respects Magic Guard and item suppression; multi-hit and charge moves pay once per action', () => {
    for(const ability of ['Magic Guard','Klutz']) {
        const p=mon('corrupted_choice_band',ability,['Splash']), q=mon(), hp=p.currentHp;
        engine.useattack('Splash',p,q,{battleState:engine.createBattleState()});assert.equal(p.currentHp,hp);
    }
    for(const move of ['Bullet Seed','Fly']) {
        const p=mon('corrupted_choice_band','Keen Eye',[move]), q=make(242,500,4,['Splash'],'Keen Eye'), hp=p.currentHp;
        engine.useattack(move,p,q,{battleState:engine.createBattleState()});assert.equal(p.currentHp,hp-Math.floor(p.maxHp*.05));
    }
});

test('Doubles Restes cycle, Heal Block and Magic Room use real residual order without pausing field time', () => {
    const f=doubles(mon('corrupted_leftovers')), p=f.b.sim.p1.active[0];p.maxhp=p.baseMaxhp=1000;p.hp=500;
    for(const expected of [570,640,510,580,650,520]) {doubleRound(f);assert.equal(p.hp,expected);}
    p.addVolatile('healblock');for(let n=0;n<3;n++)doubleRound(f);assert.equal(p.hp,320);
    const g=doubles(mon('corrupted_leftovers')), a=g.b.sim.p1.active[0];a.maxhp=a.baseMaxhp=1000;a.hp=500;
    g.b.sim.field.addPseudoWeather('magicroom',a,g.b.sim.dex.moves.get('magicroom'));for(let n=0;n<3;n++)doubleRound(g);assert.equal(a.hp,500);
    g.b.sim.field.removePseudoWeather('magicroom');doubleRound(g);assert.equal(a.hp,570);assert.equal(a.m.corruptedLeftoversTurns,4);
});

for(const reactive of [false,true])test('Raid '+(reactive?'reactive':'legacy')+' Restes trigger on turns3/6 only and survive a cold checkpoint', () => {
    let b=raid(mon('corrupted_leftovers'),reactive);let p=b.sim.p1.active[0];p.maxhp=p.baseMaxhp=1000;p.hp=500;
    for(const expected of [570,640]) {raidRound(b);assert.equal(p.hp,expected);}
    delete p.m.corruptedLeftoversLastTurn; // Also accepts pre-hotfix native checkpoints.
    const snapshot=codec.decode(codec.encode(b.snapshot()));b=RaidBattle.restore(snapshot,()=>1000);p=b.sim.p1.active[0];
    for(const expected of [510,580,650,520]) {raidRound(b);assert.equal(p.hp,expected);}
    assert.equal(p.m.corruptedLeftoversTurns,6);
});

test('raid Choice cost is per launched action, never multiplied by allies, boss casts or relay', () => {
    const b=raid(mon('corrupted_choice_specs','Keen Eye',['Splash','Tackle'])), p=b.sim.p1.active[0], hp=p.hp;
    raidRound(b);assert.equal(p.hp,hp-Math.floor(p.baseMaxhp*.05));
    assert.equal(b.view(1).allies[0].moves[1].disabled,true);
    const turn=b.sim.turn;let n=0;while(b.sim.turn===turn){const slot=b.view(1).currentSlot;b.action(1,{token:b.token,slot,action:slot===0?'pass':'attack',...(slot===0?{target:1}:{moveIndex:0})});assert(++n<=5);}
    assert.equal(p.hp,hp-Math.floor(p.baseMaxhp*.05),'passing the turn is not launching a move');
});

test('Orbe Mort retains a20% bonus and costs15% once, including a raid AoE and protected targets', () => {
    for(const ability of ['Keen Eye','Magic Guard','Sheer Force']) {
        const b=raid(mon('death_orb',ability,['Surf'])),p=b.sim.p1.active[0],hp=p.hp;
        raidRound(b);assert.equal(p.hp,ability==='Magic Guard'?hp:hp-Math.floor(p.baseMaxhp*.15),'Surf has no secondary for Sheer Force');
    }
    const p=mon('death_orb','Keen Eye',['Tackle']), q=mon(), state=engine.createBattleState(),hp=p.currentHp;
    q.__battle={protect:true};engine.useattack('Tackle',p,q,{battleState:state});assert.equal(p.currentHp,hp);
    assert.equal(held.damageMultiplier(p,1,state),1.2);
});

for(const [key,stat,model] of [['corrupted_choice_band','atk','attack'],['corrupted_choice_specs','spa','specialAttack'],['corrupted_choice_scarf','spe','speed']])test('native '+key+' grants35% and charges5% after a move but never when sleep prevents it',()=>{
 const pokemon=mon(key,'Keen Eye',['Splash','Tackle']), f=doubles(pokemon),p=f.b.sim.p1.active[0];
 assert.equal(p.getStat(stat),f.b.sim.modify(pokemon[model],1.35));const hp=p.hp;
 doubleRound(f);assert.equal(p.hp,hp-Math.floor(p.baseMaxhp*.05));assert(f.b.state(0).request.slots[0].moves[1].disabled);
 p.setStatus('slp',p,f.b.sim.dex.moves.get('spore'));p.statusState.time=3;const before=p.hp;doubleRound(f);assert.equal(p.hp,before);
});
for(const mode of ['wild','arena','pvp'])test('shared '+mode+' controller applies periodic Restes and Choice costs through normal turn resolution',()=>{
 const p=mon('corrupted_leftovers'),q=mon('corrupted_choice_band');p.maxHp=1000;p.currentHp=500;
 const players=[p,q].map((pokemon,i)=>({id:'balance'+i,username:'Balance'+i,equipe:{pokemons:[pokemon]},items:{},defeated:new Set(),drifts:[],equipped:[]}));
 let clock=1000;const b=new(require('../server/game/drift/driftBattle').DriftBattle)(...players,{type:mode,now:()=>clock,emit(){},rules:{report:false,rewards:false,permanentDeaths:false}});
 const initial=q.currentHp;
 for(let n=1;n<=3;n++){if(!b.awaiting){clock=b.nextRoundAt;b.tick();}const token=b.token;for(const player of players)assert(b.action(player,{action:'attack',number:0,turnId:token}));}
 assert.equal(p.currentHp,510);assert.equal(q.currentHp,initial-3*Math.floor(q.maxHp*.05));
});

test('native item replacement on the field cannot restart the Restes three-turn cycle',()=>{
 const f=doubles(mon('corrupted_leftovers')),p=f.b.sim.p1.active[0];p.maxhp=p.baseMaxhp=1000;p.hp=500;
 doubleRound(f);doubleRound(f);assert(p.setItem('deathorb'));assert(p.setItem('corruptedleftovers'));doubleRound(f);assert.equal(p.hp,510);assert.equal(p.m.corruptedLeftoversTurns,3);
});

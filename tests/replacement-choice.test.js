const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestReplacement } = require('../server/game/battle/replacementChoice');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const factory = require('../server/game/drift/pokemonFactory');
const { encode, decode } = require('../server/game/drift/checkpointCodec');

function mon(id=7) {
    const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Growl'];p.movePp=[40];return p;
}
function owner(id=1) { return {userId:id,equipe:{pokemons:[mon(),mon(4),mon(25)]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()}; }
function fixture(type='wild') {
    const a=owner(),b=owner(2),events=[];if(type!=='pvp')b.npc=true;
    b.equipe.pokemons=b.equipe.pokemons.slice(0,1);
    let now=0;
    const battle=new DriftBattle(a,b,{type,emit:(p,name,payload)=>events.push({id:p.userId,name,payload:JSON.parse(JSON.stringify(payload))}),now:()=>now,random:()=>.9,paceMs:0});
    return {a,b,battle,events,advance:ms=>{now+=ms;battle.tick();}};
}
function ask(battle) { battle.prune();battle.awaiting=false;battle.request(); }

test('solo replacement validates the request, alive index and action, then cleans both listeners',async()=>{
    const socket=new EventEmitter(),prompts=[];
    socket.on('requestAction',data=>prompts.push(data));
    const player={id:'p',equipe:{pokemons:[{currentHp:0},{currentHp:0},{currentHp:4},{currentHp:8}]}};
    const io={sockets:{sockets:new Map([['p',socket]])}};
    const choice=requestReplacement(io,player);
    assert.deepEqual(prompts[0].allowedPokemonIndexes,[2,3]);
    socket.emit('actionResponse',{action:'change',number:3,replacementId:'stale'});
    assert.equal(prompts.length,1);
    const token=prompts[0].replacementId;
    for(const payload of [{action:'attack',number:0},{action:'change',number:1},{action:'change',number:999},{action:'change',number:2.5}])socket.emit('actionResponse',{...payload,replacementId:token});
    assert.equal(prompts.length,5);
    socket.emit('actionResponse',{action:'change',number:3,replacementId:token});
    assert.deepEqual(await choice,{action:'change',number:3});
    assert.equal(socket.listenerCount('actionResponse'),0);assert.equal(socket.listenerCount('disconnect'),0);
});
test('solo replacement disconnect and timeout release listeners without leaving a battle stuck',async()=>{
    for(const disconnected of [true,false]){
        const socket=new EventEmitter(),player={id:'p',equipe:{pokemons:[{currentHp:0},{currentHp:5}]}};
        const choice=requestReplacement({sockets:{sockets:new Map([['p',socket]])}},player,{timeoutMs:5});
        if(disconnected)socket.emit('disconnect');
        const result=await choice;assert.equal(result.action,disconnected?'disconnect':'change');
        assert.equal(socket.listenerCount('actionResponse'),0);assert.equal(socket.listenerCount('disconnect'),0);
    }
});
for(const type of ['wild','trainer','arena','pvp'])test(`${type}: KO waits for the selected reserve and grants no free attack, PP loss or extra turn`,()=>{
    const {a,battle,events}=fixture(type),dead=a.equipe.pokemons[0],chosen=a.equipe.pokemons[2];
    dead.currentHp=0;ask(battle);const token=battle.token,round=battle.round;
    assert.equal(battle.active(0),dead);assert.equal(battle.replacementPhase,true);
    assert(events.some(e=>e.id===1&&e.name==='requestAction'&&e.payload.replacement));
    for(const payload of [{action:'attack',number:0},{action:'bag',itemKey:'pokeball'},{action:'flee'},{action:'change',number:0},{action:'change',number:99}])assert.equal(battle.action(a,{...payload,turnId:token}),false);
    assert.equal(battle.action(a,{action:'change',number:2,turnId:'stale'}),false);
    const pp=chosen.movePp[0],hp=chosen.currentHp;
    assert(battle.action(a,{action:'change',number:2,turnId:token}));
    assert.equal(battle.active(0),chosen);assert(!a.equipe.pokemons.includes(dead));
    assert.equal(chosen.movePp[0],pp);assert.equal(chosen.currentHp,hp);assert.equal(battle.round,round+1);
    assert.equal(events.filter(e=>e.name==='battleMoveAnimation').length,0);
    assert.equal(battle.action(a,{action:'change',number:1,turnId:token}),false);
    battle.finish(null,'fled');
});
test('simultaneous PvP KO collects both private choices before entrants appear; reconnect and checkpoint preserve them',()=>{
    const {a,b,battle}=fixture('pvp');b.equipe.pokemons.push(mon(19),mon(1));
    // Reattach the fixture reserves as a fresh real battle would.
    require('../server/game/drift/driftEffects').attach(b.equipe.pokemons,b,true,()=>.9);
    a.equipe.pokemons[0].currentHp=b.equipe.pokemons[0].currentHp=0;ask(battle);
    const token=battle.token,chosenA=a.equipe.pokemons[2],chosenB=b.equipe.pokemons[1];
    assert(battle.action(a,{action:'change',number:2,turnId:token}));assert.notEqual(battle.active(0),chosenA);
    const restored=decode(encode(battle)),events=[];restored.emit=(p,name,payload)=>events.push({id:p.userId,name,payload});restored.now=()=>0;restored.random=()=>.9;
    for(const p of [restored.a,restored.b])require('../server/game/drift/driftEffects').attach(p.equipe.pokemons,p,true,()=>.9);
    restored.resume(restored.b);assert(events.some(e=>e.id===2&&e.name==='requestAction'&&e.payload.replacement&&e.payload.turnId===token));
    restored.resume(restored.a);assert(!events.some(e=>e.id===1&&e.name==='requestAction'));
    assert(restored.action(restored.b,{action:'change',number:1,turnId:token}));
    assert.equal(restored.active(0).uuid,chosenA.uuid);assert.equal(restored.active(1).uuid,chosenB.uuid);
    restored.finish(null,'fled');battle.finish(null,'fled');
});
test('entry hazard KO prompts again; protected KO remains disabled until a later heal; no reprocessed loss',()=>{
    const {a,battle,events}=fixture(),first=a.equipe.pokemons[0],fragile=a.equipe.pokemons[1],last=a.equipe.pokemons[2];
    first.heldItem='rift_talisman';first.currentHp=0;fragile.currentHp=1;battle.sides[0].hazards.stealthRock=true;
    ask(battle);assert.equal(first.riftFainted,true);assert.equal(first.heldItem,null);
    assert(battle.action(a,{action:'change',number:1,turnId:battle.token}));
    assert.equal(battle.replacementPhase,true);assert.equal(battle.active(0),fragile);
    const prompt=events.filter(e=>e.name==='requestAction'&&e.payload.replacement).at(-1).payload;
    assert.deepEqual(prompt.allowedPokemonIndexes,[2]);
    assert(battle.action(a,{action:'change',number:2,turnId:battle.token}));
    assert.equal(battle.active(0),last);assert.equal(last.currentHp<last.maxHp,true);
    assert(a.equipe.pokemons.includes(first));assert(!a.equipe.pokemons.includes(fragile));
    battle.finish(null,'fled');assert(a.equipe.pokemons.includes(first));
});
test('replacement timeout selects a living reserve; a terminal KO ends without any choice',()=>{
    const f=fixture(),dead=f.a.equipe.pokemons[0];dead.currentHp=0;ask(f.battle);f.advance(60001);
    assert.notEqual(f.battle.active(0),dead);assert(f.battle.active(0).currentHp>0);f.battle.finish(null,'fled');
    const terminal=fixture();terminal.a.equipe.pokemons.forEach(p=>p.currentHp=0);terminal.battle.prune();assert(terminal.battle.checkEnd());
    assert(!terminal.events.some(e=>e.name==='requestAction'&&e.payload.replacement));
});

test('a pivot or forced-switch flag cannot silently replace a Pokémon knocked out by recoil or contact',()=>{
    const {resolveMoveSwitches}=require('../server/game/battle/battleTeam');
    const attacker=[{currentHp:0},{currentHp:10}],defender=[{currentHp:0},{currentHp:10}];
    assert.deepEqual(resolveMoveSwitches({switchSelf:true,forceSwitch:true},attacker,defender),{attacker:null,defender:null});
    assert.equal(attacker[0].currentHp,0);assert.equal(defender[0].currentHp,0);
});

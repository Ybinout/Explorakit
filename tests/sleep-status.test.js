const test = require('node:test'), assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const factory = require('../server/game/drift/pokemonFactory');
const {getMaxMovePp} = require('../server/game/battle/battleResources');
const {prepareMoveAnimation, afterActionMessages} = require('../server/game/battle/battleEvents');
const {switchPokemonByIndex} = require('../server/game/battle/battleTeam');
const {DriftBattle} = require('../server/game/drift/driftBattle');
const codec = require('../server/game/drift/checkpointCodec');
function mon(moves = ['Tackle']) {
    const p = factory.create(7, 25, true);
    p.passiveAbility = null; p.heldItem = null; p.type1 = 'Normal'; p.type2 = null;
    p.abilities = moves; p.movePp = moves.map(getMaxMovePp); p.maxHp = p.currentHp = 1000;
    return p;
}
function fixed(value, work) {const old = Math.random; try {Math.random = () => value; return work();} finally {Math.random = old;}}
function hit(a, b, name = 'Tackle', state = engine.createBattleState()) {
    return engine.useattack(name, a, b, {battleState: state, attackerSide: state.sides.player, defenderSide: state.sides.enemy, attackerTeam: [a], defenderTeam: [b]});
}
for (const [roll, blocked] of [[0,1],[0.5,2],[0.99,3]]) test(`sleep roll ${roll}: ${blocked} blocked actions, then wake before attacking`, () => fixed(roll, () => {
    const a = mon(), b = mon(); engine.applyStatus(a, 'sleep', null, []);
    const pp = a.movePp[0];
    for (let n = 0; n < blocked; n++) {
        const r = hit(a,b); assert.equal(r.actionPrevented,true); assert.equal(r.damage,0);
        assert.equal(b.currentHp,1000); assert.equal(a.movePp[0],pp); assert.equal(a.status,'sleep');
        assert.match(r.beforeActionMessages.join(' '),/dort/);
    }
    const r = hit(a,b); assert.equal(a.status,'normal'); assert.equal(a.movePp[0],pp-1);
    assert.match(r.beforeActionMessages.join(' '),/reveill/); assert(!afterActionMessages(r).some(m=>/reveill/.test(m)));
}));
for (const move of ['Sing','Sleep Powder','Hypnosis','Lovely Kiss','Spore','Grass Whistle','Dark Void']) test(`${move}: cannot allow an ordinary immediate attack`, () => fixed(0, () => {
    const a=mon([move]), b=mon(); hit(a,b,move); assert.equal(b.status,'sleep');
    assert.equal(hit(b,a).actionPrevented,true); assert.equal(a.currentHp,1000);
}));
test('Rest blocks two actions, Early Bird halves the counter, and sleeping moves still work', () => fixed(0, () => {
    for (const ability of [null,'Early Bird']) {
        const a=mon(['Rest','Tackle']),b=mon(); a.passiveAbility=ability; a.currentHp=100;
        hit(a,b,'Rest'); assert.equal(a.currentHp,1000);
        for(let n=0;n<(ability?1:2);n++) assert.equal(hit(a,b).actionPrevented,true);
        assert(!hit(a,b).actionPrevented); assert.equal(a.status,'normal');
    }
    for (const move of ['Snore','Sleep Talk']) {
        const a=mon([move,'Tackle']),b=mon(); engine.applyStatus(a,'sleep',null,[]);
        const r=hit(a,b,move); assert(r.damage>0); assert.equal(a.status,'sleep'); assert.equal(a.__battle.sleepTurns,1);
        assert.equal(hit(a,b,move).damage,0); assert.equal(a.status,'normal');
    }
}));
test('sleep survives switching/checkpoint; saved sleep without a counter does not wake immediately', () => fixed(0, () => {
    const a=mon(),b=mon(),team={pokemons:[a,b]}; engine.applyStatus(a,'sleep',null,[],{turns:4}); hit(a,b);
    switchPokemonByIndex(team,1); switchPokemonByIndex(team,1); assert.equal(a.__battle.sleepTurns,3);
    const restored=codec.decode(codec.encode(a)); assert.equal(restored.__battle.sleepTurns,3);
    assert.equal(hit(restored,b).actionPrevented,true);
    const saved=mon(); saved.status='sleep'; delete saved.__battle;
    assert.equal(hit(saved,b).actionPrevented,true);
}));
test('sleep immunities, berries and charge presentation are preserved', () => fixed(0, () => {
    for(const ability of ['Insomnia','Vital Spirit','Sweet Veil']) {const p=mon();p.passiveAbility=ability;assert.equal(engine.applyStatus(p,'sleep',null,[]),false);}
    const a=mon(['Dig']),b=mon(),state=engine.createBattleState();
    assert.equal(prepareMoveAnimation(a,b,'Dig',state).phase,'prepare');hit(a,b,'Dig',state);
    assert.equal(prepareMoveAnimation(a,b,'Dig',state).phase,'strike');
    const berry=mon();berry.heldItem='chesto_berry';hit(mon(['Spore']),berry,'Spore');assert.equal(berry.status,'normal');assert.equal(berry.heldItem,null);
}));
for(const mode of ['rift','colosseum']) test(`${mode}: actual queue omits sleeping attack animation and announces awakening first`, () => fixed(0, () => {
    const player=(id,moves)=>({userId:id,run:{mode},equipe:{pokemons:[mon(moves)]},drifts:[],equipped:[],items:{},money:0,defeated:new Set()});
    const a=player(1,['Spore','Splash']),b=player(2,['Tackle']),events=[];a.equipe.pokemons[0].currentSpeed=999;
    const battle=new DriftBattle(a,b,{type:'pvp',random:()=>0,paceMs:0,emit:(viewer,name,payload)=>{if(viewer===a)events.push({name,payload});}});
    const turn=n=>{battle.action(a,{action:'attack',number:n,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});};
    turn(0);assert.equal(a.equipe.pokemons[0].currentHp,1000);
    assert(!events.some(e=>e.name==='battleMoveAnimation'&&e.payload.actor==='opponent'));
    battle.request();events.length=0;turn(1);
    const wake=events.findIndex(e=>e.name==='battleText'&&/reveill/.test(e.payload.message));
    const anim=events.findIndex(e=>e.name==='battleMoveAnimation'&&e.payload.actor==='opponent');
    assert(wake>=0&&anim>wake);assert.equal(events.filter(e=>e.name==='battleText'&&/reveill/.test(e.payload.message)).length,1);
}));

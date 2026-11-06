const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
function mon(maxHp=200,currentHp=40){const p=factory.create(7,50,true);p.maxHp=maxHp;p.currentHp=currentHp;p.passiveAbility=null;p.heldItem=null;p.status='normal';p.abilities=[];p.movePp=[];p.addAbility('Wish');p.addAbility('Splash');engine.ensureBattleData(p);return p;}
function cast(a,b,f,name='Wish',reverse=false){return engine.useattack(name,a,b,{battleState:f,attackerSide:reverse?f.sides.enemy:f.sides.player,defenderSide:reverse?f.sides.player:f.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
function end(a,b,f){return engine.processEndOfRound(a,b,f.sides.player,f.sides.enemy,f);}
test('Wish is a Normal status move and heals only at the end of the next full turn, once and for one PP',()=>{
 const a=mon(401,40),b=mon(),f=engine.createBattleState(),pp=a.movePp[0];const result=cast(a,b,f);assert(result.success);assert.equal(result.move.type,'Normal');assert.equal(a.currentHp,40);assert.equal(a.movePp[0],pp-1);assert(!end(a,b,f).some(m=>m.includes('grace au Voeu')));assert.equal(a.currentHp,40);cast(a,b,f,'Splash');assert.equal(a.currentHp,40);assert(end(a,b,f).some(m=>m.includes('200 PV')));assert.equal(a.currentHp,240);assert.equal(f.sides.player.wish,null);end(a,b,f);assert.equal(a.currentHp,240);assert.equal(a.movePp[0],pp-1);
});
test('Wish heals the replacement using the original caster maximum HP, even after the caster faints off-field',()=>{
 const a=mon(400,40),b=mon(),reserve=mon(1000,100),f=engine.createBattleState();cast(a,b,f);end(a,b,f);const team={pokemons:[a,reserve]};require('../server/game/battle/battleTeam').switchPokemonByIndex(team,1);a.currentHp=0;end(team.pokemons[0],b,f);assert.equal(reserve.currentHp,300);assert.equal(a.currentHp,0);assert.equal(f.sides.player.wish,null);
});
test('Wish clock advances on a fainted caster at casting-turn end',()=>{
 const a=mon(),b=mon(),reserve=mon(500,10),f=engine.createBattleState();cast(a,b,f);a.currentHp=0;end(a,b,f);end(reserve,b,f);assert.equal(reserve.currentHp,110);assert.equal(a.currentHp,0);
});
test('A due Wish expires on a fainted recipient and cannot leak into a later replacement',()=>{
 const a=mon(),b=mon(),reserve=mon(500,10),f=engine.createBattleState();cast(a,b,f);end(a,b,f);a.currentHp=0;end(a,b,f);assert.equal(f.sides.player.wish,null);assert.equal(a.currentHp,0);end(reserve,b,f);assert.equal(reserve.currentHp,10);
});
test('Repeated Wish fails without replacing or postponing the existing wish, but still spends its PP',()=>{
 const a=mon(),b=mon(),f=engine.createBattleState();cast(a,b,f);end(a,b,f);const pending=f.sides.player.wish,pp=a.movePp[0];assert.equal(cast(a,b,f).success,false);assert.equal(a.movePp[0],pp-1);assert.equal(f.sides.player.wish,pending);end(a,b,f);assert.equal(a.currentHp,140);assert(cast(a,b,f).success);
});
test('A caster fainting to residual damage still leaves its wish on schedule for a replacement',()=>{
 const a=mon(200,1),b=mon(),reserve=mon(500,10),f=engine.createBattleState();a.status='poison';cast(a,b,f);end(a,b,f);assert.equal(a.currentHp,0);end(reserve,b,f);assert.equal(reserve.currentHp,110);assert.equal(f.sides.player.wish,null);
});
test('Heal Block prevents a due Wish even on its final turn; the wish expires rather than waiting',()=>{
 const a=mon(),b=mon(),f=engine.createBattleState();cast(a,b,f);end(a,b,f);a.__battle.healBlockTurns=1;const messages=end(a,b,f);assert.equal(a.currentHp,40);assert(messages.some(m=>m.includes('Anti-Soin')));assert.equal(f.sides.player.wish,null);end(a,b,f);assert.equal(a.currentHp,40);
});
test('Both sides have independent delayed wishes, including an enemy-side caster',()=>{
 const a=mon(200,20),b=mon(400,20),f=engine.createBattleState();cast(a,b,f);cast(b,a,f,'Wish',true);end(a,b,f);assert.deepEqual([a.currentHp,b.currentHp],[20,20]);end(a,b,f);assert.deepEqual([a.currentHp,b.currentHp],[120,220]);
});
test('Checkpoint and AI field projection retain the pending amount and remaining delay without extra healing',()=>{
 const a=mon(400,10),b=mon(),f=engine.createBattleState();cast(a,b,f);end(a,b,f);const view=require('../server/game/battle/humanTrainerAI').publicField(f,f.sides.player);assert.deepEqual(view.sides.player.wish,{turns:1,amount:200});const restored=codec.decode(codec.encode({a,b,f}));end(restored.a,restored.b,restored.f);assert.equal(restored.a.currentHp,210);end(restored.a,restored.b,restored.f);assert.equal(restored.a.currentHp,210);assert.equal(f.sides.player.wish.turns,1);
});

for (const mode of [
    {name: 'Rift wild', type: 'wild', npc: true}, {name: 'Rift PvP', type: 'pvp', npc: false},
    {name: 'Colosseum', type: 'arena', npc: true, mode: 'colosseum'}, {name: 'Super Tournament', type: 'trainer', npc: true}
]) test(`${mode.name}: Wish waits for the second resolved round before publishing its heal`, () => {
    const {DriftBattle} = require('../server/game/drift/driftBattle'), a = mon(), b = mon(200, 200), events = [];
    b.abilities = ['Splash']; b.movePp = [40];
    const player = (id, pokemon) => ({userId: id, socketId: 'wish-' + id, equipe: {pokemons: [pokemon]}, items: {}, money: 0, drifts: [], equipped: [], defeated: new Set(), chain: 0});
    const own = player(1, a), foe = player(2, b); own.run = {mode: mode.mode}; foe.npc = mode.npc;
    const battle = new DriftBattle(own, foe, {type: mode.type, now: () => 0, random: () => .5, paceMs: 0,
        rules: {report: false, rewards: false, permanentDeaths: false}, emit: (p, event, data) => {if (p === own) events.push({event, data});}});
    try {
        for (const index of [0, 1]) {
            if (index > 0) battle.tick();
            assert(battle.action(own, {action: 'attack', number: index, turnId: battle.token}));
            if (!foe.npc) assert(battle.action(foe, {action: 'attack', number: 0, turnId: battle.token}));
            assert.equal(a.currentHp, index === 0 ? 40 : 140);
            assert.equal(events.filter(e => e.event === 'battleText' && /grace au Voeu/.test(e.data.message)).length, index);
        }
        assert.equal(a.movePp[0], 9);
    } finally {battle.finish(null, 'fled');}
});

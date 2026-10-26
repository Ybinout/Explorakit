const test = require('node:test');
const assert = require('node:assert/strict');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const engine = require('../server/game/battle/battleEngine');
const tactics = require('../server/game/battle/trainerTactics');
const factory = require('../server/game/drift/pokemonFactory');
const { getMaxMovePp, getItemDefinition } = require('../server/game/battle/battleResources');
const { getCanonicalSpeciesAbility } = require('../server/game/abilities/abilityDex');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const codec = require('../server/game/drift/checkpointCodec');
const learnsets = require('../data/game/pokemonData.json');

test('Matthieu has the requested four partners, legal strategic sets and the original 37–39 level band', () => {
    const team = getPnjTeam('gwenn_route8'), other = getPnjTeam('gwenn_route8');
    assert.deepEqual(team.pokemons.map(p => [p.data.id, p.level, p.k]), [[121,37,3],[128,38,3],[130,39,3],[157,39,4]]);
    const zone = require('../data/game/nextMap.json').maps.find(m => m.mapName === 'gen_route8').level;
    assert.equal(Math.min(...team.pokemons.map(p => p.level)), 37);
    assert.equal(Math.max(...team.pokemons.map(p => p.level)), 39);
    for (const [index, p] of team.pokemons.entries()) {
        assert(p.level >= zone.min && p.level <= zone.max);
        assert.equal(p.abilities.length, 4);
        for (const name of p.abilities) {
            assert(learnsets[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')), p.name + ': ' + name);
            assert(engine.getMoveByName(name));
        }
        assert.equal(getCanonicalSpeciesAbility(p.data.id, p.passiveAbility), p.passiveAbility);
        assert(getItemDefinition(p.heldItem)?.battle_effect);
        assert.deepEqual(p.movePp, p.abilities.map(getMaxMovePp));
        assert.equal(Object.values(p.ev).reduce((a,b) => a+b, 0), 508);
        assert(p.currentHp === p.maxHp && p.maxHp > 0);
        assert.notEqual(p.uuid, other.pokemons[index].uuid);
    }
    assert.deepEqual(team.pokemons.map(p => p.heldItem), ['life_orb','choice_band','leftovers','choice_scarf']);
    assert.equal(team.__trainerPlan.name, 'Matthieu'); assert.equal(team.__trainerPlan.ai, 'expert');
    assert.equal(team.__trainerPlan.aceUuid, undefined, 'All partners remain available to the existing AI');
    team.pokemons[0].currentHp = 0; team.pokemons[0].movePp[0] = 0;
    assert(other.pokemons[0].currentHp > 0 && other.pokemons[0].movePp[0] > 0);
});

test('Matthieu uses coverage against a Ghost and Staross has a functional healing option', () => {
    const team = getPnjTeam('gwenn_route8'), enemy = factory.create(429,38,true);
    enemy.abilities = []; enemy.movePp = []; enemy.addAbility('Shadow Ball');
    const field = engine.createBattleState({mapName:'gen_route8'});
    [team.pokemons[0],team.pokemons[1]] = [team.pokemons[1],team.pokemons[0]];
    const memory = tactics.createMemory();
    const action = tactics.chooseAction(team,enemy,field,memory,1,[enemy]);
    assert(['attack','change'].includes(action.action));
    if (action.action === 'attack') assert.notEqual(team.pokemons[0].abilities[action.number],'Return');
    else assert(team.pokemons[action.number]?.currentHp > 0);
    // The existing human AI may try an unrevealed Levitate once, then learns it.
    memory.seen[enemy.uuid] = {immuneMoves:['Earthquake'],moves:['Shadow Ball']};
    const learned = tactics.chooseAction(team,enemy,field,memory,2,[enemy]);
    if (learned.action === 'attack') assert(!['Return','Earthquake'].includes(team.pokemons[0].abilities[learned.number]));
    const staross = getPnjTeam('gwenn_route8').pokemons[0], harmless = factory.create(129,38,true);
    staross.currentHp = Math.floor(staross.maxHp / 4);
    const before = staross.currentHp, healingField = engine.createBattleState();
    const healing = engine.useattack('Recover',staross,harmless,{battleState:healingField,attackerSide:healingField.sides.enemy,defenderSide:healingField.sides.player});
    assert(healing.success); assert(staross.currentHp > before); assert(staross.currentHp <= staross.maxHp);
});

for (const mode of ['rift','colosseum']) test(`${mode}: Matthieu's real trainer battle and checkpoint retain all four builds`, () => {
    const player = {userId:1,currentmap:'gen_route8',run:{mode},equipe:{pokemons:[factory.create(9,38,true)]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
    player.equipe.pokemons[0].abilities = []; player.equipe.pokemons[0].movePp = []; player.equipe.pokemons[0].addAbility('Surf');
    const opponent = {npc:true,equipe:getPnjTeam('gwenn_route8'),drifts:[],equipped:[],chain:0};
    const battle = new DriftBattle(player,opponent,{type:'trainer',npcKey:'gwenn_route8',paceMs:0,emit(){}});
    const restored = codec.decode(codec.encode(battle));
    assert.deepEqual(restored.b.equipe.pokemons.map(p => [p.data.id,p.level,p.k,p.heldItem]), [[121,37,3,'life_orb'],[128,38,3,'choice_band'],[130,39,3,'leftovers'],[157,39,4,'choice_scarf']]);
    assert.equal(restored.b.equipe.__trainerPlan.ai,'expert');
    assert(battle.pending.has(opponent), 'Trainer action is committed before player input');
    assert(!battle.pending.has(player));
    assert.deepEqual(restored.pending.get(restored.b),battle.pending.get(opponent));
    battle.finished = restored.finished = true;
});

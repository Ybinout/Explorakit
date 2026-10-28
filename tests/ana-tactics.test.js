const test = require('node:test');
const assert = require('node:assert/strict');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const tactics = require('../server/game/battle/trainerTactics');
const engine = require('../server/game/battle/battleEngine');
const factory = require('../server/game/drift/pokemonFactory');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const codec = require('../server/game/drift/checkpointCodec');
const { getMaxMovePp } = require('../server/game/battle/battleResources');
const { getCanonicalSpeciesAbility } = require('../server/game/abilities/abilityDex');
const learnsets = require('../data/game/pokemonData.json');

test('Ana: six arena-level partners, legal coherent sets and a fully trained K4 ace; independent encounters', () => {
    const team = getPnjTeam('ana'), other = getPnjTeam('ana');
    assert.deepEqual(team.pokemons.map(p => [p.data.id, p.level]), [[53,47],[154,47],[78,48],[148,48],[407,49],[282,49]]);
    const zone = require('../data/game/nextMap.json').maps.find(m => m.mapName === 'ville3').level;
    for (const p of team.pokemons) {
        assert(p.level >= zone.min && p.level <= zone.max + 3);
        assert.equal(p.abilities.length, 4);
        for (const name of p.abilities) {
            assert(learnsets[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
            assert(engine.getMoveByName(name));
        }
        assert.equal(getCanonicalSpeciesAbility(p.data.id, p.passiveAbility), p.passiveAbility);
        assert.deepEqual(p.movePp, p.abilities.map(getMaxMovePp));
    }
    assert.deepEqual(team.pokemons.map(p => p.heldItem), ['life_orb','leftovers','choice_scarf','eviolite','life_orb','lum_berry']);
    assert.deepEqual(team.pokemons.map(p=>p.k),[2,3,3,3,4,4]);
    for(const p of team.pokemons){assert(Object.values(p.iv).every(v=>v===31));assert.equal(Object.values(p.ev).reduce((a,b)=>a+b,0),508);assert(Object.values(p.ev).every(v=>v<=252));}
    assert.equal(team.pokemons[3].heldItem,'eviolite');
    const ace = team.pokemons[5];
    assert.equal(ace.k, 4); assert.equal(ace.nature,'Timid');assert.equal(ace.passiveAbility,'Trace');
    assert.deepEqual(ace.ev,{hp:0,attack:0,defense:0,specialAttack:252,specialDefense:4,speed:252});
    assert.equal(team.__trainerPlan.aceUuid, ace.uuid);
    assert(!JSON.stringify(team).includes('__trainerPlan'));
    ace.currentHp = 0; ace.movePp[0] = 0;
    assert(other.pokemons[5].currentHp > 0); assert(other.pokemons[5].movePp[0] > 0);
    assert.notEqual(ace.uuid, other.pokemons[5].uuid);
});

test('Ana: expert decisions avoid an immune STAB, reserve Gardevoir by identity and do not read hidden information', () => {
    const team = getPnjTeam('ana'), enemy = factory.create(94,45,true);
    const field = engine.createBattleState({mapName:'ville3_arene'}), memory = tactics.createMemory();

    for (let round = 1; round <= 12; round++) {
        const d = tactics.chooseAction(team,enemy,field,memory,round);
        assert(d);
        if (d.action === 'attack') assert(!['Double-Edge'].includes(team.pokemons[0].abilities[d.number]));
        else assert.notEqual(team.pokemons[d.number].data.id, 282);
    }
    const hidden = {...enemy, movePp:[0], heldItem:'focus_sash', iv:{}, ev:{}};
    assert.deepEqual(tactics.chooseAction(team,enemy,field,memory,1), tactics.chooseAction(team,hidden,field,memory,1));
    [team.pokemons[1],team.pokemons[5]] = [team.pokemons[5],team.pokemons[1]];
    team.pokemons[0].currentHp = 0;
    assert.notEqual(team.pokemons[tactics.replacementIndex(team)].data.id, 282);
    for (const p of team.pokemons) if (p.data.id !== 282) p.currentHp = 0;
    assert.equal(team.pokemons[tactics.replacementIndex(team)].data.id, 282);
});

for (const mode of ['rift','colosseum']) test(`${mode}: real Ana team sends Gardevoir last and announces once, including after checkpoint recovery`, () => {
    const events = [], player = {userId:1,currentmap:'ville3_arene',run:{mode},equipe:{pokemons:[factory.create(9,46,true)]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
    const opponent = {npc:true,equipe:getPnjTeam('ana'),drifts:[],equipped:[],chain:0};
    const battle = new DriftBattle(player,opponent,{type:'arena',npcKey:'champion_ana',paceMs:0,emit:(_p,event,payload) => events.push({event,payload:JSON.parse(JSON.stringify(payload))})});
    const encountered=[battle.active(1).data.id];
    for (let i=0;i<5;i++) {
        opponent.equipe.pokemons[0].currentHp = 0; battle.prune();
        const id=battle.active(1).data.id;encountered.push(id);
        assert.equal(id===282,i===4,'only the ace must be saved for last; ordinary partners follow the matchup');
    }
    assert.deepEqual(encountered.sort((a,b)=>a-b),[53, 78, 148, 154, 282, 407]);
    const speeches = () => events.filter(e => e.event === 'introAnimation').flatMap(e => e.payload.transitions).filter(t => t.trainerSpeech);
    assert.equal(speeches().length, 1);
    assert.equal(speeches()[0].trainerSpeech.name, 'Ana');
    assert.match(speeches()[0].trainerSpeech.text, /Gardevoir/);
    battle.sync(); assert.equal(speeches().length, 1);
    const restored = codec.decode(codec.encode(battle));
    restored.emit = (_p,event,payload) => events.push({event,payload});
    assert.equal(restored.b.equipe.__trainerPlan.aceUuid, restored.active(1).uuid);
    assert.equal(restored.active(1).heldItem, 'lum_berry');
    assert.equal(restored.active(1).ev.specialAttack, 252);
    restored.resume(restored.a); assert.equal(speeches().length, 1);
    assert.equal(restored.defaultAction(restored.b).action, 'attack');
    battle.finished = restored.finished = true;
});

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

test('Hoze: four zone-level partners, legal coherent sets and a fully trained K4 ace; independent encounters', () => {
    const team = getPnjTeam('hoze'), other = getPnjTeam('hoze');
    assert.deepEqual(team.pokemons.map(p => [p.data.id, p.level]), [[7,37],[253,38],[448,38],[445,39]]);
    const zone = require('../data/game/nextMap.json').maps.find(m => m.mapName === 'ville_safe1').level;
    for (const p of team.pokemons) {
        assert(p.level >= zone.min && p.level <= zone.max + 1);
        assert.equal(p.abilities.length, 4);
        for (const name of p.abilities) {
            assert(learnsets[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
            assert(engine.getMoveByName(name));
        }
        assert.equal(getCanonicalSpeciesAbility(p.data.id, p.passiveAbility), p.passiveAbility);
        assert.deepEqual(p.movePp, p.abilities.map(getMaxMovePp));
    }
    assert.deepEqual(team.pokemons.map(p => p.heldItem), ['eviolite','eviolite','life_orb','lum_berry']);
    assert(team.pokemons.slice(0,3).every(p => p.k === 1 && Object.values(p.iv).every(v => v === 18) && Object.values(p.ev).every(v => v === 0)));
    const ace = team.pokemons[3];
    assert.equal(ace.k, 4); assert(Object.values(ace.iv).every(v => v === 31));
    assert.equal(ace.nature, 'Jolly'); assert.equal(ace.passiveAbility, 'Rough Skin');
    assert.deepEqual(ace.ev, {hp:4,attack:252,defense:0,specialAttack:0,specialDefense:0,speed:252});
    assert.equal(Object.values(ace.ev).reduce((a,b) => a+b, 0), 508);
    assert.equal(team.__trainerPlan.aceUuid, ace.uuid);
    assert(!JSON.stringify(team).includes('__trainerPlan'));
    ace.currentHp = 0; ace.movePp[0] = 0;
    assert(other.pokemons[3].currentHp > 0); assert(other.pokemons[3].movePp[0] > 0);
    assert.notEqual(ace.uuid, other.pokemons[3].uuid);
});

test('Hoze: expert decisions avoid an immune STAB, reserve Carchacrok by identity and do not read hidden information', () => {
    const team = getPnjTeam('hoze'), enemy = factory.create(94,38,true);
    const field = engine.createBattleState({mapName:'ville_safe1_arene'}), memory = tactics.createMemory();
    [team.pokemons[0],team.pokemons[2]] = [team.pokemons[2],team.pokemons[0]];
    for (let round = 1; round <= 12; round++) {
        const d = tactics.chooseAction(team,enemy,field,memory,round);
        assert(d);
        if (d.action === 'attack') assert.notEqual(team.pokemons[0].abilities[d.number], 'Aura Sphere');
        else assert.notEqual(team.pokemons[d.number].data.id, 445);
    }
    const hidden = {...enemy, abilities:['Secret'], movePp:[0], heldItem:'focus_sash', iv:{}, ev:{}, passiveAbility:'Wonder Guard'};
    assert.deepEqual(tactics.chooseAction(team,enemy,field,memory,1), tactics.chooseAction(team,hidden,field,memory,1));
    [team.pokemons[1],team.pokemons[3]] = [team.pokemons[3],team.pokemons[1]];
    team.pokemons[0].currentHp = 0;
    assert.notEqual(team.pokemons[tactics.replacementIndex(team)].data.id, 445);
    for (const p of team.pokemons) if (p.data.id !== 445) p.currentHp = 0;
    assert.equal(team.pokemons[tactics.replacementIndex(team)].data.id, 445);
});

for (const mode of ['rift','colosseum']) test(`${mode}: real Hoze team sends Carchacrok last and announces once, including after checkpoint recovery`, () => {
    const events = [], player = {userId:1,currentmap:'ville_safe1_arene',run:{mode},equipe:{pokemons:[factory.create(9,38,true)]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
    const opponent = {npc:true,equipe:getPnjTeam('hoze'),drifts:[],equipped:[],chain:0};
    const battle = new DriftBattle(player,opponent,{type:'arena',npcKey:'champion_hoze',paceMs:0,emit:(_p,event,payload) => events.push({event,payload:JSON.parse(JSON.stringify(payload))})});
    for (const id of [253,448,445]) {
        opponent.equipe.pokemons[0].currentHp = 0; battle.prune();
        assert.equal(battle.active(1).data.id, id);
    }
    const speeches = () => events.filter(e => e.event === 'introAnimation').flatMap(e => e.payload.transitions).filter(t => t.trainerSpeech);
    assert.equal(speeches().length, 1);
    assert.equal(speeches()[0].trainerSpeech.name, 'Hoze');
    assert.match(speeches()[0].trainerSpeech.text, /Carchacrok/);
    battle.sync(); assert.equal(speeches().length, 1);
    const restored = codec.decode(codec.encode(battle));
    restored.emit = (_p,event,payload) => events.push({event,payload});
    assert.equal(restored.b.equipe.__trainerPlan.aceUuid, restored.active(1).uuid);
    assert.equal(restored.active(1).heldItem, 'lum_berry');
    assert.equal(restored.active(1).ev.attack, 252);
    restored.resume(restored.a); assert.equal(speeches().length, 1);
    assert.equal(restored.defaultAction(restored.b).action, 'attack');
    battle.finished = restored.finished = true;
});

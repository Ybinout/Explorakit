const test = require('node:test');
const assert = require('node:assert/strict');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const tactics = require('../server/game/battle/trainerTactics');
const engine = require('../server/game/battle/battleEngine');
const presentation = require('../server/game/battle/presentationState');
const factory = require('../server/game/drift/pokemonFactory');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const codec = require('../server/game/drift/checkpointCodec');
const { getMaxMovePp } = require('../server/game/battle/battleResources');
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function rival(id = 92) { const p = factory.create(id, 18, true); p.passiveAbility = null; return p; }
function enter(p, other, field) { return engine.applySwitchInEffects(p, field.sides.enemy, field.sides.player, field, other); }

test('Mounir has the requested levels, average partners and a legal maximally talented, trained ace; teams are private and independent', () => {
    const a = getPnjTeam('moonpunch'), b = getPnjTeam('moonpunch');
    assert.deepEqual(a.pokemons.map(p => [p.data.id,p.level]), [[271,17],[208,18],[351,22]]);
    assert.equal(a.pokemons[0].passiveAbility,'Swift Swim');
    const ace = a.pokemons[2]; assert.equal(ace.k,4); assert(Object.values(ace.iv).every(v => v===31));
    assert.equal(ace.ev.specialAttack,252); assert.equal(ace.ev.speed,252); assert.equal(Object.values(ace.ev).reduce((a,b)=>a+b,0),508);
    assert.equal(ace.specialAttack,84); assert.equal(ace.maxHp,90); assert.equal(ace.passiveAbility,'Forecast');
    for (const p of a.pokemons) {
        assert.equal(p.abilities.length,4); assert(p.abilities.every(n => require('../data/game/pokemonData.json')[p.data.id].includes(slug(n))));
        assert.deepEqual(p.movePp,p.abilities.map(getMaxMovePp));
    }
    assert(a.pokemons.slice(0,2).every(p=>p.k===1&&Object.values(p.iv).every(v=>v===18)&&Object.values(p.ev).every(v=>v===0)));
    assert(!JSON.stringify(a).includes('__trainerPlan'));
    a.pokemons[2].currentHp=0; assert.equal(b.pokemons[2].currentHp,90); assert.notEqual(a.__trainerPlan.aceUuid,b.__trainerPlan.aceUuid);
});

test('ace retention follows identities through switches and KOs; support and attack selection are legal without hidden opponent information', () => {
    const t = getPnjTeam('moonpunch'), enemy = rival(), field = engine.createBattleState({mapName:'ville1_arene'}), memory = tactics.createMemory();
    for (let round=1;round<15;round++) {
        const decision = tactics.chooseAction(t,enemy,field,memory,round);
        assert(!(decision.action==='change' && t.pokemons[decision.number].data.id===351));
        if(decision.action==='attack') assert(engine.getMoveByName(t.pokemons[0].abilities[decision.number]));
    }
    // Lombre cannot hit a Ghost with Fake Out. Switch or another move, never Fake Out.
    const d = tactics.chooseAction(t,enemy,field,memory,1); assert(d.action==='change'||d.number!==0);
    const hidden={...enemy,movePp:[0],heldItem:'life_orb',iv:{},ev:{},passiveAbility:'Wonder Guard'};
    assert.deepEqual(tactics.chooseAction(t,hidden,field,memory,1),d);
    [t.pokemons[0],t.pokemons[1]]=[t.pokemons[1],t.pokemons[0]];
    t.pokemons[0].currentHp=0; assert.equal(t.pokemons[tactics.replacementIndex(t)].data.id,271);
    t.pokemons[1].currentHp=0; assert.equal(t.pokemons[tactics.replacementIndex(t)].data.id,351);
});

test('Mounir rain transforms Forecast on entry and powers Weather Ball; weather attacks respect suppression', () => {
    const t=getPnjTeam('moonpunch'),p=t.pokemons[2],enemy=rival(7),field=engine.createBattleState({mapName:'ville1_arene'});
    assert.deepEqual(field.weather,{kind:'rain',turns:0,persistent:true,source:'map'});
    enter(p,enemy,field); assert.equal(p.__battle.formSpriteId,10014); assert.deepEqual(p.__battle.formTypes,['Water']);
    assert.equal(engine.resolveWeatherMove(engine.getMoveByName('Weather Ball'),p,enemy,field).type,'Water');
    const thunder=engine.getMoveByName('Thunder'); assert.equal(engine.weatherMoveAccuracy(thunder,p,enemy,field),-1);
    const random=Math.random;
    try {
        Math.random=()=>.99;
        const wet=engine.useattack('Thunder',p,enemy,{battleState:field});assert.equal(wet.missed,false);assert(wet.damage>0);
        enemy.currentHp=enemy.maxHp;enemy.passiveAbility='Cloud Nine';
        assert.equal(engine.useattack('Thunder',p,enemy,{battleState:field}).missed,true);
    } finally {Math.random=random;}
    enemy.passiveAbility='Cloud Nine'; assert.equal(engine.weatherMoveAccuracy(thunder,p,enemy,field),70);
    enemy.passiveAbility=null; field.weather.kind='sun'; assert.equal(engine.weatherMoveAccuracy(thunder,p,enemy,field),50);
    field.weather.kind='hail'; assert.equal(engine.weatherMoveAccuracy(engine.getMoveByName('Blizzard'),p,enemy,field),-1);
});

for (const mode of ['rift','colosseum']) test(`${mode}: actual gym keeps ace last, announces once, and retains plan and announcement state across checkpoints`, () => {
    const events=[],player={userId:1,currentmap:'ville1_arene',run:{mode},equipe:{pokemons:[rival()]},drifts:[],equipped:[],items:{},defeated:new Set(),money:0,chain:0};
    const opponent={npc:true,equipe:getPnjTeam('moonpunch'),drifts:[],equipped:[],chain:0};
    // The ace's reservation must not rely on its current array slot.
    [opponent.equipe.pokemons[1],opponent.equipe.pokemons[2]]=[opponent.equipe.pokemons[2],opponent.equipe.pokemons[1]];
    const battle=new DriftBattle(player,opponent,{type:'arena',npcKey:'moon',paceMs:0,emit:(_p,event,payload)=>events.push({event,payload:JSON.parse(JSON.stringify(payload))})});
    assert.equal(battle.state.weather.kind,'rain');
    assert(events.some(e=>e.event==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='enter'&&t.side==='opponent')));
    opponent.equipe.pokemons[0].currentHp=0; battle.prune(); assert.equal(battle.active(1).data.id,208);
    opponent.equipe.pokemons[0].currentHp=0; battle.prune(); assert.equal(battle.active(1).data.id,351);
    assert.equal(battle.active(1).__battle.formSpriteId,10014);
    const speeches=()=>events.filter(e=>e.event==='introAnimation').flatMap(e=>e.payload.transitions).filter(e=>e.trainerSpeech);
    assert.equal(speeches().length,1); assert.equal(speeches()[0].trainerSpeech.name,'Mounir'); assert.match(speeches()[0].trainerSpeech.text,/Morphéo/);
    battle.sync(); assert.equal(speeches().length,1);
    const restored=codec.decode(codec.encode(battle)); restored.emit=(_p,event,payload)=>events.push({event,payload});
    assert.equal(restored.b.equipe.__trainerPlan.aceUuid,restored.active(1).uuid);
    assert(restored.aiMemory.announced.has(restored.active(1).uuid));
    restored.resume(restored.a); assert.equal(speeches().length,1); assert.equal(restored.active(1).__battle.formSpriteId,10014);
    assert.equal(restored.defaultAction(restored.b).action,'attack');
    battle.finished=restored.finished=true;
});

test('entry lines attach to an actual arrival once, including a forced arrival; another trainer has no inherited script', () => {
    const team=getPnjTeam('moonpunch'),memory=tactics.createMemory(),viewer={};
    const own=rival(),ace=team.pokemons[2];
    let events=tactics.decorateTransitions(presentation.transitions(viewer,own,ace,{initial:true}),team,memory);
    assert.equal(events.filter(e=>e.trainerSpeech).length,1);
    presentation.transitions(viewer,own,team.pokemons[0]);
    events=tactics.decorateTransitions(presentation.transitions(viewer,own,ace),team,memory); assert(!events.some(e=>e.trainerSpeech));
    assert(tactics.chooseAction(getPnjTeam('garry'),own,engine.createBattleState(),tactics.createMemory(),1));
});

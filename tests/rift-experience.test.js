const test=require('node:test'),assert=require('node:assert/strict');
const { DriftBattle }=require('../server/game/drift/driftBattle');
const factory=require('../server/game/drift/pokemonFactory');
const { calculateBattleExperience }=require('../server/game/models/progression');
const { rewardTraining }=require('../server/game/models/training');
const effects=require('../server/game/drift/driftEffects');
for(const mode of ['rift','colosseum-30','colosseum-60']) for(const [type,multiplier] of [['wild',1],['trainer',1.5],['arena',2]]) {
    test(`${mode} ${type}: exact +100% XP, level payload, sharing and one reward per KO`,()=>{
        const active=factory.create(1,5), reserve=factory.create(7,5), dead=factory.create(4,5), enemy=factory.create(19,9);dead.currentHp=0;
        const drifts=[43,50,51].map(n=>({uuid:String(n),definitionId:`DRF-${String(n).padStart(3,'0')}`,rarity:'mythic',element:'Grass'}));
        const p={run:{mode},equipe:{pokemons:[active,reserve,dead]},drifts,equipped:drifts.map(d=>d.uuid)};
        const before=active.experience, beforeReserve=reserve.experience, beforeDead=dead.experience;
        const bonus=effects.value(p,43)+effects.value(p,51);
        const expected=2*Math.max(1,Math.floor(calculateBattleExperience(enemy,multiplier,active)*(1+bonus/100)));
        const events=[];
        const battle=Object.assign(Object.create(DriftBattle.prototype),{type,a:p,rewarded:new Set(),emit:(_,event,payload)=>events.push({event,payload})});
        battle.reward(enemy);battle.reward(enemy);
        assert.equal(active.experience-before,expected);
        assert.equal(reserve.experience-beforeReserve,Math.floor(expected*effects.value(p,50)/100));
        assert.equal(dead.experience,beforeDead);assert.equal(events.length,1);
        assert.equal(events[0].payload.previousExperience,before);assert.equal(events[0].payload.xpGained,expected);
    });
}
test('Adventure receives its ordinary award',()=>{const p=factory.create(1,5),before=p.experience;rewardTraining(p,factory.create(19,5),101,{to:()=>({emit(){}})},'owner');assert.equal(p.experience-before,101);});

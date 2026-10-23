const test=require('node:test'),assert=require('node:assert/strict');
const { DriftBattle }=require('../server/game/drift/driftBattle');
const factory=require('../server/game/drift/pokemonFactory');
const { calculateBattleExperience }=require('../server/game/models/progression');
const { rewardTraining }=require('../server/game/models/training');
const effects=require('../server/game/drift/driftEffects');
const modes = [{ mode:'rift', durationMinutes:30 }, { mode:'colosseum', durationMinutes:30 }, { mode:'colosseum', durationMinutes:60 }];
for(const {mode,durationMinutes} of modes) for(const withDrifts of [false,true]) for(const [type,multiplier] of [['wild',1.21],['trainer',1.98],['arena',2.64]]) {
    test(`${mode} ${durationMinutes}min ${type}, Drifts ${withDrifts}: exact XP, reserve sharing and one reward per KO`,()=>{
        const active=factory.create(1,5), reserve=factory.create(7,5), secondReserve=factory.create(25,20), dead=factory.create(4,5), enemy=factory.create(19,9);dead.currentHp=0;
        const drifts=(withDrifts ? [43,50,51] : []).map(n=>({uuid:String(n),definitionId:`DRF-${String(n).padStart(3,'0')}`,rarity:'mythic',element:'Grass'}));
        const p={run:{mode,lobby:{rules:{durationMinutes}}},equipe:{pokemons:[active,reserve,secondReserve,dead]},drifts,equipped:drifts.map(d=>d.uuid)};
        const before=active.experience, beforeReserve=reserve.experience, beforeDead=dead.experience, beforeSecond=secondReserve.experience;
        const bonus=effects.value(p,43)+effects.value(p,51);
        const baseXp=Math.max(1,Math.floor(calculateBattleExperience(enemy,multiplier,active)*(1+bonus/100)));
        const oldAward=mode === 'colosseum' ? Math.floor((6*baseXp)*4/5) : 2*baseXp;
        const expected=mode === 'colosseum' ? Math.max(1,Math.floor(Math.floor(oldAward*9/10)*4/5)) : oldAward;
        const secondBase=Math.floor(calculateBattleExperience(enemy,multiplier,secondReserve)*(1+effects.value(p,43)/100));
        const secondShared=Math.floor((mode==='colosseum'?Math.floor(secondBase*48/10):2*secondBase)*((mode==='colosseum'?40:0)+effects.value(p,50))/100);
        const events=[];
        const battle=Object.assign(Object.create(DriftBattle.prototype),{type,a:p,rewarded:new Set(),emit:(_,event,payload)=>events.push({event,payload})});
        battle.reward(enemy);battle.reward(enemy);
        assert.equal(active.experience-before,expected);
        const shared=Math.floor(oldAward*((mode === 'colosseum' ? 40 : 0)+effects.value(p,50))/100);
        assert.equal(reserve.experience-beforeReserve,shared);
        assert.equal(secondReserve.experience-beforeSecond,secondShared,'Each reserve uses its own level and eligible XP Drifts');
        assert.equal(dead.experience,beforeDead);assert.equal(events.length,1);
        assert.equal(events[0].payload.previousExperience,before);assert.equal(events[0].payload.xpGained,expected);
    });
}
test('Adventure receives its ordinary award',()=>{const p=factory.create(1,5),before=p.experience;rewardTraining(p,factory.create(19,5),101,{to:()=>({emit(){}})},'owner');assert.equal(p.experience-before,101);});

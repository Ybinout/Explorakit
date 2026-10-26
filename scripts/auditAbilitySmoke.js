// Structural sweep, not proof of every cartridge interaction. Regressions with
// independently specified expected behaviour live in ability-audit-regression.
const assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const {clearBattleTransientState}=require('../server/game/battle/battleOutcome');
const factory=require('../server/game/drift/pokemonFactory');
const slots=require('../data/game/pokemon_abilities.gen7.json').pokemon;
const abilities=require('../data/game/abilities.gen7.json').abilities;
const names=['Pound','Flamethrower','Thunderbolt','Earthquake','Surf','Ice Beam','Toxic','Growl','Confuse Ray','Giga Drain','Double Slap','Role Play','Gastro Acid','Worry Seed'];
const weather=[null,'rain','sun','hail','sandstorm'];
let cases=0;const errors=[];
const originalRandom=Math.random;Math.random=()=>.73;
const clone=p=>Object.assign(Object.create(Object.getPrototypeOf(p)),structuredClone(p));
try {
    for(const {name}of abilities) {
        const entry=Object.entries(slots).find(([,p])=>p.abilities.some(s=>s.name===name));
        assert(entry,name);const specimen=factory.create(Number(entry[0]),50),control=factory.create(143,50);
        specimen.passiveAbility=name;control.passiveAbility=null;
        for(const role of ['attacker','defender'])for(const kind of weather)for(const move of names) {
            const a=clone(role==='attacker'?specimen:control),b=clone(role==='defender'?specimen:control),state=engine.createBattleState();
            state.weather={kind,turns:kind?5:0};
            try {
                engine.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,b);
                engine.applySwitchInEffects(b,state.sides.enemy,state.sides.player,state,a);
                engine.useattack(move,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b],consumePp:false});
                engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);
                for(const p of [a,b]) {
                    assert(Number.isFinite(p.currentHp)&&p.currentHp>=0&&p.currentHp<=p.maxHp,'HP');
                    for(const value of Object.values(engine.ensureBattleData(p).statStages))assert(Number.isFinite(value)&&Math.abs(value)<=6,'stages');
                }
                clearBattleTransientState([a,b]); cases++;
            } catch(error) { errors.push({ability:name,role,weather:kind,move,error:error.message}); }
        }
    }
} finally { Math.random=originalRandom; }
console.log(JSON.stringify({abilities:abilities.length,moves:names.length,weather:weather.length,roles:2,cases,errors},null,2));
if(errors.length)process.exitCode=1;

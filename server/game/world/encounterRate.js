// A 20% reduction from the previous 1/15 chance per eligible movement step.
// Shared by Adventure and expedition exploration (Rift / Colosseum).
const WILD_ENCOUNTER_CHANCE = (1 / 15) * 0.8;
function encounterChance(team=[]) {
    // Gen7 overworld rule: only the leading party member doubles encounter frequency.
    return Math.min(1,WILD_ENCOUNTER_CHANCE*(team[0]?.passiveAbility==='Illuminate'?2:1));
}

module.exports = { WILD_ENCOUNTER_CHANCE, encounterChance };

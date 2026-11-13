// Immutable, server-owned aggregates travel with battle checkpoints. No DB work in combat.
const dex=new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
function get(value){return value?.__trainerTalents||value?.talentBonuses||value?.equipe?.talentBonuses||value?.equipe?.pokemons?.find(p=>p.__trainerTalents)?.__trainerTalents||value?.pokemons?.find(p=>p.__trainerTalents)?.__trainerTalents||null;}
function attach(team,bonuses){if(!team)return team;if(bonuses){team.talentBonuses=bonuses;for(const p of team.pokemons||[])p.__trainerTalents=bonuses;}return team;}
function refresh(team){if(team?.talentBonuses)for(const p of team.pokemons||[])p.__trainerTalents=team.talentBonuses;return team;}
// A saved owner profile is not permission to use its combat branch in every mode.
// The battle controller supplies the scope; unknown contexts stay neutral.
// Version 1 profiles in existing raid/Tower checkpoints store the old half-sized
// combat bonuses. Upgrade their units on read without rewriting the checkpoint.
function damage(attacker,defender,type,scope){if(!['wild','raid','tower'].includes(scope))return 1;const a=get(attacker),d=get(defender);return (1+((a?.offense?.[type]||0)+(a?.globalDamage||0))*(a?.version===1?2:1)/100)*(1-(d?.defense?.[type]||0)*(d?.version===1?2:1)/100);}
function experience(amount,owner,shared=false){const b=get(owner);return Math.max(0,Math.floor(amount*(1+((b?.globalExperience||0)+(shared?b?.sharedExperience||0:0))/100)));}
function money(amount,source,owner){const b=get(owner),reward=Math.floor(amount*(1+((b?.money?.[source]||0)+(b?.globalMoney||0))/100));return Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(reward*(require('./catalog').moneyRewardMultipliers[source]||1))));}
function plateChance(chance,owner){const bonus=Math.max(0,Math.min(35,Number(get(owner)?.darkPlateChance)||0));return Math.min(1,Math.max(0,chance)*(1+bonus/100));}
function weights(entries,bonuses){if(!bonuses?.capture||!Object.keys(bonuses.capture).length)return entries;return entries.map(([id,weight])=>[id,weight*(1+(dex.get(Number(id))?.type||[]).reduce((sum,type)=>sum+(bonuses.capture[type]||0),0)/100)]);}
module.exports={get,attach,refresh,damage,experience,money,weights,plateChance};

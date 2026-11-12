// Immutable, server-owned aggregates travel with battle checkpoints. No DB work in combat.
const dex=new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
function get(value){return value?.__trainerTalents||value?.talentBonuses||value?.equipe?.talentBonuses||value?.equipe?.pokemons?.find(p=>p.__trainerTalents)?.__trainerTalents||value?.pokemons?.find(p=>p.__trainerTalents)?.__trainerTalents||null;}
function attach(team,bonuses){if(!team)return team;if(bonuses){team.talentBonuses=bonuses;for(const p of team.pokemons||[])p.__trainerTalents=bonuses;}return team;}
function refresh(team){if(team?.talentBonuses)for(const p of team.pokemons||[])p.__trainerTalents=team.talentBonuses;return team;}
function damage(attacker,defender,type){const a=get(attacker),d=get(defender);return (1+((a?.offense?.[type]||0)+(a?.globalDamage||0))/100)*(1-(d?.defense?.[type]||0)/100);}
function experience(amount,owner,shared=false){const b=get(owner);return Math.max(0,Math.floor(amount*(1+((b?.globalExperience||0)+(shared?b?.sharedExperience||0:0))/100)));}
function money(amount,source,owner){const b=get(owner);return Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(amount*(1+((b?.money?.[source]||0)+(b?.globalMoney||0))/100))));}
function weights(entries,bonuses){if(!bonuses?.capture||!Object.keys(bonuses.capture).length)return entries;return entries.map(([id,weight])=>[id,weight*(1+(dex.get(Number(id))?.type||[]).reduce((sum,type)=>sum+(bonuses.capture[type]||0),0)/100)]);}
module.exports={get,attach,refresh,damage,experience,money,weights};

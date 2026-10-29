const { createHash } = require('node:crypto');
const { rules } = require('../../../data/game/evolutions.json');
const { rules: stoneRules } = require('../../../data/game/stone_evolutions.json');
const { gender } = require('../items/stoneEvolution');
const { getMoveDefinition, getItemDefinition } = require('../battle/battleResources');
const dex = new Map(require('../../../data/game/pokedex.json').map(p => [p.id, p]));
const bySpecies = new Map();
for (const rule of rules) bySpecies.set(rule.from, [...(bySpecies.get(rule.from) || []), rule]);
const exclusiveBranches = new Set([236, 265, 412]); // stats, stable personality, gender

function matches(pokemon, rule) {
    if (!pokemon || pokemon.isEgg || (Object.hasOwn(pokemon,'__heldItemBeforeExchange')?pokemon.__heldItemBeforeExchange:pokemon.heldItem) === 'everstone' || pokemon.currentHp <= 0 || pokemon.data.id !== rule.from || pokemon.level < rule.level) return false;
    if (rule.gender && gender(pokemon) !== rule.gender) return false;
    if (rule.relativeStats != null && Math.sign(pokemon.attack - pokemon.defense) !== rule.relativeStats) return false;
    if (rule.personalityBranch != null && createHash('sha256').update(pokemon.uuid).digest()[0] % 2 !== rule.personalityBranch) return false;
    const moves = pokemon.__moveAndStatOverrides?.abilities || pokemon.abilities || [];
    if (rule.move && !moves.includes(rule.move)) return false;
    if (rule.moveType && !moves.some(name => getMoveDefinition(name)?.type === rule.moveType)) return false;
    return true;
}

function needsChoice(pokemon) {
    if (exclusiveBranches.has(pokemon.data.id)) return false;
    const possible = [...(bySpecies.get(pokemon.data.id) || []), ...stoneRules.filter(rule => rule.from === pokemon.data.id)]
        .filter(rule => !rule.gender || rule.gender === gender(pokemon));
    return new Set(possible.map(rule => rule.to)).size > 1;
}

function automatic(pokemon) {
    if (needsChoice(pokemon)) return null;
    return (bySpecies.get(pokemon.data.id) || []).find(rule => matches(pokemon, rule)) || null;
}

function apply(pokemon, rule) {
    const from = pokemon.data.id, deferred=Boolean(pokemon.evolutionState?.pending);
    pokemon.evolutionState = null;
    pokemon.gender = gender(pokemon);
    pokemon.updatePokemon(rule.to);
    if(deferred)require('./moveLearning').queueLevelMoves(pokemon,rule.level);
    return { from, to: rule.to, name: pokemon.truename };
}

function evolve(pokemon, { fromSpeciesId, targetId } = {}) {
    if (!pokemon || pokemon.data.id !== fromSpeciesId) throw Error('Ce choix d’évolution n’est plus disponible.');
    const rule = (bySpecies.get(fromSpeciesId) || []).find(candidate => candidate.to === targetId);
    if (!rule || !matches(pokemon, rule)) throw Error('Les conditions de cette évolution ne sont pas remplies.');
    return apply(pokemon, rule);
}

function description(rule) {
    const parts = [`Niveau ${rule.level}`];
    if (rule.gender) parts.push(rule.gender === 'female' ? 'femelle' : 'mâle');
    if (rule.move) parts.push(`connaître ${rule.moveName}`);
    if (rule.moveType) parts.push('connaître une capacité de type Fée');
    if (rule.relativeStats != null) parts.push(`Attaque ${rule.relativeStats > 0 ? '>' : rule.relativeStats < 0 ? '<' : '='} Défense`);
    if (rule.personalityBranch != null) parts.push('branche propre à ce Pokémon, fixée dès son obtention');
    return parts.join(' · ');
}

function options(pokemon) {
    if (!pokemon) return [];
    const id = pokemon.data.id;
    return [
        ...(bySpecies.get(id) || []).map(rule => ({ targetId: rule.to, name: dex.get(rule.to).name.french,
            condition: description(rule), adaptation: rule.adaptation || '', ready: matches(pokemon, rule), stone: false })),
        ...stoneRules.filter(rule => rule.from === id).map(rule => ({ targetId: rule.to, name: dex.get(rule.to).name.french,
            condition: `${getItemDefinition(rule.item)?.name || rule.item}${rule.gender ? ` · ${rule.gender === 'female' ? 'femelle' : 'mâle'}` : ''}`,
            adaptation: '', ready: false, stone: true }))
    ];
}

function offer(pokemon) {
    const rule=automatic(pokemon),state=pokemon.evolutionState||{};
    if(!rule||state.declinedLevel>=pokemon.level){if(state.pending)pokemon.evolutionState={...state,pending:null};return null;}
    if(state.pending?.from===pokemon.data.id&&state.pending?.level===pokemon.level&&state.pending?.targetId===rule.to)return state.pending;
    const pending={id:require('node:crypto').randomUUID(),from:pokemon.data.id,targetId:rule.to,level:pokemon.level};
    pokemon.evolutionState={...state,pending};return pending;
}
function resolvePending(pokemon,{promptId,cancel}={}) {
    const pending=pokemon?.evolutionState?.pending;
    if(!pending||pending.id!==promptId||pending.from!==pokemon.data.id||pending.level!==pokemon.level)throw Error('Ce choix d’évolution n’est plus disponible.');
    if(typeof cancel!=='boolean')throw Error('Choisis de poursuivre ou d’annuler cette évolution.');
    if(cancel){pokemon.evolutionState={declinedLevel:pokemon.level,pending:null};return {cancelled:true};}
    const result=evolve(pokemon,{fromSpeciesId:pending.from,targetId:pending.targetId});offer(pokemon);return result;
}
module.exports = { matches, automatic, apply, evolve, options, needsChoice, offer, resolvePending };

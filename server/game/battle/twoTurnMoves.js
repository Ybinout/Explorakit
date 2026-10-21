// Singles rules shared by Adventure, Rift and Colosseum. Move IDs stay English.
// Reference: pokemon-showdown/data/moves.ts and data/mods/gen7/moves.ts.
const airborneHits = { Gust: 2, Twister: 2, 'Sky Uppercut': 1, Thunder: 1, Hurricane: 1, 'Smack Down': 1, 'Thousand Arrows': 1 };
const RULES = Object.freeze({
    Fly: { state: 'airborne', prepare: 's’envole', hits: airborneHits, gravity: true },
    Bounce: { state: 'airborne', prepare: 'bondit très haut', hits: airborneHits, gravity: true },
    Dig: { state: 'underground', prepare: 's’enfouit sous terre', hits: { Earthquake: 2, Magnitude: 2 } },
    Dive: { state: 'submerged', prepare: 'plonge sous l’eau', hits: { Surf: 2, Whirlpool: 2 } },
    'Phantom Force': { state: 'vanished', prepare: 'disparaît', breaksProtect: true },
    'Shadow Force': { state: 'vanished', prepare: 'disparaît', breaksProtect: true },
    'Sky Drop': { state: 'airborne', prepare: 'emporte son adversaire dans les airs', hits: airborneHits, gravity: true },
    'Solar Beam': { solar: true },
    'Razor Wind': {}, 'Skull Bash': { defense: true }, 'Sky Attack': {},
    'Freeze Shock': {}, 'Ice Burn': {}, Geomancy: {}
});
function rule(name) { return RULES[name] || null; }
// Correcting runtime metadata must not reroll existing seeded encounter sets
// or historic Colosseum versions. These moves were previously classed standard.
const previouslyStandard = new Set(['Fly','Bounce','Dig','Dive','Phantom Force','Shadow Force','Sky Drop','Freeze Shock','Ice Burn']);
function generationStandard(move) { return move?.combat?.power_type === 'standard' || previouslyStandard.has(move?.ename); }
function clear(pokemon, other = null, turn = null) {
    const data = pokemon?.__battle;
    if (!data) return;
    if (data.skyDropBy && other?.uuid === data.skyDropBy && other.__battle?.skyDropTarget === pokemon.uuid) {
        other.__battle.chargeMove = null; other.__battle.chargeTurns = 0; other.__battle.semiInvulnerable = null;
        if (turn != null) other.__battle.chargeInterruptedTurn = turn;
        delete other.__battle.skyDropTarget;
    }
    if (data.skyDropTarget && other?.uuid === data.skyDropTarget && other.__battle?.skyDropBy === pokemon.uuid) {
        delete other.__battle.skyDropBy;
        other.__battle.semiInvulnerable = null;
        if (turn != null) other.__battle.skyDropSkipTurn = turn;
    }
    data.chargeMove = null; data.chargeTurns = 0; data.semiInvulnerable = null;
    delete data.skyDropTarget;
    delete data.skyDropBy;
}
module.exports = { RULES, rule, clear, generationStandard };

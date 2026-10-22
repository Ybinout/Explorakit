const catalog = require('../../../data/game/progression.json');

// Older saves could reach Mounir/Hoze before the Route 2 encounter existed.
// Interpret those wins without rewriting receipts, paying rewards or unlocking the archived continuation.
function effectiveStoryFlags(state = {}) {
    const flags = { ...(state.flags || {}) };
    if (flags.hoze_defeated === 'true') flags.moonpunch_defeated = 'true';
    if (flags.moonpunch_defeated === 'true') flags.aspha_route2_defeated = 'true';
    if (flags.aspha_route2_defeated === 'true') flags.route_guard_defeated = 'true';
    return flags;
}
function meetsRequirements(definition, state = {}) {
    const flags = effectiveStoryFlags(state);
    return definition?.enabled !== false && (definition?.requiresFlags || []).every((key) => flags[key] === 'true');
}
function hasCompletedBattle(definition, state = {}) {
    return Boolean(definition && ((state.completedNpcBattles || []).some((battle) => battle.battleKey === definition.battleKey)
        || (definition.completionFlag && state.flags?.[definition.completionFlag] === 'true')
        || (definition.legacyCompletionFlags || []).some(key => state.flags?.[key] === 'true')));
}

// Les étapes sont comptées dans l'ordre, jamais à partir du numéro d'un badge.
// Les anciennes sauvegardes gardent leurs récompenses sans terminer le nouveau récit.
function deriveStoryQuest(state = {}) {
    const steps = catalog.storySteps || [];
    const flags = effectiveStoryFlags(state);
    let progress = 0;
    while (progress < steps.length && flags[steps[progress].flag] === 'true') progress += 1;
    return {
        progress,
        target: steps.length,
        status: progress === steps.length ? 'completed' : 'active',
        description: steps[progress]?.objective || catalog.chapterConclusion,
        destination: steps[progress]?.destination || null,
        map: steps[progress]?.map || null
    };
}

function deriveChapter2(state={}) {
    const steps=catalog.chapter2Steps||[];let progress=0;
    while(progress<steps.length && state.flags?.[steps[progress].flag]==='true')progress++;
    return {progress,target:steps.length,status:progress===steps.length?'completed':'active',description:steps[progress]?.objective||'Lucie est retrouvée. Les refuges ont retrouvé leur liberté.',destination:steps[progress]?.destination||null,map:steps[progress]?.map||null};
}
function transitionBlock(transition, flags = {}) {
    return transition?.blockedMessage || (transition?.requiresStoryFlag && flags[transition.requiresStoryFlag] !== 'true'
        ? transition.lockedMessage || 'Ce passage est fermé.' : null);
}
module.exports = { effectiveStoryFlags, deriveChapter2, meetsRequirements, hasCompletedBattle, deriveStoryQuest, transitionBlock };

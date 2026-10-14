const catalog = require('../../../data/game/progression.json');

function meetsRequirements(definition, state = {}) {
    return (definition?.requiresFlags || []).every((key) => state.flags?.[key] === 'true');
}

function hasCompletedBattle(definition, state = {}) {
    return Boolean(definition && (state.completedNpcBattles || [])
        .some((battle) => battle.battleKey === definition.battleKey));
}

// Les étapes sont comptées dans l'ordre, jamais à partir du numéro d'un badge.
// Les anciennes sauvegardes gardent leurs récompenses sans terminer le nouveau récit.
function deriveStoryQuest(state = {}) {
    const steps = catalog.storySteps || [];
    let progress = 0;
    while (progress < steps.length && state.flags?.[steps[progress].flag] === 'true') progress += 1;
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
    return {progress,target:steps.length,status:progress===steps.length?'completed':'active',description:steps[progress]?.objective||'Clara est retrouvée. Les refuges ont retrouvé leur liberté.',destination:steps[progress]?.destination||null,map:steps[progress]?.map||null};
}
module.exports = { deriveChapter2, meetsRequirements, hasCompletedBattle, deriveStoryQuest };

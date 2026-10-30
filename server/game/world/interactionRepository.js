const fs = require('fs');
const path = require('node:path');
const catalog = require('../../../data/game/progression.json');
const { meetsRequirements, hasCompletedBattle } = require('./storyProgression');

const INTERACTIONS_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'interact.json');

function loadInteractions() {
    try {
        const rawData = fs.readFileSync(INTERACTIONS_PATH);
        return JSON.parse(rawData);
    } catch (err) {
        console.error('Error reading interact.json:', err);
        return [];
    }
}

const interactions = loadInteractions();

function getDialogueEntryByName(name) {
    if (!name || typeof name !== 'string') return null;
    return interactions.find((entry) => entry.name === name) || null;
}

function getSentenceForMapAndPosition(map, x, y = null, state = null) {
    const dialogueEntry = interactions.find((entry) => {
        if (entry.map !== map || entry.x !== x) return false;
        if (y === null || y === undefined) return true;
        if (entry.y === undefined || entry.y === null) return true;
        return entry.y === y;
    });

    if (dialogueEntry && Array.isArray(dialogueEntry.sentences) && dialogueEntry.sentences.length > 0) {
        return getSentenceForName(dialogueEntry.name, state);
    }

    return null;
}

function getSentenceForName(name, state = null, { replayArena = require('./testReplayState').active(state, name) } = {}) {
    state=require('./labStory').view(state);
    if(name==='dia0'&&state?.flags?.lucie_rescued==='true')name='dia0_final';
    if(name==='lucie_home'&&state?.flags?.lucie_rescued==='true'){
        const mirror=require('./mirrorRift'),ending=require('./voidEnding');
        const hasEndingBadge=state.badges?.some(badge=>badge.earned&&mirror.endingBadges.includes(badge.key));
        if(hasEndingBadge&&mirror.state(state).stage==='sealed'&&(!ending.replay(state)||ending.state(state).claimed))name='lucie_home_unsettled';
    }
    let dialogueEntry = getDialogueEntryByName(name);
    const definition = catalog.npcBattles?.[name] || catalog.storyEvents?.[name];
    if (definition?.enabled === false && dialogueEntry?.locked) {
        dialogueEntry = getDialogueEntryByName(dialogueEntry.locked);
    } else if (dialogueEntry && state) {
        const completed = hasCompletedBattle(catalog.npcBattles?.[name], state)
            || (definition?.completionFlag && state.flags?.[definition.completionFlag] === 'true');
        if (completed && dialogueEntry.after && !replayArena) {
            const followUp = state.flags?.lucie_rescued === 'true' && dialogueEntry.afterRescue
                ? dialogueEntry.afterRescue : dialogueEntry.after;
            dialogueEntry = getDialogueEntryByName(followUp);
        }
        else if (!meetsRequirements(definition, state) && dialogueEntry.locked) {
            dialogueEntry = getDialogueEntryByName(dialogueEntry.locked);
        }
    }
    if (dialogueEntry && Array.isArray(dialogueEntry.sentences) && dialogueEntry.sentences.length > 0) {
        const variants=dialogueEntry.variants;
        return [Array.isArray(variants)&&variants.length ? variants[Math.floor(Math.random()*variants.length)] : dialogueEntry.sentences, dialogueEntry.name];
    }

    return null;
}

function getEndSentenceInformation(name) {
    const dialogueEntry = getDialogueEntryByName(name);

    if (dialogueEntry) {
        return dialogueEntry.end;
    }

    return null;
}

function getTeamInformation(name) {
    const dialogueEntry = getDialogueEntryByName(name);

    if (dialogueEntry) {
        return dialogueEntry.team;
    }

    return null;
}

module.exports = {
    getSentenceForMapAndPosition,
    getSentenceForName,
    getEndSentenceInformation,
    getTeamInformation
};

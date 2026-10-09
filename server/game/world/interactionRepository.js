const fs = require('fs');
const path = require('node:path');

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

function getSentenceForMapAndPosition(map, x, y = null) {
    const dialogueEntry = interactions.find((entry) => {
        if (entry.map !== map || entry.x !== x) return false;
        if (y === null || y === undefined) return true;
        if (entry.y === undefined || entry.y === null) return true;
        return entry.y === y;
    });

    if (dialogueEntry && Array.isArray(dialogueEntry.sentences) && dialogueEntry.sentences.length > 0) {
        return [dialogueEntry.sentences, dialogueEntry.name];
    }

    return null;
}

function getSentenceForName(name) {
    const dialogueEntry = getDialogueEntryByName(name);
    if (dialogueEntry && Array.isArray(dialogueEntry.sentences) && dialogueEntry.sentences.length > 0) {
        return [dialogueEntry.sentences, dialogueEntry.name];
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

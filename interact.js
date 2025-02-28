const fs = require('fs');

// Étape 1 : Charger les données depuis le fichier JSON
function loadInteractions() {
    try {
        const rawData = fs.readFileSync('./source_Json/interact.json');
        return JSON.parse(rawData);
    } catch (err) {
        console.error('Error reading interact.json:', err);
        return [];
    }
}

const interactions = loadInteractions();

//chercher la phrase
function getSentenceForMapAndPosition(map, x) {
    const dialogueEntry = interactions.find(entry => entry.map === map && entry.x === x);
    if (dialogueEntry && dialogueEntry.sentences.length > 0) {
        return [dialogueEntry.sentences, dialogueEntry.name];
    } else {
        return null;
    }
}

// chercher si il y a une battle à la fin du dialogue
function getEndSentenceInformation(name) {
    const dialogueEntry = interactions.find(entry => entry.name === name);

    if (dialogueEntry) {
        return dialogueEntry.end
    } else {
        return null;
    }
}

//chercher la team
function getTeamInformation(name) {
    const dialogueEntry = interactions.find(entry => entry.name === name);

    if (dialogueEntry) {
        return dialogueEntry.team
    } else {
        return null;
    }
}


module.exports = {
    getSentenceForMapAndPosition, getEndSentenceInformation, getTeamInformation
};
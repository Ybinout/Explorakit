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

// Charger les interactions lors du démarrage
const interactions = loadInteractions();

// Étape 2 : Fonction pour obtenir la sentence
function getSentenceForMapAndPosition(map, x) {
    // Chercher le bon objet de dialogue correspondant à la map et à la position x
    const dialogueEntry = interactions.find(entry => entry.map === map && entry.x === x);

    if (dialogueEntry && dialogueEntry.sentences.length > 0) {
        // Si une entrée est trouvée, retourne la première sentence (ou une autre logique pour en sélectionner une)
        return dialogueEntry.sentences; // Change `0` si tu veux une autre sentence
    } else {
        return null; // Retourne null si aucun dialogue n'est trouvé
    }
}

module.exports = {
    getSentenceForMapAndPosition,
};
const fs = require('fs');
const path = require('path');
const moves = require('../data/game/moves.json');
const {
    PARTIAL_EFFECT_KINDS,
    getSpecialMoveResolution
} = require('../server/game/battle/battleEngine');

function createPokemon() {
    return {
        name: 'Auditmon', type1: 'Normal', level: 50,
        maxHp: 100, currentHp: 100,
        currentAttack: 100, currentDefense: 100,
        currentSpecialAttack: 100, currentSpecialDefense: 100, currentSpeed: 100,
        status: 'normal', abilities: ['Pound'],
        data: { base: { HP: 80, Defense: 80, 'Sp. Defense': 80 } }
    };
}

function auditMoves() {
    const engineSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'server', 'game', 'battle', 'battleEngine.js'),
        'utf8'
    );
    const implementedKinds = new Set(
        [...engineSource.matchAll(/case '([^']+)'/g)].map((match) => match[1])
    );
    const effectKinds = new Set(
        moves.flatMap((move) => (move.combat?.effects || []).map((effect) => effect.kind)).filter(Boolean)
    );
    const unknownEffectKinds = [...effectKinds]
        .filter((kind) => !implementedKinds.has(kind) && !PARTIAL_EFFECT_KINDS.has(kind))
        .sort();
    const partialMoves = moves
        .filter((move) => (move.combat?.effects || []).some((effect) => PARTIAL_EFFECT_KINDS.has(effect.kind)))
        .map((move) => move.ename);

    const attacker = createPokemon();
    const defender = createPokemon();
    const unsupportedSpecialCases = moves
        .filter((move) => move.combat?.power_type === 'special_case')
        .filter((move) => getSpecialMoveResolution(move, attacker, defender, { attackerTeam: [attacker] })?.unsupported)
        .map((move) => move.ename);

    return {
        totalMoves: moves.length,
        totalEffectKinds: effectKinds.size,
        unknownEffectKinds,
        unsupportedSpecialCases,
        partialMoves
    };
}

if (require.main === module) {
    const report = auditMoves();
    console.log(JSON.stringify(report, null, 2));
    if (report.unknownEffectKinds.length > 0 || report.unsupportedSpecialCases.length > 0) {
        process.exitCode = 2;
    }
}

module.exports = { auditMoves };

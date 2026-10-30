const fs = require('fs');
const path = require('path');
const moves = require('../data/game/moves.json');
const trainerAI = require('../server/game/battle/humanTrainerAI');
const {
    PARTIAL_EFFECT_KINDS,
    useattack, createBattleState, ensureBattleData,
    getSpecialMoveResolution
} = require('../server/game/battle/battleEngine');

function createPokemon() {
    return {
        name: 'Auditmon', type1: 'Normal', level: 50,
        maxHp: 100, currentHp: 100,
        currentAttack: 100, currentDefense: 100,
        currentSpecialAttack: 100, currentSpecialDefense: 100, currentSpeed: 100,
        status: 'normal', abilities: ['Pound'],
        data: { id:151, type:['Normal'], base: { HP: 80, Attack:80, Defense: 80, 'Sp. Attack':80, 'Sp. Defense': 80, Speed:80 } }
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

    // Execution smoke checks complement (but do not replace) semantic regressions.
    const executionFailures = [];
    const scenarios = ['healthy', 'substitute', 'protect', 'low_hp', 'burn', 'statused_target', 'rain', 'damaged_this_turn'];
    const previousRandom = Math.random;
    try {
        Math.random = () => 0.5;
        for (const move of moves) for (const side of ['player','enemy']) for (const scenario of scenarios) {
            const source = createPokemon(), target = createPokemon(), state = createBattleState();
            source.uuid = 'audit-source'; target.uuid = 'audit-target';
            source.abilities = [move.ename]; source.movePp = [move.pp || 1];
            target.abilities = ['Splash']; target.movePp = [40];
            if (scenario === 'substitute') ensureBattleData(target).substituteHp = 25;
            if (scenario === 'protect') ensureBattleData(target).protect = true;
            if (scenario === 'low_hp') source.currentHp = 1;
            if (scenario === 'burn') source.status = 'burn';
            if (scenario === 'statused_target') target.status = 'poison';
            if (scenario === 'rain') state.weather = {kind:'rain',turns:5};
            if (scenario === 'damaged_this_turn') Object.assign(ensureBattleData(source), {lastDamageTaken:10,lastDamageTurn:state.turn,lastDamageSource:target.uuid,lastDamageClass:'physical'});
            try {
                const result = useattack(move.ename, source, target, {battleState:state, attackerSide:state.sides[side],defenderSide:state.sides[side==='player'?'enemy':'player'],attackerTeam:[source], defenderTeam:[target]});
                if (!Number.isFinite(result.damage) || !Array.isArray(result.messages)
                    || [source,target].some(p => !Number.isFinite(p.currentHp) || p.currentHp < 0 || p.currentHp > p.maxHp)) {
                    executionFailures.push({move:move.ename, side, scenario, error:'Invalid result or HP'});
                }
            } catch (error) { executionFailures.push({move:move.ename, side, scenario, error:error.message}); }
        }
    } finally { Math.random = previousRandom; }
    const aiFailures = [];
    try {
        Math.random = () => { throw Error('AI consumed battle RNG'); };
        for (const move of moves) for (const scenario of ['healthy','ghost','low_hp']) {
            const source=createPokemon(),target=createPokemon(),field=createBattleState();
            source.uuid='audit-source';target.uuid='audit-target';source.abilities=[move.ename];source.movePp=[move.pp||1];
            target.abilities=['Splash'];target.movePp=[40];
            if(scenario==='ghost')target.type1='Ghost';if(scenario==='low_hp')source.currentHp=1;
            const options={team:[source],opponentTeam:[target],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};
            const before=JSON.stringify(options);
            try {
                const result=trainerAI.analyse(options),decision=trainerAI.chooseAction(options);
                if (!result.candidates.length || result.candidates.some(c=>!Number.isFinite(c.score))
                    || decision.action!=='attack' || ![-1,0].includes(decision.number)) throw Error('Invalid decision or score');
                if(JSON.stringify(options)!==before)throw Error('AI mutated its inputs');
            } catch(error){aiFailures.push({move:move.ename,scenario,error:error.message});}
        }
    } finally { Math.random=previousRandom; }
    return {
        scope: 'Structural coverage and execution smoke checks; behavioral rules are tested separately.',
        executionChecks: moves.length * scenarios.length * 2,
        executionFailures,
        aiChecks:moves.length*3,
        aiFailures,
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
    if (report.unknownEffectKinds.length > 0 || report.unsupportedSpecialCases.length > 0 || report.executionFailures.length > 0 || report.aiFailures.length > 0) {
        process.exitCode = 2;
    }
}

module.exports = { auditMoves };

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCaptureChance } = require('../server/game/battle/wildBattle');

test('affaiblir un Pokemon et utiliser une meilleure Ball augmente la capture', () => {
    const playerPokemon = { level: 20 };
    const healthyWild = { level: 20, currentHp: 100, maxHp: 100 };
    const weakenedWild = { level: 20, currentHp: 10, maxHp: 100 };

    const healthyChance = calculateCaptureChance(playerPokemon, healthyWild, 1);
    const weakenedChance = calculateCaptureChance(playerPokemon, weakenedWild, 1);
    const betterBallChance = calculateCaptureChance(playerPokemon, weakenedWild, 2);

    assert.ok(weakenedChance > healthyChance);
    assert.ok(betterBallChance > weakenedChance);
    assert.ok(betterBallChance <= 0.95);
});

test('early captures are more forgiving, taper smoothly and leave level 25+ unchanged', () => {
    const {captureBaseChance}=require('../server/game/battle/captureProgression');
    let previous=1;
    for(let level=1;level<=100;level++){
        const target={level,maxHp:100,currentHp:100},value=calculateCaptureChance({level},target);
        assert(value<=previous+1e-12);previous=value;
        if(level<=10)assert(Math.abs(value-.322)<1e-12);
        if(level>=25)for(const hp of [100,50,10]){target.currentHp=hp;assert(Math.abs(captureBaseChance(target)-(.16+(1-hp/100)*.64))<1e-12);}
    }
    assert(Math.abs(calculateCaptureChance({level:5},{level:5,maxHp:100,currentHp:50})-.69)<1e-12);
    assert.equal(calculateCaptureChance({level:5},{level:5,maxHp:100,currentHp:10}),.95);
});

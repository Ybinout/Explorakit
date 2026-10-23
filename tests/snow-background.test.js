const test = require('node:test'), assert = require('node:assert/strict');
test('snow scenery follows snowy maps and outdoor hail, while gyms, caves and the Colosseum keep their environment', async () => {
    const { battleEnvironment } = await import('../vue-explorakit/src/services/battleEnvironment.js');
    for (const map of ['route13','route14','ville5']) for (const weather of [null,'hail','sun','rain']) assert.equal(battleEnvironment(map,false,weather),'snow');
    for (const map of ['route1','route11','route12','ville4',null]) {
        assert.equal(battleEnvironment(map,false,'hail'),'snow');
        assert.equal(battleEnvironment(map),'grass');
    }
    for (const weather of [null,'hail','rain']) {
        for (const map of ['cave1','cave_rochebrume3','cave_ice']) assert.equal(battleEnvironment(map,false,weather),'cave');
        assert.equal(battleEnvironment('ville1_arene',false,weather),'lake-gym');
        assert.equal(battleEnvironment('gen_arene5',false,weather),'raph-gym');
        for (const map of ['route13','cave1','ville1_arene']) assert.equal(battleEnvironment(map,true,weather),'colosseum');
    }
    // Only actual falling snow starts ice weather; a white city alone does not.
    for (const mapName of ['route13','route14','ville5']) assert.equal(require('../server/game/battle/battleEngine').createBattleState({mapName}).weather.kind,'hail');
    assert.equal(require('../server/game/battle/battleEngine').createBattleState({mapName:'ville5_arene'}).weather.kind,null);
});

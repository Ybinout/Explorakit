const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getPnjsForMap } = require('../server/game/world/pnjStore');
const { loadCollisionData } = require('../server/game/world/mapRepository');
const { getSentenceForName } = require('../server/game/world/interactionRepository');

test('Lucie stands at the back of the room, reachable from the entrance', () => {
  const lucie = getPnjsForMap('route2_maison').find(p => p.name === 'lucie_route2');
  const map = loadCollisionData('route2_maison');
  assert.deepEqual([lucie.x,lucie.y],[13,5]);
  assert.equal(map[lucie.y][lucie.x],0);
  // The complete central approach remains clear; talking needs no map mutation.
  for (let y=6;y<=16;y++) assert.equal(map[y][13],0);
  assert.equal(lucie.sprite,'lucie-pixel-v2.png');
  const png=fs.readFileSync('vue-explorakit/src/assets/pnj/'+lucie.sprite);
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[24,32]);
});

test('Lucie uses an indoor combat scene, including weather-changing moves; actual Colosseum keeps its arena', async () => {
  const { battleEnvironment } = await import('../vue-explorakit/src/services/battleEnvironment.js');
  for (const weather of [null,'rain','hail','sandstorm','sun']) {
    assert.equal(battleEnvironment('route2_maison',false,weather),'lucie-house');
    assert.equal(battleEnvironment('route2_maison',true,weather),'colosseum');
  }
  assert.equal(battleEnvironment('route2'),'grass');
});

test('Matthieu keeps the existing personal gate and victory keys', () => {
  const gates=require('../data/game/story_gates.json');
  const personalGate=gates.gates.filter(g=>g.npcBattle==='gwenn_route8');assert(personalGate.length>0);
  const serialized=JSON.stringify(personalGate);
  assert(serialized.includes('Matthieu'));assert(!serialized.includes('Gwenn'));
  const battle=require('../data/game/progression.json').npcBattles.gwenn_route8;
  assert.equal(battle.completionFlag,'gwenn_route8_defeated');
  assert.equal(battle.once,true);
  const locked=getSentenceForName('gwenn_route8',{flags:{}});
  assert.equal(locked[1],'gwenn_route8_locked');
  assert(locked[0].some(s=>s.text.includes('Matthieu')));
  const cleared=getSentenceForName('gwenn_route8',{flags:{hoze_defeated:'true',gwenn_route8_defeated:'true'}});
  assert.equal(cleared[1],'gwenn_route8_after');
  assert(cleared[0].some(s=>s.text.includes('Matthieu')));
});

const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),{serializeFieldState}=require('../server/game/battle/battleEvents');
const mod=import('../vue-explorakit/src/services/battleField.js');
test('client understands every serialized field timer, screen and capped hazard and does not mutate the snapshot',async()=>{
    const ui=await mod,state=engine.createBattleState(),rules=require('../server/game/battle/battleField');
    Object.values(rules.FIELD_TIMERS).forEach(k=>state.field[k]=5);
    for(const side of Object.values(state.sides)){Object.values(rules.SIDE_TIMERS).forEach(k=>side.screens[k]=4);Object.values(rules.TEAM_GUARDS).forEach(k=>side.protectTeam[k]=1);Object.assign(side.hazards,{spikes:3,toxicSpikes:2,stealthRock:true,stickyWeb:true});}
    const snapshot=serializeFieldState(state),copy=JSON.stringify(snapshot),normalized=ui.normalizeBattleField(snapshot),entries=ui.battleFieldEntries(normalized);
    assert.equal(entries.length,36);assert.equal(JSON.stringify(snapshot),copy);assert.equal(new Set(entries.map(e=>e.id)).size,36);assert(entries.every(e=>e.name&&e.description&&e.color));
    assert.equal(ui.battleFieldEntries(ui.normalizeBattleField()).length,0);
    assert.equal(ui.normalizeBattleField({field:{gravityTurns:Infinity},sides:{player:{hazards:{spikes:900}}}}).sides.player.hazards.spikes,3);
});
test('duration ticks/repeated sync do not replay animations; additions, layers and removals each produce a single change',async()=>{
    const ui=await mod,empty=ui.normalizeBattleField(),state=engine.createBattleState();state.field.trickRoomTurns=5;state.sides.enemy.hazards.spikes=1;
    const one=ui.normalizeBattleField(serializeFieldState(state));assert.equal(ui.battleFieldChanges(empty,one).length,2);
    state.field.trickRoomTurns=4;const tick=ui.normalizeBattleField(serializeFieldState(state));assert.equal(ui.battleFieldChanges(one,tick).length,0);
    state.sides.enemy.hazards.spikes=2;const layer=ui.normalizeBattleField(serializeFieldState(state));assert.deepEqual(ui.battleFieldChanges(tick,layer).map(e=>[e.key,e.change]),[['spikes','start']]);
    assert(ui.battleFieldChanges(layer,empty).every(e=>e.change==='end'));assert.equal(ui.battleFieldChanges(layer,layer).length,0);
});
test('entry visuals use the correct side, include Rock for flyers and ground traps only for grounded Pokemon',async()=>{
    const ui=await mod,s=engine.createBattleState();s.sides.player.hazards.spikes=1;let state=ui.normalizeBattleField(serializeFieldState(s));
    const p={type1:'Flying'};assert(!ui.hazardEntryVisible(state,'player',p));assert(!ui.hazardEntryVisible(state,'opponent',{type1:'Normal'}));
    s.field.gravityTurns=3;state=ui.normalizeBattleField(serializeFieldState(s));assert(ui.hazardEntryVisible(state,'player',p));
    s.field.gravityTurns=0;s.sides.player.hazards.stealthRock=true;state=ui.normalizeBattleField(serializeFieldState(s));assert(ui.hazardEntryVisible(state,'player',p));
});

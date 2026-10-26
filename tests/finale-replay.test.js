const test=require('node:test'),assert=require('node:assert/strict');
const story=require('../server/game/world/labStory'),dialogue=require('../server/game/world/interactionRepository');
function finished(extra={}) {return {flags:{lucie_freed:'true',lucie_departure:'seen',lucie_house_exited:'true',professor_lead:'true',lab_door_inspected:'true',professor_lab_key:'true',professor_defeated:'true',professor_departure:'seen',lab_crystals_cleared:'true',lucie_rescued:'true',story_complete:'true',
 admin_lucie_departure:'seen',admin_professor_departure:'armed',admin_lab_rescued:'false',admin_finale_replay:'full',admin_lucie_house_exited:'true',admin_professor_lead:'false',admin_lab_door_inspected:'false',admin_professor_lab_key:'false',...extra},testReplays:['professor_story']};}
test('after a replayed house exit Wanda returns despite the permanent key; the replay door stays locked',()=>{
 const p=finished();assert(story.actors('route2',p).some(n=>n.name==='wanda_professor'));
 assert.equal(story.interaction({currentmap:'start',x:784,y:528},p).dialogue,'professor_lab_door_unknown');
 assert.equal(dialogue.getSentenceForName('wanda_professor',p)[1],'wanda_professor');
 assert.equal(p.flags.professor_lab_key,'true','permanent progress must be preserved');
});
test('captive Lucie offers the real rescue during a replay rather than the already-rescued line',()=>{
 const p=finished({admin_professor_departure:'seen','admin_room_obstacle:lab_crystals':'true'});p.testReplays=[];
 assert(story.actors('professor_lab',p).some(n=>n.name==='lucie_lab'));
 assert.equal(dialogue.getSentenceForName('lucie_lab_rescue',p)[1],'lucie_lab_rescue');
 assert(!story.actors('start',p).some(n=>n.name==='lucie_home'),'Lucie cannot be captive and home simultaneously');
 assert.equal(dialogue.getSentenceForName('dia0',p)[1],'dia0');
});
test('once the private rescue is done Lucie leaves the lab and returns to her mother',()=>{
 const p=finished({admin_professor_departure:'seen','admin_room_obstacle:lab_crystals':'true',admin_lab_rescued:'true'});p.testReplays=[];
 assert(!story.actors('professor_lab',p).some(n=>n.name==='lucie_lab'));
 assert(story.actors('start',p).some(n=>n.name==='lucie_home'));
 assert.equal(dialogue.getSentenceForName('dia0',p)[1],'dia0_final');
});
test('a replay cannot use old professor victories or its permanent key to skip the new sequence',()=>{
 const p=finished();assert.equal(dialogue.getSentenceForName('professor_story',p)[1],'professor_story_locked');
 p.flags.admin_professor_lab_key='true';assert.equal(dialogue.getSentenceForName('professor_story',p)[1],'professor_story');
 assert.equal(dialogue.getSentenceForName('lucie_lab_rescue',p)[1],'lucie_lab_rescue_locked');
 const snapshot=JSON.stringify(p);story.view(p);assert.equal(JSON.stringify(p),snapshot,'scene projection never mutates normal progress');
});
test('old replay saves stay at their actual stage, while ordinary completed stories retain their ending',()=>{
 const legacy=finished({admin_finale_replay:undefined,admin_lucie_house_exited:undefined,admin_professor_lead:undefined,admin_lab_door_inspected:undefined,admin_professor_lab_key:undefined});
 assert(story.actors('route2',legacy).some(n=>n.name==='wanda_professor'));
 legacy.flags.admin_professor_departure='seen';legacy.flags['admin_room_obstacle:lab_crystals']='true';legacy.testReplays=[];
 assert(!story.actors('route2',legacy).some(n=>n.name==='wanda_professor'));assert(story.interaction({currentmap:'start',x:784,y:528},legacy).enter);
 assert.equal(dialogue.getSentenceForName('lucie_lab_rescue',legacy)[1],'lucie_lab_rescue');
 const ordinary={flags:Object.fromEntries(Object.entries(legacy.flags).filter(([key])=>!key.startsWith('admin_')))};
 assert(story.actors('start',ordinary).some(n=>n.name==='lucie_home'));assert(!story.actors('professor_lab',ordinary).some(n=>n.name==='lucie_lab'));assert.equal(dialogue.getSentenceForName('dia0',ordinary)[1],'dia0_final');
});

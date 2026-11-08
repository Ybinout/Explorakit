const test=require('node:test'),assert=require('node:assert/strict'),journal=require('../server/game/world/questJournal');
const derive=(flags={},extra={})=>journal.derive({flags:{journal_started:'true',...flags},...extra});
const active=j=>j.entries.filter(q=>q.status==='active').map(q=>q.key);
test('only Wayne is initially visible; the existing tutorial must still be won',()=>{
 assert.deepEqual(active(derive()),['journal_wayne']);assert.equal(derive().entries.length,1);
 assert.deepEqual(active(derive({early_tutorial:'complete'})),['journal_wayne']);
 assert.deepEqual(active(derive({route_guard_defeated:'true'})),['journal_aspha']);
 assert.deepEqual(active(derive({aspha_route2_defeated:'true'})),['journal_mounir']);
});
test('every real champion and required passage appears in story order, with no duplicate legacy quests',()=>{
 const j=derive({sevenp_defeated:'true',journal_visit_comptoir:'true'});
 assert.deepEqual(j.entries.map(q=>q.key),['journal_wayne','journal_aspha','journal_mounir','journal_hoze','journal_matthieu','journal_raph','journal_comptoir','journal_ana','journal_wanda','journal_gwenn','journal_sevenp','journal_lucie']);
 assert.equal(new Set(j.entries.map(q=>q.key)).size,j.entries.length);assert.deepEqual(active(j),['journal_lucie']);assert(j.entries.every((q,i,qs)=>!i||q.order>qs[i-1].order));
});
test('new saves do not skip the shopping visit even if a later arena was won',()=>{
 assert.deepEqual(active(derive({raphael_defeated:'true'})),['journal_comptoir']);
 assert.deepEqual(active(derive({ana_defeated:'true'})),['journal_comptoir']);
 assert(!derive({ana_defeated:'true'}).entries.some(q=>q.key==='journal_wanda'));
 assert.deepEqual(active(derive({ana_defeated:'true',journal_visit_comptoir:'true'})),['journal_wanda']);
});
test('old advanced saves can be reconciled without asking for unique fights again',()=>{
 const f={flags:{ana_defeated:'true'}};assert(journal.legacyComptoir(f));assert(!journal.legacyComptoir({flags:{...f.flags,journal_started:'true'}}));assert(!journal.legacyComptoir({flags:{raphael_defeated:'true'}}));
 assert.deepEqual(active(derive({ana_defeated:'true',journal_legacy_comptoir:'true'})),['journal_wanda']);
 for(const proof of [{badges:['summit_badge']},{battles:['story_champion_7p']}])assert.deepEqual(active(derive({journal_visit_comptoir:'true'},proof)),['journal_lucie']);
});
test('the lab fight and actual rescue are separate, and pickup never unlocks before the rescue',()=>{
 assert.deepEqual(active(derive({professor_defeated:'true',journal_visit_comptoir:'true'})),['journal_rescue']);
 assert.deepEqual(active(derive({lucie_rescued:'true',journal_visit_comptoir:'true'})),['journal_teleporter']);
 const j=derive({professor_defeated:'true',journal_visit_comptoir:'true'},{items:['void_teleporter']});assert(!j.entries.some(q=>q.key==='journal_teleporter'));
 assert.deepEqual(active(derive({lucie_rescued:'true',journal_visit_comptoir:'true'},{items:['void_teleporter']})),['journal_teleporter_use']);
});
test('charging is not enough: the teleporter quest completes on successful use',()=>{
 const flags={lucie_rescued:'true',void_found:'true',void_charge:'5',journal_visit_comptoir:'true'};
 assert.deepEqual(active(derive(flags)),['journal_teleporter_use']);
 assert.deepEqual(active(derive({...flags,journal_visit_void:'true'})),['journal_finale']);
 assert.deepEqual(active(derive(flags,{map:'void_arena'})),['journal_finale']);
});
for(const resolution of ['violence','pardon'])test('both endings unlock Route 2, and only the sealed/won rift completes it: '+resolution,()=>{
 const f={void_defeated:'true',void_resolution:resolution,journal_visit_comptoir:'true'};assert.deepEqual(active(derive(f)),['journal_rift']);
 for(const stage of ['sealed','open','clone'])assert.deepEqual(active(derive({...f,mirror_stage:stage})),['journal_rift']);
 for(const stage of ['won','complete'])assert.deepEqual(active(derive({...f,mirror_stage:stage})),[]);
 const j=derive({journal_visit_comptoir:'true'},{badges:[resolution+'_badge']});assert.deepEqual(active(j),['journal_rift']);
});
test('legacy mirror completion proves the finale and keeps its completed Route 2 hint coherent',()=>{const j=derive({mirror_stage:'complete',journal_legacy_comptoir:'true'});assert.deepEqual(active(j),[]);assert.equal(j.entries.at(-1).key,'journal_rift');assert.equal(j.entries.at(-1).map,'route2_maison');});
test('the Super island and Dark quests require their actual travel items',()=>{
 assert(!derive({super_tournament_invited:'true'}).entries.some(q=>q.section==='afterstory'));
 let j=derive({},{items:['super_tournament_pass']});assert(j.entries.some(q=>q.key==='journal_super_island'&&q.status==='active'));
 j=derive({},{items:['super_tournament_pass'],map:'super_tournament_lobby'});assert(j.entries.some(q=>q.key==='journal_super_island'&&q.status==='completed'));
 j=derive({},{items:['professional_trainer_card']});assert(j.entries.some(q=>q.key==='journal_dark_visit'&&q.status==='active'));assert(!j.entries.some(q=>q.key==='journal_dark_research'));
 j=derive({},{items:['professional_trainer_card'],map:'jungle9'});assert(j.entries.some(q=>q.key==='journal_dark_research'&&q.status==='active'));
 j=derive({dark_horizon_heard:'true',journal_visit_dark:'true'},{items:['professional_trainer_card']});assert(j.entries.some(q=>q.key==='journal_dark_research'&&q.status==='completed'));
});
test('the elite challenge is given by the NPC and reaches tier 3 after 32 rooms, including old records',()=>{
 assert(!derive({},{bestRooms:32}).entries.some(q=>q.key==='journal_super_elite'));
 for(const n of [0,16,31,32,48]){const q=derive({super_elite_challenge:'true'},{bestRooms:n}).entries.find(q=>q.key==='journal_super_elite');assert.equal(q.progress,Math.min(32,n));assert.equal(q.target,32);assert.equal(q.status,n>=32?'completed':'active');}
});
test('read markers survive projections, completions never reopen, and admin replays grant nothing',()=>{
 assert.equal(derive().unreadCount,1);assert.equal(derive({'journal_read:journal_wayne':'true'}).unreadCount,0);
 assert.deepEqual(active(derive({'journal_read:journal_wayne':'true',route_guard_defeated:'true'})),['journal_aspha']);
 assert.deepEqual(active(derive({},{quests:[{quest_key:'journal_wayne',status:'completed',progress:1}]})),['journal_aspha']);
 assert.deepEqual(active(derive({admin_void_defeated:'true',admin_mirror_stage:'complete',admin_lab_rescued:'true'})),['journal_wayne']);
});
test('new NPCs have safe footprints, matching dialogues and no combat rewards',()=>{
 const fs=require('fs'),terrain=require('../server/game/world/mapRepository'),npcs=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/game/pnjs.jsonc'))).pnjs,interactions=require('../data/game/interact.json'),p=require('../data/game/progression.json');
 for(const name of ['super_elite_mentor','dark_horizon_explorer']){const actor=npcs.find(n=>n.name===name),dialogue=interactions.find(i=>i.name===name);assert(actor&&dialogue);const grid=terrain.loadCollisionData(actor.map);assert.equal(grid[actor.y][actor.x],0);assert.equal(grid[actor.y-1][actor.x],0);assert.equal(dialogue.end,'story');assert(p.storyEvents[name]);assert(!p.npcBattles[name]);assert.equal(dialogue.sentences[0].portraitFrame.index,actor.spriteFrame.index);}
});
test('both final conversations include the exact last warning; reconnect and replay keep it once',()=>{
 const e=require('../server/game/world/voidEnding'),p={flags:{lucie_rescued:'true',void_found:'true',void_charge:'5',void_defeated:'true',void_resolution:'violence'}};
 assert.equal(e.entryDialogue(p).name,e.dialogues.finalWords.name);
 const sentence='Le Professeur : Tu dois reboucher la faille toi-même, sur la Route 2…';assert.equal(e.dialogues.finalWords.sentences.at(-1).text,sentence);assert.equal(e.dialogues.pardon.sentences.at(-1).text,sentence);
 p.flags.void_final_words_seen='true';assert.equal(e.entryDialogue(p),null);
 p.flags.void_resolution='pardon';assert.equal(e.entryDialogue(p).name,e.dialogues.pardon.name);
 p.flags.void_pardon_seen='true';assert.equal(e.entryDialogue(p),null);
});
test('notification diffs are silent for history, deduplicated for refreshes and persistently cleared by server read markers',async()=>{
 const{QuestNotifications}=await import('../vue-explorakit/src/services/questNotifications.js'),n=new QuestNotifications();
 assert.deepEqual(n.snapshot(undefined),[]);assert.deepEqual(n.snapshot(derive()),[]);
 let j=derive({route_guard_defeated:'true'});assert.deepEqual(n.snapshot(j).map(q=>q.key),['journal_aspha']);assert.deepEqual(n.snapshot(j),[]);
 assert.deepEqual(n.snapshot(derive({route_guard_defeated:'true','journal_read:journal_aspha':'true'})),[]);
 j=derive({aspha_route2_defeated:'true'});assert.deepEqual(n.snapshot(j).map(q=>q.key),['journal_mounir']);
 const reconnect=new QuestNotifications();assert.deepEqual(reconnect.snapshot(j),[]);
});
test('the tournament journal refresh follows committed room clears only, never action ticks or a failed save',async()=>{
 const{TournamentController}=require('../server/game/superTournament/controller'),factory=require('../server/game/drift/pokemonFactory');let calls=0,fail=false;
 const c=new TournamentController({userId:1,getPlayer:()=>({id:'fixture',username:'Test'}),emit:()=>{},travel:async()=>{},onJournalProgress:async()=>{calls++;},persist:{async save(){if(fail)throw Error('database unavailable');return 1;}}});
 const team={pokemons:[9,94,212,248,445,121].map((id,i)=>{const p=factory.create(id,100,true);p.heldItem=['leftovers','life_orb','focus_sash','choice_scarf','choice_band','rocky_helmet'][i];return p;})};
 await c.register(team);assert.equal(calls,0);await c.atomic(()=>{c.run.score++;});assert.equal(calls,0);
 await c.atomic(()=>{c.run.cleared=1;});assert.equal(calls,1);fail=true;await assert.rejects(()=>c.atomic(()=>{c.run.cleared=2;}),/database unavailable/);assert.equal(calls,1);assert.equal(c.run.cleared,1);
 fail=false;await c.atomic(()=>{c.run.cleared=32;});assert.equal(calls,2);await c.atomic(()=>{c.run.cleared=33;});assert.equal(calls,2);
});

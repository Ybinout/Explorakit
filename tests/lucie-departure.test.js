const test=require('node:test'),assert=require('node:assert/strict');
const scene=require('../server/game/world/lucieDeparture'),base=require('../server/game/world/pnjStore');
const won={flags:{lucie_freed:'true'}};
test('Lucie departure is personal, requires victory, and removes both actor and collision only after acknowledgement',()=>{
 let progress={flags:{}},leaving=false;const store=scene.scopedStore(base,()=>progress,()=>leaving),other=scene.scopedStore(base,()=>won);
 assert(!scene.pending(progress));assert(!scene.hidden(progress));assert(store.getPnjAtTile(scene.config.map,13,5));
 progress=won;assert(scene.pending(progress));assert(store.isPnjBlockingTile(scene.config.map,13,5));
 progress={flags:{...won.flags,lucie_departure:'seen'}};assert(scene.hidden(progress));assert(!scene.pending(progress));assert.equal(store.getPnjAtTile(scene.config.map,13,5),null);assert(!store.isPnjBlockingTile(scene.config.map,13,5));
 assert(other.getPnjAtTile(scene.config.map,13,5));assert.equal(store.getPnjsForMap('ville1_arene').length,base.getPnjsForMap('ville1_arene').length);
 leaving=true;assert(store.getPnjAtTile(scene.config.map,13,5),'keep the sprite available until the vortex closes');
});
test('Admin replay has a separate departure state and leaves permanent progression intact',()=>{
 const flags={lucie_freed:'true',lucie_departure:'seen',admin_lucie_departure:'armed'};
 let p={flags,testReplays:['lucie_route2']};assert(!scene.hidden(p));assert(!scene.pending(p));
 p={flags:{...flags,admin_lucie_departure:'pending'},testReplays:[]};assert(scene.pending(p));assert.equal(scene.flag(p),'admin_lucie_departure');
 p.flags.admin_lucie_departure='seen';assert(scene.hidden(p));assert.equal(flags.lucie_departure,'seen');
});
test('Vortex poses stay finite, consume the actor gradually, and respect reduced motion',async()=>{
 const {departurePose}=await import('../vue-explorakit/src/services/lucieDeparture.js'),state={startedAt:100,duration:4200};
 const before=departurePose(state,100),middle=departurePose(state,2400),after=departurePose(state,4500);
 assert.equal(before.scale,1);assert.equal(before.alpha,1);assert(middle.scale<1&&middle.scale>0);assert.equal(after.alpha,0);assert(after.scale>0);
 for(const now of [0,100,1600,2500,4500]){const p=departurePose(state,now,false);assert.equal(p.scale,1);assert.equal(p.rotation,0);assert.equal(p.drop,0);assert(Object.values(p).every(Number.isFinite));}
});
test('Lucie world sprite is player-sized and the concluding line precedes her disappearance',async()=>{
 const fs=require('node:fs'),source=fs.readFileSync('vue-explorakit/src/services/npcFrames.js','utf8').replace(/^import .*;\n/gm,'').replace(/export function /g,'function '),npcAppearance=new Function(source+'; return npcAppearance;')();
 const actor=npcAppearance(base.getPnjsForMap(scene.config.map).find(p=>p.name===scene.config.actor));assert.equal(actor.sprite,'lucie-pixel-v3.png');
 const png=fs.readFileSync('vue-explorakit/src/assets/pnj/'+actor.sprite);assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[32,32]);
 const lines=require('../data/game/interact.json').find(d=>d.name===scene.config.dialogue).sentences;assert.equal(lines.at(-1).text,'Lucie : Non… laisse-moi ! Éloigne-toi !');assert(!JSON.stringify(lines).includes('Ensemble.'));
});

const test=require('node:test'),assert=require('node:assert/strict');
const repo=require('../server/persistence/berryMasterRepository'),magic=require('../server/persistence/magicIslandRepository'),master=require('../server/game/berries/master');
const{registerMagicIslandHandlers}=require('../server/realtime/handlers/magicIslandHandlers');
test.afterEach(()=>test.mock.restoreAll());
function fixture(provider=async()=>({status:'learned',recipe:master.recipes[0]})){
 const player={currentmap:'ile2_04',x:9*32+16,y:10*32+16,inbattle:false,inventoryBusy:false},commands=new Map(),events=[],dialogues=[],calls=[];
 test.mock.method(repo,'visit',async id=>{calls.push(id);return provider(id);});
 test.mock.method(magic,'state',async()=>{throw Error('The choice menu must not read or mutate a daily service.');});
 const api=registerMagicIslandHandlers({socket:{emit:(name,data)=>events.push({name,data})},account:{on:(name,handler)=>commands.set(name,handler)},userId:123,getPlayer:()=>player,canUse:()=>true,travel:async()=>{},speak:(actor,pages)=>dialogues.push({actor,pages})});
 return{player,events,dialogues,calls,api,async command(data){let reply;await commands.get('magic:berryMaster')(data,r=>{reply=r;});return reply;}};
}
test('talking to the master only opens the choices; no explanation or daily recipe is triggered',async()=>{
 const f=fixture();assert(await f.api.interact());assert.deepEqual(f.events,[{name:'magicIslandPanel',data:{mode:'berryMaster'}}]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.dialogues,[]);assert(!f.player.inventoryBusy);
});
test('explicit explanation teaches only the three advice pages without claiming any recipe',async()=>{
 const f=fixture();const result=await f.command({action:'explain'});assert(result.success);assert.deepEqual(f.calls,[]);assert.equal(f.dialogues.length,1);assert.equal(f.dialogues[0].pages.length,3);assert(f.dialogues[0].pages.every(p=>p.imageName==='townspeople.png'&&p.portraitFrame===master.FRAME));assert(!f.dialogues[0].pages.some(p=>p.text.includes('recette du jour')));assert.deepEqual(f.events.at(-1),{name:'magicIslandPanel',data:null});assert(!f.player.inventoryBusy);
});
test('explicit recipe request uses the authenticated account and does not repeat the explanations',async()=>{
 const f=fixture();const result=await f.command({action:'recipe',userId:999,now:0});assert(result.success);assert.deepEqual(f.calls,[123]);const pages=f.dialogues[0].pages;assert.equal(pages.length,2);assert(pages.some(p=>p.text.includes('recette du jour')));assert(!pages.some(p=>p.text.includes('15 minutes')));assert(!f.player.inventoryBusy);
});
test('recipe action refuses distance, battle, busy inventory and unknown choices before visiting the repository',async()=>{
 const f=fixture();f.player.x=10000;assert.equal((await f.command({action:'recipe'})).success,false);f.player.x=9*32+16;f.player.inbattle=true;assert.equal((await f.command({action:'recipe'})).success,false);f.player.inbattle=false;f.player.inventoryBusy=true;assert.equal((await f.command({action:'recipe'})).success,false);f.player.inventoryBusy=false;assert.equal((await f.command({action:'unknown'})).success,false);assert.equal((await f.command({})).success,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.dialogues,[]);
});
test('an unavailable notebook leaves the choice open and releases the command for a later retry',async()=>{
 let attempts=0;const f=fixture(async()=>{if(++attempts===1)throw Error('Carnet momentanément indisponible.');return{status:'already',recipe:master.recipes[0]};});
 const first=await f.command({action:'recipe'});assert.equal(first.success,false);assert(!f.player.inventoryBusy);assert.deepEqual(f.events,[]);assert.deepEqual(f.dialogues,[]);
 assert((await f.command({action:'recipe'})).success);assert.equal(f.dialogues[0].pages.length,2);assert(f.dialogues[0].pages.some(p=>p.text.includes('déjà confié')));
});
test('an in-flight recipe cannot also start an explanation or a second claim',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.command({action:'recipe'});assert(f.player.inventoryBusy);assert.equal((await f.command({action:'explain'})).success,false);assert.equal((await f.command({action:'recipe'})).success,false);assert.deepEqual(f.calls,[123]);resolve({status:'learned',recipe:master.recipes[0]});assert((await pending).success);assert.equal(f.dialogues.length,1);assert(!f.player.inventoryBusy);
});

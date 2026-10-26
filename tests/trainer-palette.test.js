const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {normalizeTrainerPalette}=require('../server/game/world/trainerPalette');
const {registerTrainerPaletteHandlers}=require('../server/realtime/handlers/trainerPaletteHandlers');
const ui=import('../vue-explorakit/src/services/trainerPalette.js');
function socket(id){const s=new EventEmitter();s.id=id;return s;}
function fixture(id,userId,save){const s=socket(id),p={id,userId,sprite:'sprite.png',spritePalette:null},events=[];registerTrainerPaletteHandlers({socket:s,userId,getPlayer:()=>p,save,broadcast:(player,palette)=>events.push({id:player.id,palette})});return{s,p,events,async set(value){let result;await s.listeners('setTrainerPalette')[0](value,r=>result=r);return result;},close(){s.emit('disconnect');}};}
test('the same eight keys are accepted on client/server; malformed palette values cannot select assets or arbitrary colors',async()=>{
    const u=await ui;for(const c of ['blue','sage','lavender','sand'])for(const m of ['light','dark']){const key=`${c}-${m}`;assert.equal(normalizeTrainerPalette(key),key);assert.equal(u.normalizeTrainerPalette(key),key);assert.equal(u.trainerPaletteKey({themeColor:c,themeMode:m}),key);}
    for(const x of [undefined,null,{},'__proto__','RED','blue-system','../../file','#123456']){assert.equal(normalizeTrainerPalette(x),null);assert.equal(u.normalizeTrainerPalette(x),null);}
});
test('palette replacement changes only five exact cloth/cap colors; skin, white, outlines, transparency and source are intact',async()=>{
    const {recolorTrainerPixels}=await ui,source=new Uint8ClampedArray([232,112,96,255,176,80,72,255,120,64,64,255,192,56,56,255,136,40,64,128,248,208,184,255,232,232,248,255,0,0,0,255,232,112,96,0]),before=[...source],variants=[];
    for(const c of ['blue','sage','lavender','sand'])for(const m of ['light','dark']){const result=recolorTrainerPixels(source,`${c}-${m}`);assert.notDeepEqual([...result.slice(0,3)],before.slice(0,3));assert.deepEqual([...result.slice(20)],before.slice(20));for(let i=3;i<source.length;i+=4)assert.equal(result[i],source[i]);variants.push([...result.slice(0,3)].join(','));}
    assert.equal(new Set(variants).size,8);assert.deepEqual([...source],before);assert.deepEqual([...recolorTrainerPixels(source,null)],before);
});
test('authenticated save publishes the same canonical palette across active sessions and namespaces, without touching anyone else',async()=>{
    const writes=[],save=async(id,key)=>writes.push([id,key]),a=fixture('adventure',901,save),b=fixture('drift',901,save),other=fixture('peer',902,save);
    try{assert.deepEqual(await a.set({palette:'blue-dark',userId:902}),{success:true,palette:'blue-dark'});assert.deepEqual(writes,[[901,'blue-dark']]);assert.equal(a.p.spritePalette,'blue-dark');assert.equal(b.p.spritePalette,'blue-dark');assert.equal(other.p.spritePalette,null);assert.equal(a.events.length,1);assert.equal(b.events.length,1);assert.equal((await a.set({palette:'blue-dark'})).success,true);assert.equal(writes.length,1);assert.equal((await a.set({palette:'../sprite.png'})).success,false);assert.equal((await a.set(null)).success,false);}finally{[a,b,other].forEach(f=>f.close());}
});
test('concurrent sessions serialize database commits and broadcasts; rapid duplicate commands are bounded',async()=>{
    let release;const writes=[],save=(id,key)=>{writes.push(key);return key==='blue-dark'?new Promise(r=>release=r):Promise.resolve();};
    const a=fixture('a',903,save),b=fixture('b',903,save);
    try{const first=a.set({palette:'blue-dark'});await Promise.resolve();await Promise.resolve();assert.equal((await a.set({palette:'sand-dark'})).success,false);const second=b.set({palette:'sage-light'});await Promise.resolve();assert.deepEqual(writes,['blue-dark']);release();await first;await second;assert.deepEqual(writes,['blue-dark','sage-light']);assert.equal(a.p.spritePalette,'sage-light');assert.equal(b.p.spritePalette,'sage-light');}finally{a.close();b.close();}
});
test('failed saves never publish a color; a disconnect removes its subscriber while other sessions still receive the committed value',async()=>{
    const warn=console.error;console.error=()=>{};const failed=fixture('fail',904,async()=>{throw Error('Unavailable');});
    try{assert.equal((await failed.set({palette:'sage-dark'})).success,false);assert.equal(failed.p.spritePalette,null);assert.equal(failed.events.length,0);}finally{console.error=warn;failed.close();}
    let release;const a=fixture('gone',905,()=>new Promise(r=>release=r)),b=fixture('active',905,async()=>{});
    try{const task=a.set({palette:'lavender-dark'});await Promise.resolve();await Promise.resolve();a.close();release();await task;assert.equal(a.events.length,0);assert.equal(b.p.spritePalette,'lavender-dark');}finally{a.close();b.close();}
});
test('public world and trainer profile expose only the normalized palette',()=>{
    const {toPublicPlayer}=require('../server/realtime/playerState'),{publicTrainer}=require('../server/persistence/trainerRepository');
    assert.equal(toPublicPlayer({spritePalette:'blue-dark'}).spritePalette,'blue-dark');assert.equal(toPublicPlayer({spritePalette:'invalid'}).spritePalette,null);assert.equal(publicTrainer({id:1,sprite_palette:'sage-light'}).spritePalette,'sage-light');
});
